-- =============================================================================
-- The sample shop's sales history (packages/db/sql/seed-history.sql, checklist item 1.2b): that the rows it writes add
-- up the way the commands' own rows do, that the reports read them, and that the shop goes on selling — and can close a
-- day, history or new — on top of them.
--
--   pnpm --filter @sabai/db test:sql
--
-- Builds the shop and its history exactly as `pnpm db:seed && pnpm db:seed:history` do (same files), in the database the
-- earlier tests left behind; every question below is asked about that shop's tenant only.
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
create or replace function test.id(p_key text) returns uuid language sql stable as $$
  select current_setting('test.' || p_key)::uuid;
$$;
grant execute on all functions in schema test to authenticated;

\i packages/db/sql/seed-demo.sql
\i packages/db/sql/seed-history.sql

select set_config('test.tenant', (select t.id::text from app.tenants t join app.memberships m on m.tenant_id = t.id
                                    join auth.users u on u.id = m.user_id where u.email = 'owner@sabai.dev' limit 1), false);
select set_config('test.branch', (select id::text from app.branches where tenant_id = test.id('tenant') and code = 'HQ'), false);

-- ---------------------------------------------------------------------------
-- 1. The window: thirty days, both branches, every day, ending yesterday
-- ---------------------------------------------------------------------------
select test.ok((select count(distinct business_date) from app.orders where tenant_id = test.id('tenant')) = 30, 'thirty days of bills');
select test.ok((select count(distinct (branch_id, business_date)) from app.orders where tenant_id = test.id('tenant')) = 60, 'both branches sold on every one of them');
select test.ok((select max(business_date) from app.orders where tenant_id = test.id('tenant')) < app.business_date(test.id('branch')), 'history stops before today — today is for the till');
select test.ok((select count(*) from app.orders where tenant_id = test.id('tenant')) between 5500 and 8500, 'about what the web demo sells: 5,500–8,500 bills in thirty days');
select test.ok((select count(*) from app.sales_channels where tenant_id = test.id('tenant') and is_active) = 4, 'dine-in, takeaway, GrabFood and LINE MAN are switched on, as in the demo');
select test.ok((select count(*) from app.payment_methods where tenant_id = test.id('tenant') and is_active and kind in ('cash','promptpay','card','platform')) = 4, 'cash, PromptPay, card and platform payment are switched on');

-- ---------------------------------------------------------------------------
-- 2. A bill is what the commands would have made of its lines
-- ---------------------------------------------------------------------------
select test.ok((select count(*) from app.orders where tenant_id = test.id('tenant') and status <> 'paid') = 0, 'every bill is paid');
select test.ok((select count(*) from app.orders o where o.tenant_id = test.id('tenant')
                 and o.items_total <> (select sum(line_total) from app.order_items where order_id = o.id)) = 0, 'a bill is the sum of its lines');
select test.ok((select count(*) from app.order_items oi where oi.tenant_id = test.id('tenant')
                 and oi.line_total <> round(oi.qty * (oi.unit_price + oi.modifiers_total), 2)) = 0, 'a line is quantity × (price + options)');
select test.ok((select count(*) from app.order_items oi where oi.tenant_id = test.id('tenant')
                 and oi.modifiers_total <> coalesce((select sum(price_delta) from app.order_item_modifiers m where m.order_item_id = oi.id), 0)) = 0, 'the options add up to the line''s extras');
select test.ok((select count(*) from app.orders o where o.tenant_id = test.id('tenant')
                 and o.total <> o.items_total - o.discount_total + o.service_charge + case when o.prices_include_vat then 0 else o.vat_amount end + o.rounding) = 0, 'total follows recalc_order');
select test.ok((select count(*) from app.orders o where o.tenant_id = test.id('tenant') and o.prices_include_vat
                 and o.vat_amount <> round((o.items_total + o.service_charge) * o.vat_rate / (1 + o.vat_rate), 2)) = 0, 'VAT is the part of a VAT-inclusive total');
select test.ok((select count(*) from app.orders o where o.tenant_id = test.id('tenant')
                 and o.total <> (select coalesce(sum(p.amount), 0) from app.payments p where p.order_id = o.id)) = 0, 'every bill is paid in full, to the satang');
select test.ok((select count(*) - count(distinct (branch_id, receipt_no)) from app.orders where tenant_id = test.id('tenant')) = 0, 'receipt numbers are unique per branch');
select test.ok((select count(*) from app.orders o join app.sales_channels c on c.id = o.channel_id
                 where o.tenant_id = test.id('tenant') and c.kind = 'delivery_platform'
                   and (o.commission_amount <> round(o.items_total * 0.30, 2) or o.commission_vat_amount <> round(o.commission_amount * 0.07, 2))) = 0, 'delivery GP is 30 % of the bill, plus its VAT');
select test.ok((select count(*) from app.orders o join app.sales_channels c on c.id = o.channel_id
                 where o.tenant_id = test.id('tenant') and c.kind <> 'delivery_platform' and o.commission_amount <> 0) = 0, 'no GP on the shop''s own channels');
-- Delivery menus cost more than the shop's own (+15 %, rounded up to ฿5) — the same latte on two channels.
select test.ok((select max(oi.unit_price) filter (where c.key = 'lineman') > max(oi.unit_price) filter (where c.key = 'dine_in')
                  from app.order_items oi join app.orders o on o.id = oi.order_id join app.sales_channels c on c.id = o.channel_id
                 where o.tenant_id = test.id('tenant') and oi.name = 'ลาเต้เย็น'), 'delivery pays the marked-up price');
-- Payment fees come from the method, as pay_order takes them.
select test.ok((select count(*) from app.payments p join app.payment_methods m on m.id = p.method_id
                 where p.tenant_id = test.id('tenant') and p.fee_amount <> round(p.amount * m.fee_rate + m.fee_fixed, 2)) = 0, 'fee = amount × rate + fixed');
select test.ok((select count(*) from app.payments p join app.payment_methods m on m.id = p.method_id
                 where p.tenant_id = test.id('tenant') and m.kind = 'cash' and (p.tendered < p.amount or p.change_given <> p.tendered - p.amount)) = 0, 'cash change = tendered − amount');

-- ---------------------------------------------------------------------------
-- 3. The cash drawers
-- ---------------------------------------------------------------------------
select test.ok((select count(*) from app.shifts where tenant_id = test.id('tenant')) = 60, 'one shift per branch per day');
select test.ok((select count(*) from app.shifts where tenant_id = test.id('tenant') and status <> 'closed') = 0, 'every drawer is counted and closed');
select test.ok((select count(*) from app.shifts s where s.tenant_id = test.id('tenant') and s.expected_cash <> app.shift_expected_cash(s.id)) = 0, 'expected cash is float + the day''s cash, as the command counts it');
select test.ok((select count(*) from app.shifts s where s.tenant_id = test.id('tenant') and s.cash_variance <> s.counted_cash - s.expected_cash) = 0, 'variance = counted − expected');
select test.ok((select count(*) from app.shifts where tenant_id = test.id('tenant') and cash_variance <> 0) between 1 and 30, 'most drawers are right to the baht, a few are a little off');

-- ---------------------------------------------------------------------------
-- 4. The shelf
-- ---------------------------------------------------------------------------
select test.ok((select count(*) from app.stock_balances b join app.ingredients i on i.id = b.ingredient_id
                 where b.tenant_id = test.id('tenant') and i.track_stock and b.qty_on_hand < 0) = 0, 'no tracked ingredient below zero');
select test.ok((select count(*) from app.stock_balances b
                 where b.tenant_id = test.id('tenant')
                   and b.qty_on_hand <> (select coalesce(sum(qty), 0) from app.stock_movements m where m.location_id = b.location_id and m.ingredient_id = b.ingredient_id)) = 0, 'every balance is the sum of its movements');
select test.ok((select count(*) from app.orders o where o.tenant_id = test.id('tenant')
                 and abs(o.cost_total - coalesce((select -sum(total_cost) from app.stock_movements sm where sm.source_type = 'order' and sm.source_id = o.id and sm.reason = 'sale'), 0)) > 0.001) = 0, 'the cost on a bill is the cost the shelf gave up');
select test.ok((select count(*) from app.stock_movements where tenant_id = test.id('tenant') and reason = 'opening'
                   and business_date >= (select min(business_date) from app.orders where tenant_id = test.id('tenant'))) = 0, 'the opening count comes before the first bill');
select test.ok((select count(*) from app.stock_movements where tenant_id = test.id('tenant') and reason = 'waste' and reason_code is not null) > 50, 'waste is written down every day, with a reason');
select test.ok((select count(*) from app.stock_movements where tenant_id = test.id('tenant') and reason = 'count_adjust') > 0, 'the Sunday counts found something short');
select test.ok((select count(*) from app.v_reorder_suggestions where tenant_id = test.id('tenant')) > 0, 'some ingredients are below their reorder point, so purchasing has something to suggest');
select test.ok((select count(*) from app.v_stock_status where tenant_id = test.id('tenant') and status = 'ok') > 0, 'and most are fine');

-- ---------------------------------------------------------------------------
-- 5. What the reports read
-- ---------------------------------------------------------------------------
-- (Expenses are spread over their service period, which starts before the first bill — so ask about the days that have bills.)
select test.ok((select round(sum(profit) / sum(net_sales), 3) between 0.10 and 0.30 from app.v_branch_daily_pnl
                 where tenant_id = test.id('tenant') and orders > 0), 'the shop keeps 10–30 % of net sales');
select test.ok((select round(sum(cogs) / sum(net_sales), 3) between 0.25 and 0.35 from app.v_branch_daily_pnl
                 where tenant_id = test.id('tenant') and orders > 0), 'ingredients cost 25–35 % of net sales');
select test.ok((select count(*) from app.expenses where tenant_id = test.id('tenant') and journal_entry_id is null) = (select count(*) from app.expenses where tenant_id = test.id('tenant')), 'history expenses are recorded without journal entries, like the days');
select test.ok((select sum(net_sales) from app.v_daily_sales where tenant_id = test.id('tenant'))
               = (select sum(net_sales) from app.v_branch_daily_pnl where tenant_id = test.id('tenant')), 'the channel view and the profit view agree on net sales');
select test.ok((select count(distinct menu_item_id) from app.v_item_sales where tenant_id = test.id('tenant')) = 17, 'all seventeen menu items sold');
select test.ok((select name from app.v_item_sales where tenant_id = test.id('tenant') group by name order by sum(qty) desc limit 1) = 'ลาเต้เย็น', 'the latte is the best seller, as in the demo');

-- ---------------------------------------------------------------------------
-- 6. The shop carries on: numbers continue, a new bill sells, and days can be closed — a new one and an old one
-- ---------------------------------------------------------------------------
select set_config('test.owner', '00000000-0000-7000-9000-000000000001', false);
set role authenticated;
select test.as_user(test.id('owner'));

do $$
declare
  br uuid := test.id('branch');
  bd date := app.business_date(br);
  ch uuid := (select id from app.sales_channels where tenant_id = test.id('tenant') and key = 'dine_in');
  cash uuid := (select id from app.payment_methods where tenant_id = test.id('tenant') and kind = 'cash');
  latte uuid := (select id from app.menu_items where tenant_id = test.id('tenant') and name = 'ลาเต้เย็น');
  sweet uuid := (select id from app.modifier_options where tenant_id = test.id('tenant') and name = 'หวานปกติ');
  oid uuid := app.uuid_v7();
  shift uuid;
  r jsonb;
  prev int := coalesce((select max(right(receipt_no, 5)::int) from app.orders
                         where branch_id = br and receipt_no like 'HQ-' || to_char(bd, 'YYMM') || '-%'), 0);
  yesterday jsonb;
  y_orders int;
  y_total numeric;
begin
  shift := app.open_shift(br, 2000);
  r := app.submit_order(jsonb_build_object('id', oid, 'branch_id', br, 'channel_id', ch,
        'items', jsonb_build_array(jsonb_build_object('id', app.uuid_v7(), 'menu_item_id', latte, 'qty', 1, 'modifier_option_ids', jsonb_build_array(sweet)))));
  perform test.ok(r->>'order_no' = '001', 'today''s first bill is number 001 — history took none of today''s numbers, got ' || (r->>'order_no'));
  r := app.pay_order(oid, jsonb_build_array(jsonb_build_object('method_id', cash, 'amount', (r->>'total')::numeric, 'tendered', 100)));
  perform test.ok(r->>'receipt_no' = 'HQ-' || to_char(bd, 'YYMM') || '-' || lpad((prev + 1)::text, 5, '0'),
                  'the receipt number continues the history''s: got ' || (r->>'receipt_no') || ', after ' || prev);
  perform app.close_shift(shift, 2000 + (select total from app.orders where id = oid));

  -- An old day, closed now: its ledger balances and the money it is waiting for shows up.
  select count(*), sum(total) into y_orders, y_total from app.orders where branch_id = br and business_date = bd - 1;
  yesterday := app.close_business_day(br, bd - 1, 'ปิดยอดย้อนหลัง');
  perform test.ok((yesterday->>'orders')::int = y_orders and (yesterday->>'total')::numeric = y_total, 'closing a history day sums that day''s bills');
  perform test.ok(exists (select 1 from app.expected_receipts where branch_id = br and business_date = bd - 1), 'a closed history day expects money from the platforms and PromptPay');

  -- Today, with the new bill.
  r := app.close_business_day(br, bd, 'ปิดยอดวันนี้');
  perform test.ok((r->>'orders')::int = 1, 'today has the one new bill');
end $$;

reset role;
select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant')), 'the ledger balances after closing days on top of the history');
