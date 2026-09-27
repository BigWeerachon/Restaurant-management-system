-- =============================================================================
-- Sabai — POS & Kitchen (KDS)
--
-- Principles
--   * The server re-prices everything. Clients send *what* was ordered, never prices.
--   * Order ids are generated on the device (UUIDv7) → retries/offline sync are idempotent.
--   * Documents are numbered gap-free per branch (tax-invoice requirement).
--   * Sensitive actions (void after fire, big discount, refund) either need the
--     permission or a manager approval obtained by PIN — never a blocking dead end.
--   * A closed business day is locked; corrections land in the current day.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Day close (period lock). Summaries are posted to the GL by finance.close_business_day.
-- -----------------------------------------------------------------------------
create table app.day_closes (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  branch_id      uuid not null,
  business_date  date not null,
  status         text not null default 'closed' check (status in ('closed','reopened')),
  summary        jsonb not null default '{}'::jsonb,
  closed_by      uuid,
  closed_at      timestamptz not null default now(),
  reopened_by    uuid,
  reopened_at    timestamptz,
  note           text,
  unique (tenant_id, id),
  unique (branch_id, business_date),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id)
);

-- -----------------------------------------------------------------------------
-- Business date & document numbering
-- -----------------------------------------------------------------------------
-- The business day a moment belongs to. Sales after midnight but before the
-- branch cutoff count for the previous day. Once a day is closed, new activity
-- rolls into the next day automatically — closing never blocks selling.
create or replace function app.business_date(p_branch uuid, p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  with base as (
    select ((p_at at time zone b.timezone) - b.day_cutoff::interval)::date as d
    from app.branches b where b.id = p_branch
  )
  select case when exists (select 1 from app.day_closes dc
                            where dc.branch_id = p_branch and dc.business_date = base.d and dc.status = 'closed')
              then base.d + 1 else base.d end
  from base
$$;

create table app.doc_sequences (
  tenant_id   uuid not null,
  branch_id   uuid not null,
  doc_type    text not null,
  period      text not null,
  last_value  bigint not null default 0,
  primary key (branch_id, doc_type, period),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id) on delete cascade
);

-- Gap-free within a transaction: a rollback also rolls back the counter.
create or replace function app.next_doc_no(p_branch uuid, p_doc_type text, p_period text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into app.doc_sequences as s (tenant_id, branch_id, doc_type, period, last_value)
  select b.tenant_id, b.id, p_doc_type, p_period, 1 from app.branches b where b.id = p_branch
  on conflict (branch_id, doc_type, period) do update set last_value = s.last_value + 1
  returning last_value into v;
  return v;
end;
$$;

create or replace function app.assert_period_open(p_branch uuid, p_date date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.day_closes d
              where d.branch_id = p_branch and d.business_date = p_date and d.status = 'closed') then
    perform app.raise_error('PERIOD_CLOSED', jsonb_build_object('business_date', p_date));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Manager approvals by PIN (for actions beyond the actor's permissions/limits)
-- -----------------------------------------------------------------------------
create table app.approvals (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null,
  branch_id     uuid,
  action        text not null,
  target_type   text,
  target_id     uuid,
  requested_by  uuid,
  approved_by   uuid not null,
  reason        text,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create index approvals_tenant_time on app.approvals (tenant_id, created_at desc);

create or replace function app.set_member_pin(p_membership uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m app.memberships;
begin
  select * into m from app.memberships where id = p_membership;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  if m.id <> coalesce(app.actor_membership_id(m.tenant_id), '00000000-0000-0000-0000-000000000000'::uuid) then
    perform app.assert_permission(m.tenant_id, 'staff.manage');
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    perform app.raise_error('PIN_FORMAT', jsonb_build_object('min', 4, 'max', 6));
  end if;
  if exists (select 1 from app.memberships o
              where o.tenant_id = m.tenant_id and o.id <> m.id and o.status = 'active'
                and o.pin_hash is not null and o.pin_hash = extensions.crypt(p_pin, o.pin_hash)) then
    perform app.raise_error('PIN_IN_USE');
  end if;
  update app.memberships set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) where id = m.id;
end;
$$;

-- Used by the API for "สลับผู้ใช้ด้วย PIN" on shared devices. Returns the membership.
create or replace function app.verify_pin(p_tenant uuid, p_branch uuid, p_pin text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from app.memberships m
  where m.tenant_id = p_tenant and m.status = 'active' and m.pin_hash is not null
    and m.pin_hash = extensions.crypt(p_pin, m.pin_hash)
    and (m.all_branches or exists (select 1 from app.membership_branches mb where mb.membership_id = m.id and mb.branch_id = p_branch))
  limit 1
$$;

create or replace function app.request_approval(
  p_branch uuid, p_permission text, p_approver_pin text,
  p_target_type text default null, p_target_id uuid default null, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid;
  approver uuid;
  v_id uuid;
begin
  select tenant_id into t from app.branches where id = p_branch;
  if t is null or t not in (select app.user_tenant_ids()) then perform app.raise_error('NOT_FOUND'); end if;
  approver := app.verify_pin(t, p_branch, p_approver_pin);
  if approver is null then perform app.raise_error('APPROVAL_PIN_INVALID'); end if;
  if not exists (
    select 1 from app.memberships m join app.roles r on r.id = m.role_id
     where m.id = approver
       and (r.grants_all or exists (select 1 from app.role_permissions rp where rp.role_id = r.id and rp.permission_key = p_permission))
  ) then
    perform app.raise_error('APPROVER_NOT_ALLOWED', jsonb_build_object('permission', p_permission));
  end if;
  insert into app.approvals (tenant_id, branch_id, action, target_type, target_id, requested_by, approved_by, reason)
  values (t, p_branch, p_permission, p_target_type, p_target_id, app.actor_membership_id(t), approver, p_reason)
  returning approvals.id into v_id;
  return v_id;
end;
$$;

-- Validates and burns a one-time approval; returns the approving membership.
create or replace function app.consume_approval(p_tenant uuid, p_permission text, p_approval uuid, p_target uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a app.approvals;
begin
  if p_approval is null then
    perform app.raise_error('APPROVAL_REQUIRED', jsonb_build_object('permission', p_permission));
  end if;
  update app.approvals set consumed_at = now()
   where id = p_approval and tenant_id = p_tenant and action = p_permission and consumed_at is null
     and created_at > now() - interval '5 minutes'
     and (target_id is null or p_target is null or target_id = p_target)
  returning * into a;
  if not found then
    perform app.raise_error('APPROVAL_INVALID');
  end if;
  return a.approved_by;
end;
$$;

-- Actor has the permission, or presents a fresh unused approval for it.
create or replace function app.authorize(p_tenant uuid, p_branch uuid, p_permission text, p_approval uuid, p_target uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.has_permission(p_tenant, p_permission, p_branch) then
    return app.actor_membership_id(p_tenant);
  end if;
  return app.consume_approval(p_tenant, p_permission, p_approval, p_target);
end;
$$;

-- -----------------------------------------------------------------------------
-- Shifts (cash drawer sessions)
-- -----------------------------------------------------------------------------
create table app.shifts (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null,
  branch_id            uuid not null,
  device_id            uuid,
  business_date        date not null,
  status               text not null default 'open' check (status in ('open','closed')),
  opening_float        numeric(14,2) not null default 0 check (opening_float >= 0),
  expected_cash        numeric(14,2),
  counted_cash         numeric(14,2),
  cash_variance        numeric(14,2),
  denominations        jsonb,
  opened_by            uuid,
  opened_at            timestamptz not null default now(),
  closed_by            uuid,
  closed_at            timestamptz,
  note                 text,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, device_id) references app.devices(tenant_id, id)
);
create unique index shifts_one_open_per_device on app.shifts (branch_id, coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';

create table app.cash_movements (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  shift_id    uuid not null,
  kind        text not null check (kind in ('pay_in','pay_out','drop')),
  amount      numeric(14,2) not null check (amount > 0),
  reason      text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, shift_id) references app.shifts(tenant_id, id)
);

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------
create table app.orders (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null,
  branch_id            uuid not null,
  channel_id           uuid not null,
  table_id             uuid,
  shift_id             uuid,
  device_id            uuid,
  order_no             text not null,
  receipt_no           text,
  status               text not null default 'open' check (status in ('open','paid','voided','refunded')),
  business_date        date not null,
  guest_count          int check (guest_count is null or guest_count between 1 and 500),
  customer_name        text,
  external_ref         text,
  note                 text,
  -- Pricing snapshot — history must not move when settings change.
  prices_include_vat   boolean not null,
  vat_rate             numeric(5,4) not null,
  service_charge_rate  numeric(5,4) not null default 0,
  commission_rate      numeric(6,4) not null default 0,
  commission_vat       boolean not null default true,
  -- Totals
  items_total          numeric(14,2) not null default 0,
  discount_type        text check (discount_type in ('percent','amount')),
  discount_value       numeric(14,4),
  discount_reason      text,
  discount_total       numeric(14,2) not null default 0,
  service_charge       numeric(14,2) not null default 0,
  vat_amount           numeric(14,2) not null default 0,
  rounding             numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  commission_amount    numeric(14,2) not null default 0,
  commission_vat_amount numeric(14,2) not null default 0,
  cost_total           numeric(14,4),
  opened_by            uuid,
  opened_at            timestamptz not null default now(),
  paid_by              uuid,
  paid_at              timestamptz,
  voided_by            uuid,
  voided_at            timestamptz,
  void_reason          text,
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, channel_id) references app.sales_channels(tenant_id, id),
  foreign key (tenant_id, table_id) references app.dining_tables(tenant_id, id),
  foreign key (tenant_id, shift_id) references app.shifts(tenant_id, id)
);
create index orders_branch_date on app.orders (branch_id, business_date, status);
create index orders_tenant_date on app.orders (tenant_id, business_date);
create index orders_open_tables on app.orders (table_id) where status = 'open';
create unique index orders_receipt_no on app.orders (branch_id, receipt_no) where receipt_no is not null;
create unique index orders_external_ref on app.orders (channel_id, external_ref) where external_ref is not null;
create trigger orders_touch before update on app.orders for each row execute function app.touch_versioned_row();

create table app.order_items (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null,
  order_id         uuid not null,
  menu_item_id     uuid not null,
  name             text not null,
  qty              numeric(10,3) not null check (qty > 0),
  unit_price       numeric(12,2) not null check (unit_price >= 0),
  modifiers_total  numeric(12,2) not null default 0,
  line_total       numeric(14,2) not null,
  cost_amount      numeric(14,4),
  note             text,
  kitchen_route    text not null default 'kitchen',
  station_id       uuid,
  status           text not null default 'pending' check (status in ('pending','sent','ready','served','voided')),
  sent_at          timestamptz,
  voided_by        uuid,
  voided_at        timestamptz,
  void_reason      text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references app.orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, menu_item_id) references app.menu_items(tenant_id, id)
);
create index order_items_order on app.order_items (order_id);
create index order_items_menu_item on app.order_items (menu_item_id);

create table app.order_item_modifiers (
  id                  uuid primary key default app.uuid_v7(),
  tenant_id           uuid not null,
  order_item_id       uuid not null,
  modifier_option_id  uuid not null,
  name                text not null,
  price_delta         numeric(12,2) not null default 0,
  foreign key (tenant_id, order_item_id) references app.order_items(tenant_id, id) on delete cascade,
  foreign key (tenant_id, modifier_option_id) references app.modifier_options(tenant_id, id)
);
create index order_item_modifiers_item on app.order_item_modifiers (order_item_id);

create table app.payments (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  branch_id      uuid not null,
  order_id       uuid not null,
  shift_id       uuid,
  method_id      uuid not null,
  kind           text not null default 'payment' check (kind in ('payment','refund')),
  amount         numeric(14,2) not null check (amount > 0),
  tendered       numeric(14,2),
  change_given   numeric(14,2) not null default 0,
  fee_amount     numeric(14,2) not null default 0,
  reference      text,
  business_date  date not null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, order_id) references app.orders(tenant_id, id),
  foreign key (tenant_id, method_id) references app.payment_methods(tenant_id, id),
  foreign key (tenant_id, shift_id) references app.shifts(tenant_id, id)
);
create index payments_order on app.payments (order_id);
create index payments_branch_date on app.payments (branch_id, business_date, method_id);
create trigger payments_immutable before update or delete on app.payments
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Kitchen
-- -----------------------------------------------------------------------------
create table app.kitchen_tickets (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  branch_id   uuid not null,
  order_id    uuid not null,
  station_id  uuid not null,
  ticket_no   text not null,
  status      text not null default 'new' check (status in ('new','in_progress','ready','served','cancelled')),
  priority    int not null default 0,
  fired_at    timestamptz not null default now(),
  started_at  timestamptz,
  ready_at    timestamptz,
  served_at   timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, order_id) references app.orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, station_id) references app.kitchen_stations(tenant_id, id)
);
create index kitchen_tickets_active on app.kitchen_tickets (station_id, fired_at) where status in ('new','in_progress');

create table app.kitchen_ticket_items (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  ticket_id      uuid not null,
  order_item_id  uuid not null,
  name           text not null,
  qty            numeric(10,3) not null,
  modifiers      text,
  note           text,
  status         text not null default 'pending' check (status in ('pending','done','voided')),
  done_at        timestamptz,
  foreign key (tenant_id, ticket_id) references app.kitchen_tickets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_item_id) references app.order_items(tenant_id, id) on delete cascade
);
create index kitchen_ticket_items_ticket on app.kitchen_ticket_items (ticket_id);

-- -----------------------------------------------------------------------------
-- RLS (documents are written only through the commands below)
-- -----------------------------------------------------------------------------
call app.apply_tenant_rls('app.doc_sequences', 'settings.manage');
call app.apply_tenant_rls('app.day_closes', null, null, 'branch_id');
call app.apply_tenant_rls('app.approvals', 'audit.view', null, 'branch_id');
call app.apply_tenant_rls('app.shifts', null, null, 'branch_id');
call app.apply_tenant_rls('app.cash_movements', 'pos.manage_shift');
call app.apply_tenant_rls('app.orders', null, null, 'branch_id');
call app.apply_tenant_rls('app.order_items', null);
call app.apply_tenant_rls('app.order_item_modifiers', null);
call app.apply_tenant_rls('app.payments', null, null, 'branch_id');
call app.apply_tenant_rls('app.kitchen_tickets', null, null, 'branch_id');
call app.apply_tenant_rls('app.kitchen_ticket_items', null);

-- =============================================================================
-- Commands
-- =============================================================================

create or replace function app.open_shift(p_branch uuid, p_opening_float numeric, p_device uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid;
  sid uuid;
begin
  select tenant_id into t from app.branches where id = p_branch;
  if t is null then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(t, 'pos.pay', p_branch);
  if exists (select 1 from app.shifts s where s.branch_id = p_branch and s.status = 'open'
              and s.device_id is not distinct from p_device) then
    perform app.raise_error('SHIFT_ALREADY_OPEN');
  end if;
  insert into app.shifts (tenant_id, branch_id, device_id, business_date, opening_float, opened_by)
  values (t, p_branch, p_device, app.business_date(p_branch), coalesce(p_opening_float, 0), app.actor_membership_id(t))
  returning id into sid;
  perform app.emit_event(t, p_branch, 'shift', sid, 'shift.opened', jsonb_build_object('opening_float', p_opening_float));
  return sid;
end;
$$;

create or replace function app.shift_expected_cash(p_shift uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select s.opening_float
    + coalesce((select sum(case when p.kind = 'payment' then p.amount else -p.amount end)
                  from app.payments p join app.payment_methods m on m.id = p.method_id
                 where p.shift_id = s.id and m.kind = 'cash'), 0)
    + coalesce((select sum(case when c.kind = 'pay_in' then c.amount else -c.amount end)
                  from app.cash_movements c where c.shift_id = s.id), 0)
  from app.shifts s where s.id = p_shift
$$;

create or replace function app.record_cash_movement(p_shift uuid, p_kind text, p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app.shifts;
  v_id uuid;
begin
  select * into s from app.shifts where shifts.id = p_shift;
  if not found or s.status <> 'open' then perform app.raise_error('SHIFT_NOT_OPEN'); end if;
  perform app.assert_permission(s.tenant_id, 'pos.manage_shift', s.branch_id);
  insert into app.cash_movements (tenant_id, shift_id, kind, amount, reason, created_by)
  values (s.tenant_id, s.id, p_kind, p_amount, p_reason, app.actor_membership_id(s.tenant_id))
  returning cash_movements.id into v_id;
  return v_id;
end;
$$;

create or replace function app.close_shift(p_shift uuid, p_counted_cash numeric, p_denominations jsonb default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app.shifts;
  expected numeric;
begin
  select * into s from app.shifts where id = p_shift for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  if s.status <> 'open' then perform app.raise_error('SHIFT_NOT_OPEN'); end if;
  perform app.assert_permission(s.tenant_id, 'pos.pay', s.branch_id);
  expected := app.shift_expected_cash(p_shift);
  update app.shifts
     set status = 'closed', expected_cash = expected, counted_cash = p_counted_cash,
         cash_variance = p_counted_cash - expected, denominations = p_denominations,
         closed_by = app.actor_membership_id(s.tenant_id), closed_at = now(), note = p_note
   where id = p_shift;
  perform app.emit_event(s.tenant_id, s.branch_id, 'shift', s.id, 'shift.closed',
    jsonb_build_object('expected', expected, 'counted', p_counted_cash, 'variance', p_counted_cash - expected));
  return jsonb_build_object('expected_cash', expected, 'counted_cash', p_counted_cash, 'variance', p_counted_cash - expected);
end;
$$;

-- Round half away from zero to satang — mirrored exactly by packages/domain/src/pricing.ts
-- (parity is asserted by the API integration tests).
create or replace function app.recalc_order(p_order uuid)
returns app.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o            app.orders;
  t            app.tenants;
  v_items      numeric;
  v_disc       numeric;
  v_net        numeric;
  v_sc         numeric;
  v_vat        numeric;
  v_total      numeric;
  v_commission numeric;
begin
  select * into o from app.orders where id = p_order for update;
  select * into t from app.tenants where id = o.tenant_id;

  select coalesce(sum(line_total), 0) into v_items
    from app.order_items where order_id = o.id and status <> 'voided';

  v_disc := case o.discount_type
              when 'percent' then round(v_items * least(greatest(o.discount_value, 0), 100) / 100, 2)
              when 'amount'  then least(round(greatest(o.discount_value, 0), 2), v_items)
              else 0 end;
  v_net := v_items - v_disc;
  v_sc := round(v_net * o.service_charge_rate, 2);

  if o.vat_rate = 0 then
    v_vat := 0;
    v_total := v_net + v_sc;
  elsif o.prices_include_vat then
    v_total := v_net + v_sc;
    v_vat := round(v_total * o.vat_rate / (1 + o.vat_rate), 2);
  else
    v_vat := round((v_net + v_sc) * o.vat_rate, 2);
    v_total := v_net + v_sc + v_vat;
  end if;

  v_commission := round(v_net * o.commission_rate, 2);

  update app.orders
     set items_total = v_items, discount_total = v_disc, service_charge = v_sc, vat_amount = v_vat,
         total = v_total + o.rounding, commission_amount = v_commission,
         commission_vat_amount = case when o.commission_vat then round(v_commission * 0.07, 2) else 0 end
   where id = o.id
  returning * into o;
  return o;
end;
$$;

-- Route pending items to stations and create KDS tickets.
create or replace function app.fire_order(p_order uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  st record;
  tid uuid;
  fired int := 0;
begin
  select * into o from app.orders where id = p_order;

  -- Resolve station per pending item (route match → default 'kitchen' station → none).
  update app.order_items oi
     set station_id = coalesce(
           (select ks.id from app.kitchen_stations ks where ks.branch_id = o.branch_id and ks.route_key = oi.kitchen_route and ks.is_active),
           (select ks.id from app.kitchen_stations ks where ks.branch_id = o.branch_id and ks.route_key = 'kitchen' and ks.is_active))
   where oi.order_id = o.id and oi.status = 'pending';

  for st in
    select distinct oi.station_id from app.order_items oi
     where oi.order_id = o.id and oi.status = 'pending' and oi.station_id is not null
  loop
    insert into app.kitchen_tickets (tenant_id, branch_id, order_id, station_id, ticket_no)
    values (o.tenant_id, o.branch_id, o.id, st.station_id, o.order_no)
    returning id into tid;

    insert into app.kitchen_ticket_items (tenant_id, ticket_id, order_item_id, name, qty, modifiers, note)
    select o.tenant_id, tid, oi.id, oi.name, oi.qty,
           (select string_agg(m.name, ', ' order by m.name) from app.order_item_modifiers m where m.order_item_id = oi.id),
           oi.note
      from app.order_items oi
     where oi.order_id = o.id and oi.status = 'pending' and oi.station_id = st.station_id;

    perform app.emit_event(o.tenant_id, o.branch_id, 'kitchen_ticket', tid, 'kitchen.ticket_fired',
      jsonb_build_object('order_id', o.id, 'station_id', st.station_id, 'ticket_no', o.order_no));
    fired := fired + 1;
  end loop;

  -- Items with nowhere to be prepared (e.g. bottled drinks) are served immediately.
  update app.order_items set status = case when station_id is null then 'served' else 'sent' end, sent_at = now()
   where order_id = o.id and status = 'pending';

  return fired;
end;
$$;

-- Create or extend an order. Idempotent per order id and per item id.
create or replace function app.submit_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch   uuid := (p->>'branch_id')::uuid;
  v_order_id uuid := coalesce((p->>'id')::uuid, app.uuid_v7());
  t          app.tenants;
  b          app.branches;
  ch         app.sales_channels;
  o          app.orders;
  actor      uuid;
  it         jsonb;
  mi         app.menu_items;
  v_item_id  uuid;
  v_price    numeric;
  v_mods     numeric;
  v_qty      numeric;
  v_opts     uuid[];
  g          record;
  bd         date;
begin
  select * into b from app.branches where id = v_branch;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'branch')); end if;
  select * into t from app.tenants where id = b.tenant_id;
  perform app.assert_permission(t.id, 'pos.order', b.id);
  actor := app.actor_membership_id(t.id);

  select * into o from app.orders where id = v_order_id for update;
  if found then
    if o.tenant_id <> t.id or o.branch_id <> b.id then perform app.raise_error('NOT_FOUND'); end if;
    if o.status <> 'open' then perform app.raise_error('ORDER_NOT_OPEN', jsonb_build_object('status', o.status)); end if;
    if p ? 'expected_version' and (p->>'expected_version')::int <> o.version then
      perform app.raise_error('STALE_VERSION', jsonb_build_object('current', o.version));
    end if;
  else
    select * into ch from app.sales_channels where id = (p->>'channel_id')::uuid and tenant_id = t.id and is_active;
    if not found then perform app.raise_error('CHANNEL_NOT_FOUND'); end if;
    bd := app.business_date(b.id);
    perform app.assert_period_open(b.id, bd);
    insert into app.orders (
      id, tenant_id, branch_id, channel_id, table_id, device_id, shift_id, order_no, business_date,
      guest_count, customer_name, external_ref, note,
      prices_include_vat, vat_rate, service_charge_rate, commission_rate, commission_vat, opened_by)
    values (
      v_order_id, t.id, b.id, ch.id, nullif(p->>'table_id', '')::uuid, nullif(p->>'device_id', '')::uuid,
      (select s.id from app.shifts s where s.branch_id = b.id and s.status = 'open' order by s.opened_at desc limit 1),
      lpad(app.next_doc_no(b.id, 'order', bd::text)::text, 3, '0'), bd,
      nullif(p->>'guest_count', '')::int, nullif(p->>'customer_name', ''), nullif(p->>'external_ref', ''), nullif(p->>'note', ''),
      t.prices_include_vat, case when t.vat_registered then t.vat_rate else 0 end,
      case when ch.applies_service_charge then b.service_charge_rate else 0 end,
      app.channel_commission_rate(ch.id, bd), ch.commission_vat_applies, actor)
    returning * into o;
    perform app.emit_event(t.id, b.id, 'order', o.id, 'order.opened', jsonb_build_object('order_no', o.order_no, 'channel_id', ch.id));
  end if;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb))
  loop
    v_item_id := coalesce((it->>'id')::uuid, app.uuid_v7());
    continue when exists (select 1 from app.order_items where id = v_item_id);

    select * into mi from app.menu_items
     where id = (it->>'menu_item_id')::uuid and tenant_id = t.id and is_active and archived_at is null;
    if not found then perform app.raise_error('MENU_ITEM_NOT_FOUND', jsonb_build_object('menu_item_id', it->>'menu_item_id')); end if;
    if exists (select 1 from app.menu_item_availability a
                where a.menu_item_id = mi.id and a.branch_id = b.id
                  and (not a.is_available or (a.sold_out_until is not null and a.sold_out_until > now()))) then
      perform app.raise_error('MENU_ITEM_SOLD_OUT', jsonb_build_object('name', mi.name));
    end if;

    v_qty := coalesce((it->>'qty')::numeric, 1);
    if v_qty <= 0 or v_qty > 999 then perform app.raise_error('INVALID_QTY'); end if;

    select coalesce(array_agg(x::uuid), '{}') into v_opts
      from jsonb_array_elements_text(coalesce(it->'modifier_option_ids', '[]'::jsonb)) x;

    -- Every option must belong to a group attached to this item…
    if exists (select 1 from unnest(v_opts) oid
                where not exists (select 1 from app.modifier_options mo
                                    join app.menu_item_modifier_groups mg on mg.group_id = mo.group_id and mg.menu_item_id = mi.id
                                   where mo.id = oid and mo.is_active)) then
      perform app.raise_error('INVALID_MODIFIER', jsonb_build_object('name', mi.name));
    end if;
    -- …and each group's min/max must hold.
    for g in
      select mgp.id, mgp.name, mgp.min_select, mgp.max_select,
             (select count(*) from app.modifier_options mo where mo.group_id = mgp.id and mo.id = any(v_opts)) as picked
        from app.menu_item_modifier_groups mg join app.modifier_groups mgp on mgp.id = mg.group_id
       where mg.menu_item_id = mi.id
    loop
      if g.picked < g.min_select or g.picked > g.max_select then
        perform app.raise_error('MODIFIER_SELECTION', jsonb_build_object('group', g.name, 'min', g.min_select, 'max', g.max_select));
      end if;
    end loop;

    v_price := app.resolve_menu_price(mi.id, o.channel_id, b.id);
    select coalesce(sum(mo.price_delta), 0) into v_mods from app.modifier_options mo where mo.id = any(v_opts);

    insert into app.order_items (id, tenant_id, order_id, menu_item_id, name, qty, unit_price, modifiers_total,
                                 line_total, note, kitchen_route, created_by)
    values (v_item_id, t.id, o.id, mi.id, mi.name, v_qty, v_price, v_mods,
            round(v_qty * (v_price + v_mods), 2), nullif(it->>'note', ''), mi.kitchen_route, actor);

    insert into app.order_item_modifiers (tenant_id, order_item_id, modifier_option_id, name, price_delta)
    select t.id, v_item_id, mo.id, mo.name, mo.price_delta from app.modifier_options mo where mo.id = any(v_opts);
  end loop;

  o := app.recalc_order(o.id);

  if coalesce((p->>'fire')::boolean, true) then
    perform app.fire_order(o.id);
  end if;

  return jsonb_build_object('id', o.id, 'order_no', o.order_no, 'status', o.status, 'version', o.version,
                            'items_total', o.items_total, 'discount_total', o.discount_total,
                            'service_charge', o.service_charge, 'vat_amount', o.vat_amount, 'total', o.total);
end;
$$;

-- Max discount rate a person may give (membership.limits.max_discount_rate, default 100%).
create or replace function app.discount_cap(p_membership uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((m.limits->>'max_discount_rate')::numeric, 1) from app.memberships m where m.id = p_membership
$$;

create or replace function app.apply_order_discount(p_order uuid, p_type text, p_value numeric, p_reason text, p_approval uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o        app.orders;
  who      uuid;
  eff_rate numeric;
begin
  select * into o from app.orders where id = p_order for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  if o.status <> 'open' then perform app.raise_error('ORDER_NOT_OPEN'); end if;
  if p_type not in ('percent','amount') or p_value < 0 or (p_type = 'percent' and p_value > 100) then
    perform app.raise_error('INVALID_DISCOUNT');
  end if;
  if coalesce(trim(p_reason), '') = '' then perform app.raise_error('REASON_REQUIRED'); end if;

  eff_rate := case when p_type = 'percent' then p_value / 100
                   when o.items_total > 0 then p_value / o.items_total else 0 end;

  -- Within your own cap → just do it. Above it (or without the permission) → a
  -- manager approves by PIN, and the cap that applies is the approver's.
  if app.has_permission(o.tenant_id, 'pos.discount', o.branch_id)
     and eff_rate <= app.discount_cap(app.actor_membership_id(o.tenant_id)) then
    who := app.actor_membership_id(o.tenant_id);
  else
    who := app.consume_approval(o.tenant_id, 'pos.discount', p_approval, o.id);
    if eff_rate > app.discount_cap(who) then
      perform app.raise_error('DISCOUNT_OVER_LIMIT', jsonb_build_object('max_rate', app.discount_cap(who)));
    end if;
  end if;

  update app.orders set discount_type = p_type, discount_value = p_value, discount_reason = p_reason where id = o.id;
  o := app.recalc_order(o.id);
  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.discounted',
    jsonb_build_object('type', p_type, 'value', p_value, 'reason', p_reason, 'approved_by', who), app.actor_membership_id(o.tenant_id));
  return jsonb_build_object('id', o.id, 'discount_total', o.discount_total, 'total', o.total, 'version', o.version);
end;
$$;

create or replace function app.void_order_item(p_item uuid, p_reason text, p_approval uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  oi app.order_items;
  o app.orders;
  who uuid;
begin
  select * into oi from app.order_items where id = p_item for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  select * into o from app.orders where id = oi.order_id for update;
  perform app.assert_permission(o.tenant_id, 'pos.order', o.branch_id);
  if o.status <> 'open' then perform app.raise_error('ORDER_NOT_OPEN'); end if;
  if oi.status = 'voided' then
    return jsonb_build_object('id', o.id, 'total', o.total, 'version', o.version);
  end if;
  if coalesce(trim(p_reason), '') = '' then perform app.raise_error('REASON_REQUIRED'); end if;

  -- Removing an item nobody has started on is a normal correction; after the
  -- kitchen has it, it is a void that needs the permission or an approval.
  if oi.status = 'pending' then
    perform app.assert_permission(o.tenant_id, 'pos.order', o.branch_id);
    who := app.actor_membership_id(o.tenant_id);
  else
    who := app.authorize(o.tenant_id, o.branch_id, 'pos.void', p_approval, oi.id);
  end if;

  update app.order_items set status = 'voided', voided_by = who, voided_at = now(), void_reason = p_reason where id = oi.id;
  update app.kitchen_ticket_items set status = 'voided' where order_item_id = oi.id;
  o := app.recalc_order(o.id);
  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.item_voided',
    jsonb_build_object('order_item_id', oi.id, 'name', oi.name, 'reason', p_reason, 'was_sent', oi.status <> 'pending', 'approved_by', who),
    app.actor_membership_id(o.tenant_id));
  return jsonb_build_object('id', o.id, 'total', o.total, 'version', o.version);
end;
$$;

create or replace function app.void_order(p_order uuid, p_reason text, p_approval uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  who uuid;
begin
  select * into o from app.orders where id = p_order for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(o.tenant_id, 'pos.order', o.branch_id);
  if o.status = 'voided' then return; end if;
  if o.status <> 'open' then perform app.raise_error('ORDER_NOT_OPEN'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.raise_error('REASON_REQUIRED'); end if;
  if exists (select 1 from app.order_items where order_id = o.id and status not in ('pending','voided')) then
    who := app.authorize(o.tenant_id, o.branch_id, 'pos.void', p_approval, o.id);
  else
    perform app.assert_permission(o.tenant_id, 'pos.order', o.branch_id);
    who := app.actor_membership_id(o.tenant_id);
  end if;
  update app.order_items set status = 'voided', voided_by = who, voided_at = now(), void_reason = p_reason
   where order_id = o.id and status <> 'voided';
  update app.kitchen_ticket_items ti set status = 'voided'
    from app.kitchen_tickets kt where kt.id = ti.ticket_id and kt.order_id = o.id;
  update app.kitchen_tickets set status = 'cancelled' where order_id = o.id and status in ('new','in_progress');
  update app.orders set status = 'voided', voided_by = who, voided_at = now(), void_reason = p_reason where id = o.id;
  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.voided',
    jsonb_build_object('reason', p_reason, 'approved_by', who), app.actor_membership_id(o.tenant_id));
end;
$$;

-- Consume stock for a paid order (recipes exploded, preps expanded).
create or replace function app.consume_order_stock(p_order uuid, p_direction int default -1, p_reason text default 'sale')
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  loc uuid;
  v_cost numeric := 0;
  bd date;
begin
  select * into o from app.orders where id = p_order;
  select id into loc from app.stock_locations where branch_id = o.branch_id and is_default;
  if loc is null then return 0; end if;
  bd := case when p_direction < 0 then o.business_date else app.business_date(o.branch_id) end;

  -- Record theoretical cost per line for margin reporting.
  update app.order_items oi
     set cost_amount = round(oi.qty * app.menu_item_cost(
           oi.menu_item_id,
           coalesce((select array_agg(m.modifier_option_id) from app.order_item_modifiers m where m.order_item_id = oi.id), '{}'),
           loc), 4)
   where oi.order_id = o.id and oi.status <> 'voided' and p_direction < 0;

  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, source_type, source_id, business_date, created_by)
  select o.tenant_id, o.branch_id, loc, x.ingredient_id, p_direction * sum(x.qty), p_reason, 'order', o.id, bd, app.actor_membership_id(o.tenant_id)
  from (
    select e.ingredient_id, e.qty
      from app.order_items oi
      join app.recipes r on r.menu_item_id = oi.menu_item_id and r.is_current and r.kind = 'menu_item'
      cross join lateral app.explode_recipe(r.id, oi.qty) e
     where oi.order_id = o.id and oi.status <> 'voided'
    union all
    select e.ingredient_id, e.qty
      from app.order_items oi
      join app.order_item_modifiers m on m.order_item_id = oi.id
      join app.recipes r on r.modifier_option_id = m.modifier_option_id and r.is_current and r.kind = 'modifier_option'
      cross join lateral app.explode_recipe(r.id, oi.qty) e
     where oi.order_id = o.id and oi.status <> 'voided'
  ) x
  group by x.ingredient_id
  having sum(x.qty) <> 0;

  select coalesce(-sum(sm.total_cost), 0) into v_cost
    from app.stock_movements sm where sm.source_type = 'order' and sm.source_id = o.id and sm.reason = 'sale';
  return v_cost;
end;
$$;

-- Take payment(s). p_payments: [{"method_id","amount","tendered"?,"reference"?}]
create or replace function app.pay_order(p_order uuid, p_payments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  t app.tenants;
  b app.branches;
  pay jsonb;
  pm app.payment_methods;
  paid numeric := 0;
  all_cash boolean := true;
  rounded numeric;
  v_amount numeric;
  v_tendered numeric;
  shift uuid;
  actor uuid;
  cost numeric;
begin
  select * into o from app.orders where id = p_order for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  -- Authorise first: even the idempotent answer below must not leak to outsiders.
  perform app.assert_permission(o.tenant_id, 'pos.pay', o.branch_id);
  if o.status = 'paid' then
    -- Idempotent retry from a flaky connection.
    return jsonb_build_object('id', o.id, 'status', o.status, 'receipt_no', o.receipt_no, 'total', o.total,
                              'change', (select coalesce(sum(change_given), 0) from app.payments where order_id = o.id));
  end if;
  if o.status <> 'open' then perform app.raise_error('ORDER_NOT_OPEN'); end if;
  if not exists (select 1 from app.order_items where order_id = o.id and status <> 'voided') then
    perform app.raise_error('ORDER_EMPTY');
  end if;
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) = 0 then perform app.raise_error('PAYMENT_REQUIRED'); end if;

  select * into t from app.tenants where id = o.tenant_id;
  select * into b from app.branches where id = o.branch_id;
  actor := app.actor_membership_id(o.tenant_id);
  select s.id into shift from app.shifts s where s.branch_id = o.branch_id and s.status = 'open' order by s.opened_at desc limit 1;

  for pay in select * from jsonb_array_elements(p_payments) loop
    select * into pm from app.payment_methods where id = (pay->>'method_id')::uuid and tenant_id = o.tenant_id and is_active;
    if not found then perform app.raise_error('PAYMENT_METHOD_NOT_FOUND'); end if;
    if pm.kind <> 'cash' then all_cash := false; end if;
    if pm.kind = 'cash' and shift is null then perform app.raise_error('SHIFT_REQUIRED'); end if;
    if pm.requires_reference and coalesce(pay->>'reference', '') = '' then
      perform app.raise_error('PAYMENT_REFERENCE_REQUIRED', jsonb_build_object('method', pm.name));
    end if;
  end loop;

  -- Cash rounding only when the whole bill is settled in cash.
  if all_cash and t.cash_rounding <> 'none' then
    rounded := round(o.total / t.cash_rounding::numeric) * t.cash_rounding::numeric;
    if rounded <> o.total then
      update app.orders set rounding = rounded - (total - rounding), total = rounded where id = o.id returning * into o;
    end if;
  end if;

  for pay in select * from jsonb_array_elements(p_payments) loop
    select * into pm from app.payment_methods where id = (pay->>'method_id')::uuid;
    v_amount := round((pay->>'amount')::numeric, 2);
    v_tendered := nullif(pay->>'tendered', '')::numeric;
    if v_amount is null or v_amount <= 0 then perform app.raise_error('INVALID_AMOUNT'); end if;
    if v_tendered is not null and (pm.kind <> 'cash' or v_tendered < v_amount) then
      perform app.raise_error('INVALID_TENDERED');
    end if;
    insert into app.payments (tenant_id, branch_id, order_id, shift_id, method_id, amount, tendered, change_given,
                              fee_amount, reference, business_date, created_by)
    values (o.tenant_id, o.branch_id, o.id, shift, pm.id, v_amount, v_tendered, coalesce(v_tendered - v_amount, 0),
            round(v_amount * pm.fee_rate + pm.fee_fixed, 2), nullif(pay->>'reference', ''), o.business_date, actor);
    paid := paid + v_amount;
  end loop;

  if paid <> o.total then
    perform app.raise_error('PAYMENT_TOTAL_MISMATCH', jsonb_build_object('total', o.total, 'paid', paid));
  end if;

  cost := app.consume_order_stock(o.id);

  update app.orders
     set status = 'paid', paid_by = actor, paid_at = now(), shift_id = coalesce(shift_id, shift), cost_total = cost,
         receipt_no = b.code || '-' || to_char(o.business_date, 'YYMM') || '-' ||
                      lpad(app.next_doc_no(o.branch_id, 'receipt', to_char(o.business_date, 'YYYYMM'))::text, 5, '0')
   where id = o.id
  returning * into o;

  -- Takeaway/delivery tickets still in the kitchen stay visible; dine-in keeps flowing.
  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.paid',
    jsonb_build_object('receipt_no', o.receipt_no, 'total', o.total, 'channel_id', o.channel_id, 'cost_total', cost), actor);

  return jsonb_build_object('id', o.id, 'status', o.status, 'receipt_no', o.receipt_no, 'total', o.total,
                            'change', (select coalesce(sum(change_given), 0) from app.payments where order_id = o.id));
end;
$$;

-- Full refund of a paid order (refund recorded on the day it happens).
create or replace function app.refund_order(p_order uuid, p_reason text, p_restock boolean default false, p_approval uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  who uuid;
  bd date;
  shift uuid;
begin
  select * into o from app.orders where id = p_order for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  if o.tenant_id not in (select app.user_tenant_ids()) then perform app.raise_error('PERMISSION_DENIED'); end if;
  if o.status = 'refunded' then return jsonb_build_object('id', o.id, 'status', o.status); end if;
  if o.status <> 'paid' then perform app.raise_error('ORDER_NOT_PAID'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.raise_error('REASON_REQUIRED'); end if;
  who := app.authorize(o.tenant_id, o.branch_id, 'pos.refund', p_approval, o.id);
  bd := app.business_date(o.branch_id);
  perform app.assert_period_open(o.branch_id, bd);
  select s.id into shift from app.shifts s where s.branch_id = o.branch_id and s.status = 'open' order by s.opened_at desc limit 1;

  insert into app.payments (tenant_id, branch_id, order_id, shift_id, method_id, kind, amount, fee_amount, reference, business_date, created_by)
  select p.tenant_id, p.branch_id, p.order_id, coalesce(shift, p.shift_id), p.method_id, 'refund', p.amount - p.change_given,
         -p.fee_amount, 'refund:' || p.id, bd, who
    from app.payments p where p.order_id = o.id and p.kind = 'payment';

  if p_restock then
    perform app.consume_order_stock(o.id, 1, 'sale_void');
  end if;

  update app.orders set status = 'refunded', void_reason = p_reason where id = o.id;
  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.refunded',
    jsonb_build_object('reason', p_reason, 'restock', p_restock, 'approved_by', who, 'amount', o.total), app.actor_membership_id(o.tenant_id));
  return jsonb_build_object('id', o.id, 'status', 'refunded');
end;
$$;

-- KDS: move a ticket forward (or back, for "undo") through its lifecycle.
create or replace function app.set_ticket_status(p_ticket uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  kt app.kitchen_tickets;
begin
  select * into kt from app.kitchen_tickets where id = p_ticket for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(kt.tenant_id, 'kds.bump', kt.branch_id);
  if p_status not in ('new','in_progress','ready','served') then perform app.raise_error('INVALID_STATUS'); end if;
  if kt.status = 'cancelled' then perform app.raise_error('TICKET_CANCELLED'); end if;

  update app.kitchen_tickets
     set status = p_status,
         started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
         ready_at   = case when p_status = 'ready' then now() when p_status in ('new','in_progress') then null else ready_at end,
         served_at  = case when p_status = 'served' then now() else null end
   where id = kt.id;

  if p_status in ('ready','served') then
    update app.kitchen_ticket_items set status = 'done', done_at = coalesce(done_at, now())
     where ticket_id = kt.id and status = 'pending';
    update app.order_items oi set status = p_status
      from app.kitchen_ticket_items ti
     where ti.ticket_id = kt.id and ti.order_item_id = oi.id and oi.status <> 'voided';
  elsif kt.status in ('ready','served') then
    -- Recall: kitchen tapped "ready" by mistake.
    update app.kitchen_ticket_items set status = 'pending', done_at = null where ticket_id = kt.id and status = 'done';
    update app.order_items oi set status = 'sent'
      from app.kitchen_ticket_items ti
     where ti.ticket_id = kt.id and ti.order_item_id = oi.id and oi.status <> 'voided';
  end if;

  perform app.emit_event(kt.tenant_id, kt.branch_id, 'kitchen_ticket', kt.id, 'kitchen.ticket_' || p_status,
    jsonb_build_object('order_id', kt.order_id, 'station_id', kt.station_id), app.actor_membership_id(kt.tenant_id));
end;
$$;

create or replace function app.set_item_availability(p_menu_item uuid, p_branch uuid, p_available boolean, p_until timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid;
begin
  select tenant_id into t from app.menu_items where id = p_menu_item;
  if t is null then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(t, 'menu.availability', p_branch);
  insert into app.menu_item_availability (tenant_id, menu_item_id, branch_id, is_available, sold_out_until, updated_by)
  values (t, p_menu_item, p_branch, p_available, p_until, app.actor_membership_id(t))
  on conflict (menu_item_id, branch_id) do update
    set is_available = excluded.is_available, sold_out_until = excluded.sold_out_until, updated_by = excluded.updated_by;
  perform app.emit_event(t, p_branch, 'menu_item', p_menu_item, 'menu.availability_changed',
    jsonb_build_object('available', p_available, 'until', p_until));
end;
$$;
