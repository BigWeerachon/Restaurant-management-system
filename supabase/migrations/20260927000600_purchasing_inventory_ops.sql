-- =============================================================================
-- Sabai — Purchasing & inventory operations
--
-- Everyday tasks, each one command:
--   รับของเข้า   app.receive_goods()        (with or without a PO — market runs are common)
--   ของเสีย      app.record_waste()
--   นับสต็อก     app.start_stock_count() → app.record_count() → app.submit_stock_count() → app.approve_stock_count()
--   โอนย้าย      app.create_transfer() → app.send_transfer() → app.receive_transfer()
--   ผลิตของเตรียม app.produce_batch()
--   สั่งซื้อ      app.save_purchase_order() → app.set_purchase_order_status()
-- =============================================================================

create table app.suppliers (
  id                  uuid primary key default app.uuid_v7(),
  tenant_id           uuid not null references app.tenants(id) on delete cascade,
  name                text not null check (length(trim(name)) between 1 and 120),
  contact_name        text,
  phone               text,
  line_id             text,
  email               text,
  tax_id              text check (tax_id is null or tax_id ~ '^[0-9]{13}$'),
  payment_terms_days  int not null default 0 check (payment_terms_days between 0 and 180),
  lead_time_days      int not null default 1 check (lead_time_days between 0 and 60),
  order_days          int[] not null default '{}',
  note                text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id)
);
create trigger suppliers_touch before update on app.suppliers for each row execute function app.touch_row();

-- What a supplier sells us and in which pack ("ถุง 1 กก." = 1000 g).
create table app.supplier_items (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  supplier_id    uuid not null,
  ingredient_id  uuid not null,
  supplier_sku   text,
  pack_name      text not null,
  pack_qty       numeric(18,4) not null check (pack_qty > 0),
  last_price     numeric(14,4),
  is_preferred   boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (supplier_id, ingredient_id, pack_name),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id) on delete cascade
);
create unique index supplier_items_one_preferred on app.supplier_items (ingredient_id) where is_preferred;

create table app.purchase_orders (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  branch_id      uuid not null,
  location_id    uuid not null,
  supplier_id    uuid not null,
  po_no          text not null,
  status         text not null default 'draft'
                 check (status in ('draft','submitted','approved','sent','partially_received','received','cancelled')),
  expected_date  date,
  subtotal       numeric(14,2) not null default 0,
  vat_amount     numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  note           text,
  created_by     uuid,
  approved_by    uuid,
  approved_at    timestamptz,
  version        int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, po_no),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, location_id) references app.stock_locations(tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id)
);
create index purchase_orders_open on app.purchase_orders (branch_id, status) where status not in ('received','cancelled');
create trigger purchase_orders_touch before update on app.purchase_orders for each row execute function app.touch_versioned_row();

create table app.purchase_order_lines (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  po_id           uuid not null,
  ingredient_id   uuid not null,
  pack_name       text not null,
  pack_qty        numeric(18,4) not null check (pack_qty > 0),
  qty_packs       numeric(14,3) not null check (qty_packs > 0),
  unit_price      numeric(14,4) not null check (unit_price >= 0),
  line_total      numeric(14,2) not null,
  received_packs  numeric(14,3) not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, po_id) references app.purchase_orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id)
);
create index purchase_order_lines_po on app.purchase_order_lines (po_id);

create table app.goods_receipts (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  branch_id       uuid not null,
  location_id     uuid not null,
  supplier_id     uuid,
  po_id           uuid,
  gr_no           text not null,
  business_date   date not null,
  received_at     timestamptz not null default now(),
  invoice_no      text,
  invoice_date    date,
  payment_mode    text not null default 'credit' check (payment_mode in ('credit','cash_paid','transfer_paid')),
  subtotal        numeric(14,2) not null default 0,
  vat_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  attachment_url  text,
  note            text,
  received_by     uuid,
  unique (tenant_id, id),
  unique (tenant_id, gr_no),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, location_id) references app.stock_locations(tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id),
  foreign key (tenant_id, po_id) references app.purchase_orders(tenant_id, id)
);
create index goods_receipts_branch_date on app.goods_receipts (branch_id, business_date);

create table app.goods_receipt_lines (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  gr_id           uuid not null,
  ingredient_id   uuid not null,
  po_line_id      uuid,
  pack_name       text not null,
  pack_qty        numeric(18,4) not null check (pack_qty > 0),
  qty_packs       numeric(14,3) not null check (qty_packs > 0),
  unit_price      numeric(14,4) not null check (unit_price >= 0),
  line_total      numeric(14,2) not null,
  base_qty        numeric(18,4) generated always as (qty_packs * pack_qty) stored,
  foreign key (tenant_id, gr_id) references app.goods_receipts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id),
  foreign key (tenant_id, po_line_id) references app.purchase_order_lines(tenant_id, id)
);
create index goods_receipt_lines_gr on app.goods_receipt_lines (gr_id);

call app.apply_tenant_rls('app.suppliers', 'purchasing.view', 'purchasing.manage');
call app.apply_tenant_rls('app.supplier_items', 'purchasing.view', 'purchasing.manage');
call app.apply_tenant_rls('app.purchase_orders', 'purchasing.view', null, 'branch_id');
call app.apply_tenant_rls('app.purchase_order_lines', 'purchasing.view');
call app.apply_tenant_rls('app.goods_receipts', 'inventory.view', null, 'branch_id');
call app.apply_tenant_rls('app.goods_receipt_lines', 'inventory.view');

-- Default stock location of a branch (created with the branch).
create or replace function app.default_location(p_branch uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from app.stock_locations where branch_id = p_branch and is_default
$$;

-- =============================================================================
-- Receiving
-- p: {branch_id, location_id?, supplier_id?, po_id?, invoice_no?, invoice_date?,
--     payment_mode?, vat_amount?, attachment_url?, note?,
--     lines: [{ingredient_id, pack_name?, pack_qty?, qty_packs, unit_price, po_line_id?}]}
-- =============================================================================
create or replace function app.receive_goods(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        app.branches;
  loc      uuid;
  gr       app.goods_receipts;
  ln       jsonb;
  ing      app.ingredients;
  v_pack_qty numeric;
  v_pack_name text;
  v_packs  numeric;
  v_price  numeric;
  v_unit_cost numeric;
  v_subtotal numeric := 0;
  v_vat    numeric;
  actor    uuid;
  bd       date;
  po       app.purchase_orders;
begin
  select * into b from app.branches where id = (p->>'branch_id')::uuid;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'branch')); end if;
  perform app.assert_permission(b.tenant_id, 'inventory.receive', b.id);
  actor := app.actor_membership_id(b.tenant_id);
  loc := coalesce(nullif(p->>'location_id', '')::uuid, app.default_location(b.id));
  if not exists (select 1 from app.stock_locations where id = loc and branch_id = b.id) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'location'));
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then perform app.raise_error('LINES_REQUIRED'); end if;
  bd := app.business_date(b.id);

  if p ? 'po_id' and nullif(p->>'po_id', '') is not null then
    select * into po from app.purchase_orders where id = (p->>'po_id')::uuid and tenant_id = b.tenant_id for update;
    if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'purchase_order')); end if;
    if po.status in ('received','cancelled','draft') then
      perform app.raise_error('PO_NOT_RECEIVABLE', jsonb_build_object('status', po.status));
    end if;
  end if;

  insert into app.goods_receipts (tenant_id, branch_id, location_id, supplier_id, po_id, gr_no, business_date,
                                  invoice_no, invoice_date, payment_mode, attachment_url, note, received_by)
  values (b.tenant_id, b.id, loc, coalesce(nullif(p->>'supplier_id', '')::uuid, po.supplier_id), po.id,
          'GR' || to_char(bd, 'YYMMDD') || '-' || lpad(app.next_doc_no(b.id, 'gr', bd::text)::text, 3, '0'),
          bd, nullif(p->>'invoice_no', ''), nullif(p->>'invoice_date', '')::date,
          coalesce(nullif(p->>'payment_mode', ''), 'credit'), nullif(p->>'attachment_url', ''), nullif(p->>'note', ''), actor)
  returning * into gr;

  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into ing from app.ingredients where id = (ln->>'ingredient_id')::uuid and tenant_id = b.tenant_id;
    if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'ingredient')); end if;
    v_pack_qty := coalesce(nullif(ln->>'pack_qty', '')::numeric, 1);
    v_pack_name := coalesce(nullif(ln->>'pack_name', ''), ing.base_unit);
    v_packs := (ln->>'qty_packs')::numeric;
    v_price := coalesce((ln->>'unit_price')::numeric, 0);
    if v_packs is null or v_packs <= 0 or v_pack_qty <= 0 or v_price < 0 then
      perform app.raise_error('INVALID_QTY', jsonb_build_object('name', ing.name));
    end if;
    v_unit_cost := v_price / v_pack_qty;

    insert into app.goods_receipt_lines (tenant_id, gr_id, ingredient_id, po_line_id, pack_name, pack_qty, qty_packs, unit_price, line_total)
    values (b.tenant_id, gr.id, ing.id, nullif(ln->>'po_line_id', '')::uuid, v_pack_name, v_pack_qty, v_packs, v_price, round(v_packs * v_price, 2));
    v_subtotal := v_subtotal + round(v_packs * v_price, 2);

    -- Owners want to know the moment a key ingredient gets pricier.
    if ing.last_cost is not null and ing.last_cost > 0 and v_unit_cost > ing.last_cost * 1.05 then
      perform app.emit_event(b.tenant_id, b.id, 'ingredient', ing.id, 'inventory.price_increased',
        jsonb_build_object('name', ing.name, 'old_cost', ing.last_cost, 'new_cost', round(v_unit_cost, 6),
                           'change_pct', round((v_unit_cost / ing.last_cost - 1) * 100, 1)));
    end if;

    if ing.track_stock then
      insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason,
                                       source_type, source_id, business_date, created_by)
      values (b.tenant_id, b.id, loc, ing.id, v_packs * v_pack_qty, v_unit_cost, 'purchase', 'goods_receipt', gr.id, bd, actor);
    else
      update app.ingredients set last_cost = v_unit_cost where id = ing.id;
    end if;

    if gr.supplier_id is not null then
      insert into app.supplier_items (tenant_id, supplier_id, ingredient_id, pack_name, pack_qty, last_price)
      values (b.tenant_id, gr.supplier_id, ing.id, v_pack_name, v_pack_qty, v_price)
      on conflict (supplier_id, ingredient_id, pack_name) do update set last_price = excluded.last_price, pack_qty = excluded.pack_qty, updated_at = now();
    end if;

    if nullif(ln->>'po_line_id', '') is not null then
      update app.purchase_order_lines set received_packs = received_packs + v_packs
       where id = (ln->>'po_line_id')::uuid and po_id = po.id;
    end if;
  end loop;

  v_vat := coalesce(nullif(p->>'vat_amount', '')::numeric, 0);
  update app.goods_receipts set subtotal = v_subtotal, vat_amount = v_vat, total = v_subtotal + v_vat
   where id = gr.id returning * into gr;

  if po.id is not null then
    update app.purchase_orders
       set status = case when exists (select 1 from app.purchase_order_lines l where l.po_id = po.id and l.received_packs < l.qty_packs)
                         then 'partially_received' else 'received' end
     where id = po.id;
  end if;

  perform app.post_goods_receipt(gr.id);
  perform app.emit_event(b.tenant_id, b.id, 'goods_receipt', gr.id, 'inventory.goods_received',
    jsonb_build_object('gr_no', gr.gr_no, 'total', gr.total, 'supplier_id', gr.supplier_id), actor);

  return jsonb_build_object('id', gr.id, 'gr_no', gr.gr_no, 'total', gr.total);
end;
$$;

-- =============================================================================
-- Waste
-- =============================================================================
create or replace function app.record_waste(p_location uuid, p_ingredient uuid, p_qty numeric, p_reason_code text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  loc app.stock_locations;
  v_id uuid;
begin
  select * into loc from app.stock_locations where stock_locations.id = p_location;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'location')); end if;
  perform app.assert_permission(loc.tenant_id, 'inventory.waste', loc.branch_id);
  if p_qty is null or p_qty <= 0 then perform app.raise_error('INVALID_QTY'); end if;
  if p_reason_code not in ('expired','spoiled','dropped','overcooked','wrong_order','staff_meal','tasting','other') then
    perform app.raise_error('INVALID_REASON');
  end if;
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, reason_code,
                                   source_type, business_date, created_by, note)
  values (loc.tenant_id, loc.branch_id, loc.id, p_ingredient, -p_qty, 'waste', p_reason_code, 'waste',
          app.business_date(loc.branch_id), app.actor_membership_id(loc.tenant_id), p_note)
  returning stock_movements.id into v_id;
  perform app.emit_event(loc.tenant_id, loc.branch_id, 'ingredient', p_ingredient, 'inventory.waste_recorded',
    jsonb_build_object('qty', p_qty, 'reason', p_reason_code));
  return v_id;
end;
$$;

-- =============================================================================
-- Stock counts (blind by default)
-- =============================================================================
create or replace function app.start_stock_count(p_location uuid, p_scope text default 'full', p_ingredients uuid[] default null, p_blind boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  loc app.stock_locations;
  bd date;
  cid uuid;
begin
  select * into loc from app.stock_locations where id = p_location;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'location')); end if;
  perform app.assert_permission(loc.tenant_id, 'inventory.count', loc.branch_id);
  if exists (select 1 from app.stock_counts where location_id = loc.id and status in ('in_progress','submitted')) then
    perform app.raise_error('COUNT_ALREADY_OPEN');
  end if;
  bd := app.business_date(loc.branch_id);
  insert into app.stock_counts (tenant_id, branch_id, location_id, count_no, scope, is_blind, business_date, started_by)
  values (loc.tenant_id, loc.branch_id, loc.id,
          'C' || to_char(bd, 'YYMMDD') || '-' || lpad(app.next_doc_no(loc.branch_id, 'count', bd::text)::text, 2, '0'),
          p_scope, p_blind, bd, app.actor_membership_id(loc.tenant_id))
  returning id into cid;

  insert into app.stock_count_lines (tenant_id, count_id, ingredient_id)
  select loc.tenant_id, cid, i.id
    from app.ingredients i
   where i.tenant_id = loc.tenant_id and i.track_stock and i.archived_at is null
     and (p_ingredients is null or i.id = any(p_ingredients))
     and (p_scope <> 'cycle' or i.is_high_value or i.id = any(coalesce(p_ingredients, '{}')));
  return cid;
end;
$$;

create or replace function app.record_count(p_count uuid, p_ingredient uuid, p_counted numeric, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.stock_counts;
begin
  select * into c from app.stock_counts where id = p_count;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(c.tenant_id, 'inventory.count', c.branch_id);
  if c.status <> 'in_progress' then perform app.raise_error('COUNT_NOT_IN_PROGRESS'); end if;
  if p_counted is not null and p_counted < 0 then perform app.raise_error('INVALID_QTY'); end if;
  insert into app.stock_count_lines (tenant_id, count_id, ingredient_id, counted_qty, counted_by, counted_at, note)
  values (c.tenant_id, c.id, p_ingredient, p_counted, app.actor_membership_id(c.tenant_id), now(), p_note)
  on conflict (count_id, ingredient_id) do update
    set counted_qty = excluded.counted_qty, counted_by = excluded.counted_by, counted_at = now(),
        note = coalesce(excluded.note, app.stock_count_lines.note);
end;
$$;

create or replace function app.submit_stock_count(p_count uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.stock_counts;
  uncounted int;
begin
  select * into c from app.stock_counts where id = p_count for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(c.tenant_id, 'inventory.count', c.branch_id);
  if c.status <> 'in_progress' then perform app.raise_error('COUNT_NOT_IN_PROGRESS'); end if;

  -- Snapshot what the system expected at the moment counting finished.
  update app.stock_count_lines l
     set expected_qty = coalesce((select b.qty_on_hand from app.stock_balances b
                                   where b.location_id = c.location_id and b.ingredient_id = l.ingredient_id), 0),
         unit_cost = app.ingredient_unit_cost(l.ingredient_id, c.location_id)
   where l.count_id = c.id;

  select count(*) into uncounted from app.stock_count_lines where count_id = c.id and counted_qty is null;
  update app.stock_counts set status = 'submitted', submitted_by = app.actor_membership_id(c.tenant_id), submitted_at = now()
   where id = c.id;
  perform app.emit_event(c.tenant_id, c.branch_id, 'stock_count', c.id, 'inventory.count_submitted',
    jsonb_build_object('uncounted', uncounted));
  return jsonb_build_object('id', c.id, 'uncounted', uncounted,
    'variance_value', (select coalesce(sum((counted_qty - expected_qty) * unit_cost), 0) from app.stock_count_lines
                        where count_id = c.id and counted_qty is not null));
end;
$$;

create or replace function app.approve_stock_count(p_count uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.stock_counts;
  actor uuid;
  n int;
begin
  select * into c from app.stock_counts where id = p_count for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(c.tenant_id, 'inventory.adjust', c.branch_id);
  if c.status <> 'submitted' then perform app.raise_error('COUNT_NOT_SUBMITTED'); end if;
  actor := app.actor_membership_id(c.tenant_id);

  -- Uncounted lines are "unknown", not zero — they are skipped, never zeroed.
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, source_type, source_id,
                                   business_date, created_by, note)
  select c.tenant_id, c.branch_id, c.location_id, l.ingredient_id, l.counted_qty - l.expected_qty, 'count_adjust',
         'stock_count', c.id, app.business_date(c.branch_id), actor, c.count_no
    from app.stock_count_lines l
   where l.count_id = c.id and l.counted_qty is not null and l.counted_qty <> l.expected_qty;
  get diagnostics n = row_count;

  update app.stock_counts set status = 'approved', approved_by = actor, approved_at = now() where id = c.id;
  perform app.emit_event(c.tenant_id, c.branch_id, 'stock_count', c.id, 'inventory.count_approved',
    jsonb_build_object('adjusted_lines', n), actor);
  return jsonb_build_object('id', c.id, 'adjusted_lines', n);
end;
$$;

-- =============================================================================
-- Transfers (central kitchen → outlets, outlet ↔ outlet)
-- p: {from_location_id, to_location_id, note?, lines:[{ingredient_id, qty}]}
-- =============================================================================
create or replace function app.create_transfer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f app.stock_locations;
  t app.stock_locations;
  tid uuid;
begin
  select * into f from app.stock_locations where id = (p->>'from_location_id')::uuid;
  select * into t from app.stock_locations where id = (p->>'to_location_id')::uuid;
  if f.id is null or t.id is null or f.tenant_id <> t.tenant_id then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(f.tenant_id, 'inventory.transfer', f.branch_id);
  insert into app.stock_transfers (tenant_id, transfer_no, from_branch_id, from_location_id, to_branch_id, to_location_id, note)
  values (f.tenant_id,
          'T' || to_char(app.business_date(f.branch_id), 'YYMMDD') || '-' ||
            lpad(app.next_doc_no(f.branch_id, 'transfer', app.business_date(f.branch_id)::text)::text, 3, '0'),
          f.branch_id, f.id, t.branch_id, t.id, nullif(p->>'note', ''))
  returning id into tid;
  insert into app.stock_transfer_lines (tenant_id, transfer_id, ingredient_id, qty_sent)
  select f.tenant_id, tid, (x->>'ingredient_id')::uuid, (x->>'qty')::numeric
    from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x;
  return tid;
end;
$$;

create or replace function app.send_transfer(p_transfer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tr app.stock_transfers;
  actor uuid;
begin
  select * into tr from app.stock_transfers where id = p_transfer for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(tr.tenant_id, 'inventory.transfer', tr.from_branch_id);
  if tr.status <> 'draft' then perform app.raise_error('TRANSFER_NOT_DRAFT'); end if;
  actor := app.actor_membership_id(tr.tenant_id);

  update app.stock_transfer_lines l set unit_cost = app.ingredient_unit_cost(l.ingredient_id, tr.from_location_id)
   where l.transfer_id = tr.id;
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, source_type, source_id, business_date, created_by)
  select tr.tenant_id, tr.from_branch_id, tr.from_location_id, l.ingredient_id, -l.qty_sent, 'transfer_out', 'transfer', tr.id,
         app.business_date(tr.from_branch_id), actor
    from app.stock_transfer_lines l where l.transfer_id = tr.id;
  update app.stock_transfers set status = 'sent', sent_by = actor, sent_at = now() where id = tr.id;
  perform app.emit_event(tr.tenant_id, tr.to_branch_id, 'transfer', tr.id, 'inventory.transfer_sent',
    jsonb_build_object('transfer_no', tr.transfer_no), actor);
end;
$$;

-- p_lines: [{ingredient_id, qty_received}] — omitted lines are received in full.
create or replace function app.receive_transfer(p_transfer uuid, p_lines jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tr app.stock_transfers;
  actor uuid;
  bd date;
begin
  select * into tr from app.stock_transfers where id = p_transfer for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(tr.tenant_id, 'inventory.receive', tr.to_branch_id);
  if tr.status <> 'sent' then perform app.raise_error('TRANSFER_NOT_SENT'); end if;
  actor := app.actor_membership_id(tr.tenant_id);
  bd := app.business_date(tr.to_branch_id);

  update app.stock_transfer_lines l
     set qty_received = coalesce((select (x->>'qty_received')::numeric from jsonb_array_elements(p_lines) x
                                   where (x->>'ingredient_id')::uuid = l.ingredient_id), l.qty_sent)
   where l.transfer_id = tr.id;

  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason, source_type, source_id, business_date, created_by)
  select tr.tenant_id, tr.to_branch_id, tr.to_location_id, l.ingredient_id, l.qty_received, l.unit_cost, 'transfer_in', 'transfer', tr.id, bd, actor
    from app.stock_transfer_lines l where l.transfer_id = tr.id and l.qty_received > 0;

  -- Short deliveries become visible waste at the receiving branch, not silent loss.
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason, reason_code, source_type, source_id, business_date, created_by, note)
  select tr.tenant_id, tr.to_branch_id, tr.to_location_id, l.ingredient_id, l.qty_sent - l.qty_received, l.unit_cost, 'transfer_in', 'transfer_loss', 'transfer', tr.id, bd, actor, 'ส่วนต่างการโอน'
    from app.stock_transfer_lines l where l.transfer_id = tr.id and l.qty_received < l.qty_sent;
  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, reason_code, source_type, source_id, business_date, created_by, note)
  select tr.tenant_id, tr.to_branch_id, tr.to_location_id, l.ingredient_id, -(l.qty_sent - l.qty_received), 'waste', 'transfer_loss', 'transfer', tr.id, bd, actor, 'ส่วนต่างการโอน'
    from app.stock_transfer_lines l where l.transfer_id = tr.id and l.qty_received < l.qty_sent;

  update app.stock_transfers set status = 'received', received_by = actor, received_at = now() where id = tr.id;
  perform app.emit_event(tr.tenant_id, tr.from_branch_id, 'transfer', tr.id, 'inventory.transfer_received',
    jsonb_build_object('transfer_no', tr.transfer_no), actor);
end;
$$;

-- =============================================================================
-- Production of stock-tracked prep items (central kitchen batches)
-- =============================================================================
create or replace function app.produce_batch(p_recipe uuid, p_location uuid, p_qty numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r app.recipes;
  loc app.stock_locations;
  actor uuid;
  bd date;
  bid uuid;
  input_cost numeric;
begin
  select * into r from app.recipes where id = p_recipe and kind = 'prep';
  select * into loc from app.stock_locations where id = p_location;
  if r.id is null or loc.id is null or r.tenant_id <> loc.tenant_id then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(loc.tenant_id, 'inventory.produce', loc.branch_id);
  if p_qty is null or p_qty <= 0 then perform app.raise_error('INVALID_QTY'); end if;
  actor := app.actor_membership_id(loc.tenant_id);
  bd := app.business_date(loc.branch_id);

  insert into app.production_batches (tenant_id, branch_id, location_id, recipe_id, produced_qty, business_date, produced_by, note)
  values (loc.tenant_id, loc.branch_id, loc.id, r.id, p_qty, bd, actor, p_note)
  returning id into bid;

  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, source_type, source_id, business_date, created_by)
  select loc.tenant_id, loc.branch_id, loc.id, e.ingredient_id, -e.qty, 'production_out', 'production', bid, bd, actor
    from app.explode_recipe(r.id, p_qty) e where e.qty > 0;

  select coalesce(-sum(total_cost), 0) into input_cost from app.stock_movements
   where source_type = 'production' and source_id = bid and reason = 'production_out';

  insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason, source_type, source_id, business_date, created_by)
  values (loc.tenant_id, loc.branch_id, loc.id, r.output_ingredient_id, p_qty, round(input_cost / p_qty, 6), 'production_in', 'production', bid, bd, actor);

  update app.production_batches set unit_cost = round(input_cost / p_qty, 6) where id = bid;
  return bid;
end;
$$;

-- =============================================================================
-- Purchase orders
-- p: {id?, branch_id, supplier_id, location_id?, expected_date?, note?,
--     lines:[{ingredient_id, pack_name, pack_qty, qty_packs, unit_price}]}
-- =============================================================================
create or replace function app.save_purchase_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b app.branches;
  po app.purchase_orders;
  v_id uuid := nullif(p->>'id', '')::uuid;
  actor uuid;
begin
  select * into b from app.branches where id = (p->>'branch_id')::uuid;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'branch')); end if;
  perform app.assert_permission(b.tenant_id, 'purchasing.manage', b.id);
  actor := app.actor_membership_id(b.tenant_id);

  if v_id is not null then
    select * into po from app.purchase_orders where id = v_id and tenant_id = b.tenant_id for update;
    if found and po.status <> 'draft' then perform app.raise_error('PO_NOT_EDITABLE', jsonb_build_object('status', po.status)); end if;
  end if;

  if po.id is null then
    insert into app.purchase_orders (id, tenant_id, branch_id, location_id, supplier_id, po_no, expected_date, note, created_by)
    values (coalesce(v_id, app.uuid_v7()), b.tenant_id, b.id,
            coalesce(nullif(p->>'location_id', '')::uuid, app.default_location(b.id)),
            (p->>'supplier_id')::uuid,
            'PO' || to_char(app.business_date(b.id), 'YYMM') || '-' || lpad(app.next_doc_no(b.id, 'po', to_char(app.business_date(b.id), 'YYYYMM'))::text, 4, '0'),
            nullif(p->>'expected_date', '')::date, nullif(p->>'note', ''), actor)
    returning * into po;
  else
    update app.purchase_orders set supplier_id = (p->>'supplier_id')::uuid,
           expected_date = nullif(p->>'expected_date', '')::date, note = nullif(p->>'note', '')
     where id = po.id returning * into po;
    delete from app.purchase_order_lines where po_id = po.id;
  end if;

  insert into app.purchase_order_lines (tenant_id, po_id, ingredient_id, pack_name, pack_qty, qty_packs, unit_price, line_total)
  select b.tenant_id, po.id, (x->>'ingredient_id')::uuid, coalesce(nullif(x->>'pack_name', ''), 'หน่วย'),
         coalesce(nullif(x->>'pack_qty', '')::numeric, 1), (x->>'qty_packs')::numeric, coalesce((x->>'unit_price')::numeric, 0),
         round((x->>'qty_packs')::numeric * coalesce((x->>'unit_price')::numeric, 0), 2)
    from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x;

  update app.purchase_orders
     set subtotal = (select coalesce(sum(line_total), 0) from app.purchase_order_lines where po_id = po.id),
         total = (select coalesce(sum(line_total), 0) from app.purchase_order_lines where po_id = po.id) + vat_amount
   where id = po.id returning * into po;
  return jsonb_build_object('id', po.id, 'po_no', po.po_no, 'total', po.total, 'status', po.status);
end;
$$;

create or replace function app.set_purchase_order_status(p_po uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  po app.purchase_orders;
  actor uuid;
begin
  select * into po from app.purchase_orders where id = p_po for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  actor := app.actor_membership_id(po.tenant_id);
  if p_status = 'approved' then
    perform app.assert_permission(po.tenant_id, 'purchasing.approve', po.branch_id);
    if po.status not in ('draft','submitted') then perform app.raise_error('INVALID_TRANSITION'); end if;
    update app.purchase_orders set status = 'approved', approved_by = actor, approved_at = now() where id = po.id;
  elsif p_status in ('submitted','sent','cancelled') then
    perform app.assert_permission(po.tenant_id, 'purchasing.manage', po.branch_id);
    if (p_status = 'submitted' and po.status <> 'draft')
       or (p_status = 'sent' and po.status not in ('approved'))
       or (p_status = 'cancelled' and po.status in ('received','partially_received','cancelled')) then
      perform app.raise_error('INVALID_TRANSITION', jsonb_build_object('from', po.status, 'to', p_status));
    end if;
    update app.purchase_orders set status = p_status where id = po.id;
  else
    perform app.raise_error('INVALID_TRANSITION');
  end if;
  perform app.emit_event(po.tenant_id, po.branch_id, 'purchase_order', po.id, 'purchasing.po_' || p_status,
    jsonb_build_object('po_no', po.po_no, 'total', po.total), actor);
end;
$$;
