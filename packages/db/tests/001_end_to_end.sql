-- =============================================================================
-- End-to-end database test: a café opens, sells, cooks, counts, closes the day.
-- Runs as the real `authenticated` role with JWT claims, so every RLS policy,
-- permission check and trigger is exercised exactly as in production.
--
--   pnpm --filter @sabai/db test:sql
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists test;
grant usage on schema test to authenticated;

create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;

-- Asserts that a statement fails with the given domain error code.
create or replace function test.throws(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ASSERTION FAILED: expected % from: %', p_code, p_sql;
exception when others then
  if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
  if sqlerrm <> p_code then
    raise exception 'ASSERTION FAILED: expected %, got "%" from: %', p_code, sqlerrm, p_sql;
  end if;
end $$;

create or replace function test.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
create or replace function test.as_member(p_membership uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('mid', p_membership, 'role', 'authenticated')::text, false);
$$;
create or replace function test.id(p_key text) returns uuid language sql stable as $$
  select current_setting('test.' || p_key)::uuid;
$$;
create or replace function test.put(p_key text, p_val uuid) returns void language sql as $$
  select set_config('test.' || p_key, p_val::text, false);
$$;
grant execute on all functions in schema test to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Two owners sign up (tenant A = café under test, tenant B = the neighbour)
-- ---------------------------------------------------------------------------
select test.put('owner_a', '00000000-0000-7000-8000-00000000000a');
select test.put('owner_b', '00000000-0000-7000-8000-00000000000b');
insert into auth.users (id, email) values (test.id('owner_a'), 'a@example.com'), (test.id('owner_b'), 'b@example.com');

set role authenticated;

select test.as_user(test.id('owner_b'));
select test.put('tenant_b', (app.create_tenant('{"name":"ร้านข้างบ้าน","owner_name":"บี"}')->>'tenant_id')::uuid);

select test.as_user(test.id('owner_a'));
do $$
declare r jsonb;
begin
  r := app.create_tenant('{"name":"สบายคาเฟ่","business_type":"cafe","branch_name":"สาขาสุขุมวิท","owner_name":"คุณเอ","vat_registered":true}');
  perform test.put('tenant_a', (r->>'tenant_id')::uuid);
  perform test.put('branch_a', (r->>'branch_id')::uuid);
  perform test.put('owner_mem_a', (r->>'membership_id')::uuid);
end $$;

-- Smart defaults exist and are visible through RLS.
select test.ok((select count(*) from app.roles where tenant_id = test.id('tenant_a')) = 7, 'seven role templates');
select test.ok((select count(*) from app.accounts where tenant_id = test.id('tenant_a')) >= 30, 'chart of accounts installed');
select test.ok((select count(*) from app.kitchen_stations where branch_id = test.id('branch_a')) = 2, 'kitchen + bar stations');
select test.ok((select count(*) from app.payment_methods where tenant_id = test.id('tenant_a') and is_active) = 2, 'cash + platform active by default');

-- Onboarding facts start mostly empty.
select test.ok((select not branch_ready and not payments_ready and ingredients = 0 and not has_sale
                  from app.v_onboarding_facts where tenant_id = test.id('tenant_a')), 'fresh onboarding facts');

-- Owner finishes the branch + payment steps.
update app.branches set address = '99 สุขุมวิท 24', phone = '021234567' where id = test.id('branch_a');
update app.payment_methods set is_active = true, config = '{"promptpay_id":"0812345678"}'
 where tenant_id = test.id('tenant_a') and kind = 'promptpay';
select test.ok((select branch_ready and payments_ready from app.v_onboarding_facts where tenant_id = test.id('tenant_a')),
               'branch + payments steps detected automatically');

-- ---------------------------------------------------------------------------
-- 2. Ingredients, prep recipe (untracked syrup), menu with modifiers + recipes
-- ---------------------------------------------------------------------------
do $$
declare
  t uuid := test.id('tenant_a');
  brand uuid;
  cat uuid;
  latte uuid;
  g_milk uuid; g_extra uuid;
  o_oat uuid; o_shot uuid;
  r uuid;
begin
  insert into app.ingredients (tenant_id, name, base_unit, display_unit, reorder_point, par_level, standard_cost, is_high_value)
  values (t, 'เมล็ดกาแฟ', 'g', 'kg', 500, 2000, 0.45, true) returning id into r; perform test.put('coffee', r);
  insert into app.ingredients (tenant_id, name, base_unit, display_unit, reorder_point, standard_cost)
  values (t, 'นมสด', 'ml', 'l', 2000, 0.045) returning id into r; perform test.put('milk', r);
  insert into app.ingredients (tenant_id, name, base_unit, display_unit, standard_cost)
  values (t, 'นมโอ๊ต', 'ml', 'l', 0.12) returning id into r; perform test.put('oat', r);
  insert into app.ingredients (tenant_id, name, base_unit, display_unit, standard_cost)
  values (t, 'น้ำตาลทราย', 'g', 'kg', 0.03) returning id into r; perform test.put('sugar', r);
  insert into app.ingredients (tenant_id, name, base_unit, kind, track_stock)
  values (t, 'น้ำเชื่อม', 'ml', 'prep', false) returning id into r; perform test.put('syrup', r);

  -- Syrup: 500 g sugar → 1000 ml syrup (cost 0.015/ml, exploded at sale).
  insert into app.recipes (tenant_id, kind, output_ingredient_id, yield_qty) values (t, 'prep', test.id('syrup'), 1000) returning id into r;
  insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty) values (t, r, test.id('sugar'), 500);

  select id into brand from app.brands where tenant_id = t and is_default;
  insert into app.menu_categories (tenant_id, brand_id, name) values (t, brand, 'กาแฟ') returning id into cat;
  insert into app.menu_items (tenant_id, brand_id, category_id, name, price, kitchen_route)
  values (t, brand, cat, 'ลาเต้เย็น', 65, 'bar') returning id into latte; perform test.put('latte', latte);

  insert into app.recipes (tenant_id, kind, menu_item_id) values (t, 'menu_item', latte) returning id into r;
  insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty) values
    (t, r, test.id('coffee'), 18), (t, r, test.id('milk'), 180), (t, r, test.id('syrup'), 20);

  insert into app.modifier_groups (tenant_id, brand_id, name, min_select, max_select) values (t, brand, 'เปลี่ยนนม', 0, 1) returning id into g_milk;
  insert into app.modifier_options (tenant_id, group_id, name, price_delta) values (t, g_milk, 'นมโอ๊ต', 15) returning id into o_oat;
  insert into app.modifier_options (tenant_id, group_id, name, price_delta) values (t, g_milk, 'นมอัลมอนด์', 20) returning id into r;
  perform test.put('opt_almond', r);
  insert into app.modifier_groups (tenant_id, brand_id, name, min_select, max_select) values (t, brand, 'เพิ่ม', 0, 2) returning id into g_extra;
  insert into app.modifier_options (tenant_id, group_id, name, price_delta) values (t, g_extra, 'เพิ่มช็อต', 15) returning id into o_shot;
  insert into app.menu_item_modifier_groups (tenant_id, menu_item_id, group_id) values (t, latte, g_milk), (t, latte, g_extra);
  perform test.put('opt_oat', o_oat);
  perform test.put('opt_shot', o_shot);

  -- Oat milk substitutes fresh milk (negative line allowed on modifier recipes only).
  insert into app.recipes (tenant_id, kind, modifier_option_id) values (t, 'modifier_option', o_oat) returning id into r;
  insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty) values (t, r, test.id('milk'), -180), (t, r, test.id('oat'), 180);
  insert into app.recipes (tenant_id, kind, modifier_option_id) values (t, 'modifier_option', o_shot) returning id into r;
  insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty) values (t, r, test.id('coffee'), 18);
end $$;

-- Negative qty is rejected on a normal menu recipe.
select test.throws(format($q$insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty)
  select %L, id, %L, -5 from app.recipes where menu_item_id = %L$q$, test.id('tenant_a'), test.id('sugar'), test.id('latte')),
  'RECIPE_QTY_MUST_BE_POSITIVE');

-- Theoretical cost before any purchase uses standard cost:
-- 18 g × 0.45 + 180 ml × 0.045 + 20 ml syrup × (500 g × 0.03 / 1000) = 8.10 + 8.10 + 0.30 = 16.50
select test.ok(app.menu_item_cost(test.id('latte')) = 16.50, 'latte theoretical cost 16.50, got ' || app.menu_item_cost(test.id('latte')));

-- ---------------------------------------------------------------------------
-- 3. Receive goods (credit from a supplier → AP bill + GL entry)
-- ---------------------------------------------------------------------------
do $$
declare
  sup uuid;
  r jsonb;
begin
  insert into app.suppliers (tenant_id, name, payment_terms_days) values (test.id('tenant_a'), 'โรงคั่วดอยช้าง', 30) returning id into sup;
  perform test.put('supplier', sup);
  r := app.receive_goods(jsonb_build_object(
    'branch_id', test.id('branch_a'), 'supplier_id', sup, 'invoice_no', 'INV-001', 'vat_amount', 70,
    'lines', jsonb_build_array(
      jsonb_build_object('ingredient_id', test.id('coffee'), 'pack_name', 'ถุง 1 กก.', 'pack_qty', 1000, 'qty_packs', 2, 'unit_price', 500),
      jsonb_build_object('ingredient_id', test.id('milk'), 'pack_name', 'ขวด 2 ลิตร', 'pack_qty', 2000, 'qty_packs', 3, 'unit_price', 100),
      jsonb_build_object('ingredient_id', test.id('oat'), 'pack_name', 'กล่อง 1 ลิตร', 'pack_qty', 1000, 'qty_packs', 1, 'unit_price', 120),
      jsonb_build_object('ingredient_id', test.id('sugar'), 'pack_name', 'ถุง 1 กก.', 'pack_qty', 1000, 'qty_packs', 1, 'unit_price', 30))));
  perform test.ok((r->>'total')::numeric = 1450 + 70, 'GR total incl. VAT');
end $$;

select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('coffee')) = 2000, 'coffee on hand 2000 g');
select test.ok((select avg_cost from app.stock_balances where ingredient_id = test.id('coffee')) = 0.5, 'coffee avg cost 0.50/g');
select test.ok((select count(*) from app.bills where tenant_id = test.id('tenant_a') and status = 'open') = 1, 'AP bill created');
select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant_a')), 'GL balanced after receipt');
-- Price alert fired (coffee 0.45 standard → 0.50 is not "last cost", so no alert on first buy).
select test.ok((select count(*) from app.domain_events where event_type = 'inventory.price_increased' and tenant_id = test.id('tenant_a')) = 0, 'no price alert on first purchase');

-- ---------------------------------------------------------------------------
-- 4. Sell: shift → order (server re-prices) → KDS → pay → stock consumed
-- ---------------------------------------------------------------------------
select test.put('shift', app.open_shift(test.id('branch_a'), 1000));
select test.throws(format('select app.open_shift(%L, 500)', test.id('branch_a')), 'SHIFT_ALREADY_OPEN');

do $$
declare
  ch uuid := (select id from app.sales_channels where tenant_id = test.id('tenant_a') and key = 'dine_in');
  r jsonb;
  oid uuid := app.uuid_v7();
begin
  perform test.put('order1', oid);
  r := app.submit_order(jsonb_build_object(
    'id', oid, 'branch_id', test.id('branch_a'), 'channel_id', ch, 'guest_count', 2,
    'items', jsonb_build_array(
      jsonb_build_object('id', app.uuid_v7(), 'menu_item_id', test.id('latte'), 'qty', 1),
      jsonb_build_object('id', app.uuid_v7(), 'menu_item_id', test.id('latte'), 'qty', 1,
                         'modifier_option_ids', jsonb_build_array(test.id('opt_oat')), 'note', 'หวานน้อย'))));
  -- 65 + (65 + 15) = 145, VAT included: 145 × 7/107 = 9.49
  perform test.ok((r->>'total')::numeric = 145, 'order total 145, got ' || (r->>'total'));
  perform test.ok((r->>'vat_amount')::numeric = 9.49, 'VAT 9.49, got ' || (r->>'vat_amount'));
  perform test.ok(r->>'order_no' = '001', 'first order number of the day is 001');

  -- Idempotent retry (same payload) does not duplicate anything.
  r := app.submit_order(jsonb_build_object('id', oid, 'branch_id', test.id('branch_a'), 'channel_id', ch, 'items', '[]'::jsonb));
  perform test.ok((r->>'total')::numeric = 145, 'retry is idempotent');
end $$;

-- Too many modifiers in a max=1 group is refused with a human-mappable code.
select test.throws(format($q$select app.submit_order(jsonb_build_object('id', %L, 'branch_id', %L,
  'items', jsonb_build_array(jsonb_build_object('menu_item_id', %L, 'modifier_option_ids', jsonb_build_array(%L, %L)))))$q$,
  test.id('order1'), test.id('branch_a'), test.id('latte'), test.id('opt_oat'), test.id('opt_almond')), 'MODIFIER_SELECTION');

-- Latte routes to the bar station → one ticket with two items.
select test.ok((select count(*) from app.kitchen_tickets kt join app.kitchen_stations ks on ks.id = kt.station_id
                 where kt.order_id = test.id('order1') and ks.route_key = 'bar') = 1, 'one bar ticket');
select test.ok((select count(*) from app.kitchen_ticket_items ti join app.kitchen_tickets kt on kt.id = ti.ticket_id
                 where kt.order_id = test.id('order1')) = 2, 'two ticket items');

-- Paying the wrong total is refused; the right total with change works.
select test.throws(format($q$select app.pay_order(%L, jsonb_build_array(jsonb_build_object('method_id',
  (select id from app.payment_methods where tenant_id = %L and kind = 'cash'), 'amount', 100)))$q$,
  test.id('order1'), test.id('tenant_a')), 'PAYMENT_TOTAL_MISMATCH');

do $$
declare r jsonb;
begin
  r := app.pay_order(test.id('order1'), jsonb_build_array(jsonb_build_object(
    'method_id', (select id from app.payment_methods where tenant_id = test.id('tenant_a') and kind = 'cash'),
    'amount', 145, 'tendered', 200)));
  perform test.ok((r->>'change')::numeric = 55, 'change 55');
  perform test.ok(r->>'receipt_no' like 'HQ-____-00001', 'receipt number format, got ' || (r->>'receipt_no'));
end $$;

-- Stock: coffee 2 × 18 = 36 g; milk 180 (oat replaced the other 180); oat 180; sugar 2 × 20 ml × 0.5 g/ml = 20 g.
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('coffee')) = 2000 - 36, 'coffee consumed');
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('milk')) = 6000 - 180, 'milk consumed (substitution)');
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('oat')) = 1000 - 180, 'oat milk consumed');
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('sugar')) = 1000 - 20, 'syrup exploded into sugar');
select test.ok((select cost_total from app.orders where id = test.id('order1')) > 0, 'order cost recorded');

-- Paying again is a safe no-op (flaky Wi-Fi retry).
select test.ok((app.pay_order(test.id('order1'), '[]'::jsonb)->>'status') = 'paid', 'pay is idempotent');

-- KDS: bump ready, then recall (undo), then ready again.
do $$
declare kt uuid := (select id from app.kitchen_tickets where order_id = test.id('order1') limit 1);
begin
  perform app.set_ticket_status(kt, 'in_progress');
  perform app.set_ticket_status(kt, 'ready');
  perform test.ok((select bool_and(status = 'ready') from app.order_items where order_id = test.id('order1')), 'items ready');
  perform app.set_ticket_status(kt, 'in_progress');
  perform test.ok((select bool_and(status = 'sent') from app.order_items where order_id = test.id('order1')), 'recall puts items back');
  perform app.set_ticket_status(kt, 'ready');
end $$;

-- Ledgers are append-only: app users have no UPDATE grant at all, and even a
-- privileged role is stopped by the immutability trigger.
select test.throws(format('update app.stock_movements set qty = 1 where ingredient_id = %L', test.id('coffee')),
                   'permission denied for table stock_movements');
reset role;
select test.throws(format('update app.stock_movements set qty = 1 where ingredient_id = %L', test.id('coffee')), 'LEDGER_IMMUTABLE');
select test.throws(format('delete from app.payments where order_id = %L', test.id('order1')), 'LEDGER_IMMUTABLE');
set role authenticated;

-- ---------------------------------------------------------------------------
-- 5. PIN-only cashier: limited powers, manager approval by PIN
-- ---------------------------------------------------------------------------
do $$
declare
  cashier uuid;
  manager uuid;
begin
  insert into app.memberships (tenant_id, display_name, role_id, limits)
  values (test.id('tenant_a'), 'น้องแคช', (select id from app.roles where tenant_id = test.id('tenant_a') and key = 'cashier'),
          '{"max_discount_rate":0.1}')
  returning id into cashier;
  insert into app.memberships (tenant_id, display_name, role_id)
  values (test.id('tenant_a'), 'พี่ผู้จัดการ', (select id from app.roles where tenant_id = test.id('tenant_a') and key = 'manager'))
  returning id into manager;
  perform app.set_member_pin(cashier, '1111');
  perform app.set_member_pin(manager, '9999');
  perform test.put('cashier', cashier);
  perform test.put('manager', manager);
end $$;
select test.throws(format('select app.set_member_pin(%L, %L)', test.id('manager'), '1111'), 'PIN_IN_USE');
select test.ok(app.verify_pin(test.id('tenant_a'), test.id('branch_a'), '1111') = test.id('cashier'), 'PIN resolves cashier');

select test.as_member(test.id('cashier'));
do $$
declare
  ch uuid := (select id from app.sales_channels where tenant_id = test.id('tenant_a') and key = 'takeaway');
  oid uuid := app.uuid_v7();
  item uuid := app.uuid_v7();
  appr uuid;
begin
  perform test.put('order2', oid);
  perform app.submit_order(jsonb_build_object('id', oid, 'branch_id', test.id('branch_a'), 'channel_id', ch,
    'items', jsonb_build_array(jsonb_build_object('id', item, 'menu_item_id', test.id('latte'), 'qty', 2))));

  -- Cashier's own cap is 10 %: 5 % is fine, 20 % needs a manager.
  perform app.apply_order_discount(oid, 'percent', 5, 'ลูกค้าประจำ');
  perform test.throws(format('select app.apply_order_discount(%L, %L, 20, %L)', oid, 'percent', 'ลูกค้าประจำ'), 'APPROVAL_REQUIRED');
  appr := app.request_approval(test.id('branch_a'), 'pos.discount', '9999', 'order', oid, 'ลูกค้าประจำ');
  perform app.apply_order_discount(oid, 'percent', 20, 'ลูกค้าประจำ', appr);
  perform test.ok((select discount_total from app.orders where id = oid) = 26, '20 % of 130 = 26');
  -- An approval is single-use.
  perform test.throws(format('select app.apply_order_discount(%L, %L, 25, %L, %L)', oid, 'percent', 'x', appr), 'APPROVAL_INVALID');

  -- Voiding an item the bar already has requires approval; wrong PIN is refused.
  perform test.throws(format('select app.void_order_item(%L, %L)', item, 'ลูกค้าเปลี่ยนใจ'), 'APPROVAL_REQUIRED');
  perform test.throws(format('select app.request_approval(%L, %L, %L)', test.id('branch_a'), 'pos.void', '0000'), 'APPROVAL_PIN_INVALID');
  perform test.throws(format('select app.request_approval(%L, %L, %L)', test.id('branch_a'), 'pos.void', '1111'), 'APPROVER_NOT_ALLOWED');
  appr := app.request_approval(test.id('branch_a'), 'pos.void', '9999', 'order_item', item, 'ลูกค้าเปลี่ยนใจ');
  perform app.void_order_item(item, 'ลูกค้าเปลี่ยนใจ', appr);
  perform test.ok((select status from app.kitchen_ticket_items where order_item_id = item) = 'voided', 'kitchen sees the void');
  perform app.void_order(oid, 'ลูกค้ายกเลิก');
end $$;

-- Cashier cannot see money reports or approve counts.
select test.ok((select count(*) from app.journal_entries) = 0, 'cashier sees no journal entries (RLS)');
select test.ok((select count(*) from app.bills) = 0, 'cashier sees no bills (RLS)');
select test.throws(format('select app.start_stock_count(%L)', app.default_location(test.id('branch_a'))), 'PERMISSION_DENIED');

-- ---------------------------------------------------------------------------
-- 6. Waste + blind stock count (manager)
-- ---------------------------------------------------------------------------
select test.as_member(test.id('manager'));
select app.record_waste(app.default_location(test.id('branch_a')), test.id('milk'), 200, 'spoiled', 'นมบูด');
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('milk')) = 6000 - 180 - 200, 'waste deducted');

do $$
declare c uuid; r jsonb;
begin
  c := app.start_stock_count(app.default_location(test.id('branch_a')));
  perform app.record_count(c, test.id('coffee'), 1950);   -- expected 1964 → −14 g
  perform app.record_count(c, test.id('milk'), 5620);     -- expected 5620 → 0
  r := app.submit_stock_count(c);
  perform test.ok((r->>'uncounted')::int = 2, 'two lines left uncounted (oat, sugar)');
  r := app.approve_stock_count(c);
  perform test.ok((r->>'adjusted_lines')::int = 1, 'only the coffee line adjusted; uncounted lines untouched');
end $$;
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('coffee')) = 1950, 'coffee set to counted qty');
select test.ok((select qty_on_hand from app.stock_balances where ingredient_id = test.id('oat')) = 820, 'uncounted oat not zeroed');

-- ---------------------------------------------------------------------------
-- 7. Close shift and day → GL balanced, expectations generated, period locked
-- ---------------------------------------------------------------------------
select test.as_user(test.id('owner_a'));
select test.throws(format('select app.close_business_day(%L, %L)', test.id('branch_a'), app.business_date(test.id('branch_a'))), 'OPEN_SHIFTS_EXIST');
do $$
declare r jsonb;
begin
  r := app.close_shift(test.id('shift'), 1140);   -- float 1000 + cash 145 = 1145 expected → −5
  perform test.ok((r->>'variance')::numeric = -5, 'cash short by 5');
end $$;

do $$
declare
  d date := app.business_date(test.id('branch_a'));
  r jsonb;
begin
  r := app.close_business_day(test.id('branch_a'), d, 'ปิดยอดวันแรก');
  perform test.ok((r->>'orders')::int = 1, 'one paid order in the day');
  perform test.ok((r->>'total')::numeric = 145, 'day total 145');
  -- Idempotent: closing again returns the same summary.
  perform test.ok((app.close_business_day(test.id('branch_a'), d)->>'total')::numeric = 145, 'close is idempotent');
  -- New activity rolls into the next business day instead of failing.
  perform test.ok(app.business_date(test.id('branch_a')) = d + 1, 'business date rolls forward after close');
end $$;

select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant_a')), 'GL balanced after day close');
select test.ok((select sum(credit) from app.journal_lines jl join app.accounts a on a.id = jl.account_id
                 where a.system_key = 'vat_output' and jl.tenant_id = test.id('tenant_a')) = 9.49, 'VAT output posted');
select test.ok((select sum(debit) from app.journal_lines jl join app.accounts a on a.id = jl.account_id
                 where a.system_key = 'cash_over_short' and jl.tenant_id = test.id('tenant_a')) = 5, 'cash short expensed');
select test.ok((select sum(debit) - sum(credit) from app.journal_lines jl join app.accounts a on a.id = jl.account_id
                 where a.system_key = 'waste_expense' and jl.tenant_id = test.id('tenant_a')) > 0, 'waste expensed');

-- P&L read model answers "เหลือเงินจริงเท่าไร".
select test.ok((select net_sales from app.v_branch_daily_pnl where branch_id = test.id('branch_a') order by business_date limit 1) = 135.51,
               'net sales ex VAT 135.51');

-- Reopen: GL entries reversed, still balanced.
select app.reopen_business_day(test.id('branch_a'), (select business_date from app.day_closes where branch_id = test.id('branch_a')), 'ลืมบันทึกของเสีย');
select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant_a')), 'GL balanced after reopen');

-- A monthly bill is spread over its service period (30 days × 100 = 3,000).
do $$
declare
  d date := app.business_date(test.id('branch_a'));
  rent uuid := (select id from app.accounts where tenant_id = test.id('tenant_a') and system_key = 'rent');
begin
  perform app.record_expense(jsonb_build_object('branch_id', test.id('branch_a'), 'account_id', rent,
    'description', 'ค่าเช่าร้าน', 'amount', 3000, 'paid_from', 'bank', 'period_start', d - 10, 'period_end', d + 19));
  perform test.ok((select expenses from app.v_branch_daily_pnl where branch_id = test.id('branch_a') and business_date = d + 5) = 100,
                  'monthly expense spread per day');
  perform test.ok((select sum(expenses) from app.v_branch_daily_pnl where branch_id = test.id('branch_a') and business_date between d - 10 and d + 19) = 3000,
                  'spread sums back to the full amount');
end $$;
select test.throws(format('select app.record_expense(%L::jsonb)', jsonb_build_object('branch_id', test.id('branch_a'),
  'account_id', (select id from app.accounts where tenant_id = test.id('tenant_a') and system_key = 'rent'),
  'description', 'x', 'amount', 1, 'paid_from', 'bank', 'period_start', '2026-09-30', 'period_end', '2026-09-01')), 'INVALID_PERIOD');

-- The only owner can't be demoted or removed (the shop would be locked out).
select test.throws(format('update app.memberships set status = %L where tenant_id = %L and user_id = %L', 'suspended', test.id('tenant_a'), test.id('owner_a')), 'LAST_OWNER');

-- ---------------------------------------------------------------------------
-- 8. Tenant isolation: owner B sees nothing of A and cannot act on A's data
-- ---------------------------------------------------------------------------
select test.as_user(test.id('owner_b'));
select test.ok((select count(*) from app.orders where tenant_id = test.id('tenant_a')) = 0, 'B cannot read A orders');
select test.ok((select count(*) from app.menu_items where tenant_id = test.id('tenant_a')) = 0, 'B cannot read A menu');
select test.ok((select count(*) from app.memberships where tenant_id = test.id('tenant_a')) = 0, 'B cannot read A staff');
select test.ok((select count(*) from app.tenants) = 1, 'B sees exactly one tenant');
select test.throws(format('select app.open_shift(%L, 0)', test.id('branch_a')), 'PERMISSION_DENIED');
select test.throws(format('select app.pay_order(%L, %L::jsonb)', test.id('order1'), '[]'), 'PERMISSION_DENIED');
do $$
begin
  update app.menu_items set price = 1 where tenant_id = test.id('tenant_a');
  perform test.ok(not found, 'B cannot update A menu prices');
end $$;

-- ---------------------------------------------------------------------------
-- 9. Audit trail & activity feed
-- ---------------------------------------------------------------------------
select test.as_user(test.id('owner_a'));
select test.ok((select count(*) from audit.log where tenant_id = test.id('tenant_a') and table_name = 'menu_items') >= 1, 'menu change audited');
select test.ok((select count(*) from audit.log where row_data ? 'pin_hash') = 0, 'PIN hashes never land in the audit log');
select test.ok((select count(*) from app.domain_events where event_type = 'order.item_voided') = 1, 'void is in the activity feed');

reset role;
select 'ALL DATABASE TESTS PASSED' as result;
