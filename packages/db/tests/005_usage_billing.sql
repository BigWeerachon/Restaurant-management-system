-- =============================================================================
-- Pay per order: 0.50 baht a paid order, at most 990 baht a branch a month, under 100 baht carried to next month.
-- Same vectors as packages/domain/test/usage.test.ts.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
create schema if not exists test;
grant usage on schema test to authenticated;
create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;
create or replace function test.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
create or replace function test.id(p_key text) returns uuid language sql stable as $$ select current_setting('test.' || p_key)::uuid; $$;
create or replace function test.put(p_key text, p_val uuid) returns void language sql as $$ select set_config('test.' || p_key, p_val::text, false); $$;
-- n paid orders (and one voided, one refunded that must not count) at a branch on a date.
create or replace function test.orders(p_branch uuid, p_date date, n int) returns void language plpgsql as $$
declare ch uuid; t uuid;
begin
  select tenant_id into t from app.branches where id = p_branch;
  select id into ch from app.sales_channels where tenant_id = t limit 1;
  insert into app.orders (tenant_id, branch_id, channel_id, order_no, status, business_date, prices_include_vat, vat_rate)
  select t, p_branch, ch, 'U' || p_date || '-' || g || '-' || left(p_branch::text, 8), 'paid', p_date, true, 0.07 from generate_series(1, n) g;
  insert into app.orders (tenant_id, branch_id, channel_id, order_no, status, business_date, prices_include_vat, vat_rate)
  values (t, p_branch, ch, 'V' || p_date || left(p_branch::text, 8), 'voided', p_date, true, 0.07),
         (t, p_branch, ch, 'R' || p_date || left(p_branch::text, 8), 'refunded', p_date, true, 0.07);
end $$;
grant execute on all functions in schema test to authenticated;

select test.put('owner', '00000000-0000-7000-8005-0000000000a1');
insert into auth.users (id, email) values (test.id('owner'), 'usage-owner@example.com');
set role authenticated;
select test.as_user(test.id('owner'));
do $$
declare r jsonb;
begin
  r := app.create_tenant('{"name":"ร้านจ่ายตามออเดอร์","business_type":"cafe","branch_name":"สาขาหนึ่ง","owner_name":"คุณยู"}');
  perform test.put('tenant', (r->>'tenant_id')::uuid);
  perform test.put('branch_a', (r->>'branch_id')::uuid);
  perform app.change_plan((r->>'tenant_id')::uuid, 'per_order');
  perform test.put('branch_b', app.add_branch(jsonb_build_object('tenant_id', (r->>'tenant_id')::uuid, 'code', 'UB', 'name', 'สาขาสอง')));
end $$;
select test.ok((select status = 'active' from app.subscriptions where tenant_id = test.id('tenant')), 'choosing pay-per-order is active at once');
reset role;

-- October: branch A 150 orders (75 baht), branch B 0 → 75 baht < 100 → carried
select test.orders(test.id('branch_a'), '2026-10-10', 150);
select app.usage_billing_run('2026-11-03 09:00+07');
select test.ok((select outcome = 'carried' and total = 75 and orders = 150 from app.usage_statements where tenant_id = test.id('tenant') and period_start = '2026-10-01'), 'a small month is carried');
select test.ok(not exists (select 1 from app.subscription_invoices where tenant_id = test.id('tenant')), 'nothing invoiced for a carried month');
-- running again changes nothing
select app.usage_billing_run('2026-11-04 09:00+07');
select test.ok((select count(*) = 1 from app.usage_statements where tenant_id = test.id('tenant')), 'a month is written once');

-- November: A 3000 orders (1500 → capped at 990), B 100 orders (50) → 1040 + 75 carried = 1115
select test.orders(test.id('branch_a'), '2026-11-20', 3000);
select test.orders(test.id('branch_b'), '2026-11-21', 100);
set role authenticated;
select test.as_user(test.id('owner'));
select test.ok((select (m->>'fee')::numeric = 1040 and (m->>'carried_in')::numeric = 75 and (m->>'total')::numeric = 1115 and (m->>'orders')::int = 3100
                 from app.usage_meter(test.id('tenant'), '2026-11-25 12:00+07') m), 'meter shows this month with the cap and the carry');
reset role;
select app.usage_billing_run('2026-12-02 09:00+07');
select test.ok(not exists (select 1 from app.usage_statements where tenant_id = test.id('tenant') and period_start = '2026-11-01'), 'waits until the 3rd for offline orders');
select app.usage_billing_run('2026-12-03 09:00+07');
select test.ok((select outcome = 'invoiced' and fee = 1040 and carried_in = 75 and total = 1115 from app.usage_statements where tenant_id = test.id('tenant') and period_start = '2026-11-01'), 'the cap is per branch and the carry is added');
select test.ok((select total = 1115 and kind = 'usage' and status = 'open' and vat_amount = round(1115 * 7 / 107.0, 2) from app.subscription_invoices where tenant_id = test.id('tenant')), 'usage invoice with VAT inside');

-- Unpaid past due → banner path, selling continues
select app.usage_billing_run('2026-12-11 09:00+07');
select test.ok((select status = 'past_due' from app.subscriptions where tenant_id = test.id('tenant')), 'an unpaid usage bill is past due');

-- December quiet (10 orders = 5 baht) but the unpaid bill rolls in → one invoice of 1120
select test.orders(test.id('branch_a'), '2026-12-05', 10);
select app.usage_billing_run('2027-01-03 09:00+07');
select test.ok((select count(*) = 1 and sum(total) = 1120 from app.subscription_invoices where tenant_id = test.id('tenant') and status = 'open'), 'an unpaid bill is rolled into the next one, not lost');
select test.ok((select count(*) = 1 from app.subscription_invoices where tenant_id = test.id('tenant') and status = 'void'), 'the old bill is replaced');
