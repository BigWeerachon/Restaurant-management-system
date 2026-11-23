-- =============================================================================
-- Sabai — pay per order (จ่ายตามออเดอร์)
--
--   A plan with no monthly price. The shop pays 0.50 baht for each paid order, and never more than 990 baht a month for
--   one branch, however busy it gets. A month that comes to less than 100 baht is not billed: it is carried to the next
--   month's bill. Same rule as usageStatement in @sabai/domain (packages/domain/src/usage.ts).
--
--   What counts: orders whose status is `paid` on a business date in the month. A voided or refunded order does not
--   count. An order taken offline counts when it syncs (it carries the business date it was sold on); the month's
--   statement waits until the 3rd of the next month so the last offline orders are in.
--
--   app.usage_meter(tenant)          this month so far, branch by branch — for the meter in the app
--   app.usage_billing_run(now)       the monthly statement and invoice (internal; called with app.billing_run)
--
-- Billing still never stops a sale: an unpaid usage bill follows the same banner → grace → no new branches path.
-- =============================================================================

insert into app.plans (code, name, name_en, price_monthly, price_yearly, limits, features, sort) values
  ('per_order', 'จ่ายตามออเดอร์', 'Pay per order', 0, 0,
   '{"branches":10,"staff":100,"devices":30}',
   '{pos,kds,inventory_basic,inventory,recipes,purchasing,finance,reconciliation,reports_basic,reports_profit,multi_branch}', 6)
on conflict (code) do nothing;

alter table app.subscription_invoices drop constraint if exists subscription_invoices_kind_check;
alter table app.subscription_invoices add constraint subscription_invoices_kind_check check (kind in ('renewal', 'plan_change', 'usage'));

-- The three numbers of the price, in one place.
create or replace function app.usage_price()
returns table (per_order numeric, branch_cap numeric, min_invoice numeric)
language sql immutable
set search_path = ''
as $$ select 0.50::numeric, 990::numeric, 100::numeric $$;

-- One row per shop per month, written once by the monthly run. Append-only: a later month carries, it never edits.
create table app.usage_statements (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references app.tenants(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  orders        int not null check (orders >= 0),
  fee           numeric(10,2) not null check (fee >= 0),
  carried_in    numeric(10,2) not null default 0 check (carried_in >= 0),
  total         numeric(10,2) not null check (total >= 0),
  outcome       text not null check (outcome in ('nothing', 'carried', 'invoiced')),
  invoice_id    uuid references app.subscription_invoices(id),
  branches      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  unique (tenant_id, period_start)
);
create rule usage_statements_no_update as on update to app.usage_statements do instead nothing;
create rule usage_statements_no_delete as on delete to app.usage_statements do instead nothing;
call app.apply_tenant_rls('app.usage_statements', 'billing.manage');

-- Paid orders and the fee, per branch, for a range of business dates.
create or replace function app.usage_by_branch(p_tenant uuid, p_from date, p_to date)
returns table (branch_id uuid, branch_name text, orders bigint, fee numeric, capped boolean)
language sql stable
security definer
set search_path = ''
as $$
  with p as (select * from app.usage_price()),
  c as (
    select o.branch_id, count(*) as n
      from app.orders o
     where o.tenant_id = p_tenant and o.status = 'paid' and o.business_date between p_from and p_to
     group by o.branch_id
  )
  select b.id, b.name, coalesce(c.n, 0), least(coalesce(c.n, 0) * p.per_order, p.branch_cap), coalesce(c.n, 0) * p.per_order >= p.branch_cap
    from app.branches b cross join p
    left join c on c.branch_id = b.id
   where b.tenant_id = p_tenant and (c.n > 0 or b.kind = 'outlet')
   order by b.code
$$;

-- This month so far. Anyone who manages billing can see it; the numbers move with every paid order.
create or replace function app.usage_meter(p_tenant uuid, p_now timestamptz default now())
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Asia/Bangkok')::date;
  v_from date := date_trunc('month', v_today)::date;
  v_to date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  v_branches jsonb;
  v_fee numeric;
  v_orders bigint;
  v_carried numeric;
  pr record;
begin
  perform app.assert_permission(p_tenant, 'billing.manage');
  select * into pr from app.usage_price();
  select coalesce(jsonb_agg(jsonb_build_object('branch_id', u.branch_id, 'name', u.branch_name, 'orders', u.orders, 'fee', u.fee, 'capped', u.capped)), '[]'::jsonb),
         coalesce(sum(u.fee), 0), coalesce(sum(u.orders), 0)
    into v_branches, v_fee, v_orders
    from app.usage_by_branch(p_tenant, v_from, v_to) u;
  -- A small month carried from before is added to this month's bill.
  select coalesce((select s.total from app.usage_statements s where s.tenant_id = p_tenant and s.outcome = 'carried'
                    order by s.period_start desc limit 1), 0) into v_carried;
  return jsonb_build_object('period_start', v_from, 'period_end', v_to, 'orders', v_orders, 'fee', v_fee, 'carried_in', v_carried,
    'total', v_fee + v_carried, 'per_order', pr.per_order, 'branch_cap', pr.branch_cap, 'min_invoice', pr.min_invoice, 'branches', v_branches);
end;
$$;
grant execute on function app.usage_meter(uuid, timestamptz) to authenticated;

-- The monthly statement. Safe to run as often as you like: a month is written once.
create or replace function app.usage_billing_run(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The month that ended at least two days ago (offline tills have had time to sync).
  v_start date := (date_trunc('month', (p_now at time zone 'Asia/Bangkok')::date - 2) - interval '1 month')::date;
  v_end date := (v_start + interval '1 month - 1 day')::date;
  s record;
  pr record;
  v_fee numeric;
  v_orders bigint;
  v_branches jsonb;
  v_carried numeric;
  v_unpaid numeric;
  v_total numeric;
  v_vat numeric;
  v_outcome text;
  inv app.subscription_invoices;
  v_n_invoiced int := 0;
  v_n_carried int := 0;
  v_overdue int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('sabai.usage_billing_run', 0)) then
    return jsonb_build_object('skipped', true);
  end if;
  select * into pr from app.usage_price();

  for s in
    select sub.tenant_id from app.subscriptions sub
     where sub.plan_code = 'per_order' and sub.status in ('active', 'past_due', 'restricted')
       and not exists (select 1 from app.usage_statements st where st.tenant_id = sub.tenant_id and st.period_start = v_start)
  loop
    perform 1 from app.subscriptions where tenant_id = s.tenant_id for update;
    select coalesce(jsonb_agg(jsonb_build_object('branch_id', u.branch_id, 'name', u.branch_name, 'orders', u.orders, 'fee', u.fee)) filter (where u.orders > 0), '[]'::jsonb),
           coalesce(sum(u.fee), 0), coalesce(sum(u.orders), 0)
      into v_branches, v_fee, v_orders
      from app.usage_by_branch(s.tenant_id, v_start, v_end) u;

    -- Carried in: last month's small amount, plus a usage bill still unpaid (it is replaced by this one, not lost).
    select coalesce((select st.total from app.usage_statements st where st.tenant_id = s.tenant_id and st.outcome = 'carried'
                      and st.period_start = (v_start - interval '1 month')::date), 0) into v_carried;
    select coalesce(sum(i.total), 0) into v_unpaid from app.subscription_invoices i
     where i.tenant_id = s.tenant_id and i.status = 'open' and i.kind = 'usage';
    v_total := v_fee + v_carried + v_unpaid;
    inv := null;

    if v_total = 0 then
      v_outcome := 'nothing';
    elsif v_total < pr.min_invoice and v_unpaid = 0 then
      v_outcome := 'carried';
      v_n_carried := v_n_carried + 1;
    else
      v_outcome := 'invoiced';
      -- One invoice waits to be paid: the new one replaces any other (an unpaid usage bill is inside its total).
      update app.subscription_invoices set status = 'void', voided_at = p_now where tenant_id = s.tenant_id and status = 'open';
      v_vat := round(v_total * 7 / 107, 2);
      insert into app.subscription_invoices (tenant_id, invoice_no, period_start, period_end, subtotal, vat_amount, total, status,
                                             plan_code, billing_cycle, kind, due_at)
      values (s.tenant_id, app.next_invoice_no(p_now), v_start, v_end, v_total - v_vat, v_vat, v_total, 'open',
              'per_order', 'monthly', 'usage', p_now + interval '7 days')
      returning * into inv;
      perform app.emit_event(s.tenant_id, null, 'subscription', inv.id, 'subscription.invoice_issued',
        jsonb_build_object('invoice_no', inv.invoice_no, 'total', inv.total, 'kind', 'usage', 'orders', v_orders));
      v_n_invoiced := v_n_invoiced + 1;
    end if;

    insert into app.usage_statements (tenant_id, period_start, period_end, orders, fee, carried_in, total, outcome, invoice_id, branches)
    values (s.tenant_id, v_start, v_end, v_orders, v_fee, v_carried + v_unpaid, v_total, v_outcome, inv.id, v_branches);
  end loop;

  -- A usage bill past its due date: the same banner → grace path as a missed renewal.
  for s in
    update app.subscriptions sub set status = 'past_due', past_due_since = i.due_at
      from app.subscription_invoices i
     where i.tenant_id = sub.tenant_id and i.kind = 'usage' and i.status = 'open' and i.due_at <= p_now and sub.status = 'active'
    returning sub.tenant_id
  loop
    perform app.emit_event(s.tenant_id, null, 'subscription', s.tenant_id, 'subscription.past_due');
    v_overdue := v_overdue + 1;
  end loop;

  return jsonb_build_object('period_start', v_start, 'invoiced', v_n_invoiced, 'carried', v_n_carried, 'past_due', v_overdue);
end;
$$;
revoke all on function app.usage_billing_run(timestamptz) from public, authenticated;

-- Choosing pay-per-order makes the subscription active at once (there is nothing to pay up front).
create or replace function app.change_plan(p_tenant uuid, p_plan_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl app.plans;
begin
  perform app.assert_permission(p_tenant, 'billing.manage');
  perform app.assert_plan_fits(p_tenant, p_plan_code);
  select * into pl from app.plans where code = p_plan_code;

  update app.subscriptions
     set plan_code = p_plan_code,
         status = case when (coalesce(pl.price_monthly, 0) > 0 or p_plan_code = 'per_order') and status in ('trialing', 'canceled') then 'active' else status end
   where tenant_id = p_tenant;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'subscription')); end if;
  perform app.emit_event(p_tenant, null, 'subscription', p_tenant, 'subscription.plan_changed',
    jsonb_build_object('plan_code', p_plan_code), app.actor_membership_id(p_tenant));
end;
$$;
