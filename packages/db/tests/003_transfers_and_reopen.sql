-- =============================================================================
-- Two things that moved money or stock and had no test: sending stock from one branch to another (create → send → receive,
-- including a short delivery), and reopening a day that was closed.
--
--   pnpm --filter @sabai/db test:sql
--
-- Builds its own café with two branches, as the real `authenticated` role, so permissions and RLS apply.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists test;
grant usage on schema test to authenticated;
create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;
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
-- Quantity on the shelf at a branch's main location.
create or replace function test.qty(p_branch text, p_ingredient text) returns numeric language sql stable as $$
  select coalesce((select b.qty_on_hand from app.stock_balances b
                    join app.stock_locations l on l.id = b.location_id and l.branch_id = test.id(p_branch) and l.is_default
                   where b.ingredient_id = test.id(p_ingredient)), 0)
$$;
grant execute on all functions in schema test to authenticated;

-- ---------------------------------------------------------------------------
-- Setup: owner, tenant, two branches, two ingredients with stock at branch A, a cashier, another shop
-- ---------------------------------------------------------------------------
select test.put('owner', '00000000-0000-7000-8003-0000000000a1');
select test.put('stranger', '00000000-0000-7000-8003-0000000000b1');
insert into auth.users (id, email) values (test.id('owner'), 'transfer-owner@example.com'), (test.id('stranger'), 'transfer-stranger@example.com');

set role authenticated;
select test.as_user(test.id('stranger'));
select test.put('tenant_other', (app.create_tenant('{"name":"ร้านอื่น","owner_name":"คนอื่น"}')->>'tenant_id')::uuid);
select test.put('loc_other', (select id from app.stock_locations where tenant_id = test.id('tenant_other') and is_default limit 1));

select test.as_user(test.id('owner'));
do $$
declare r jsonb; cashier uuid;
begin
  r := app.create_tenant('{"name":"ร้านโอนของ","business_type":"cafe","branch_name":"สาขาต้นทาง","owner_name":"คุณเอ","vat_registered":true}');
  perform test.put('tenant', (r->>'tenant_id')::uuid);
  perform test.put('branch_a', (r->>'branch_id')::uuid);
  perform test.put('branch_b', app.add_branch(jsonb_build_object('tenant_id', (r->>'tenant_id')::uuid, 'code', 'TB', 'name', 'สาขาปลายทาง')));
  perform test.put('loc_a', (select id from app.stock_locations where branch_id = test.id('branch_a') and is_default));
  perform test.put('loc_b', (select id from app.stock_locations where branch_id = test.id('branch_b') and is_default));

  insert into app.ingredients (tenant_id, name, base_unit, kind, track_stock, standard_cost)
  values (test.id('tenant'), 'เมล็ดกาแฟ', 'g', 'raw', true, 0.80), (test.id('tenant'), 'นมสด', 'ml', 'raw', true, 0.045);
  perform test.put('coffee', (select id from app.ingredients where tenant_id = test.id('tenant') and name = 'เมล็ดกาแฟ'));
  perform test.put('milk', (select id from app.ingredients where tenant_id = test.id('tenant') and name = 'นมสด'));
  perform app.record_opening_stock(test.id('loc_a'), test.id('coffee'), 1000, 0.80);
  perform app.record_opening_stock(test.id('loc_a'), test.id('milk'), 5000, 0.045);

  insert into app.memberships (tenant_id, display_name, role_id, all_branches)
  values (test.id('tenant'), 'แคชเชียร์', (select id from app.roles where tenant_id = test.id('tenant') and key = 'cashier'), true) returning id into cashier;
  perform test.put('cashier', cashier);
end $$;

-- ===========================================================================
-- A. Stock transfers
-- ===========================================================================

-- A1. A draft moves nothing. Numbers run per branch and day.
do $$
declare t1 uuid; t2 uuid;
begin
  t1 := app.create_transfer(jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_b'), 'note', 'ส่งของไปสาขาปลายทาง',
          'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty', 100), jsonb_build_object('ingredient_id', test.id('milk'), 'qty', 500))));
  t2 := app.create_transfer(jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_b'),
          'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty', 50))));
  perform test.put('t_full', t1);
  perform test.put('t_short', t2);
  perform test.ok((select status from app.stock_transfers where id = t1) = 'draft', 'a new transfer is a draft');
  perform test.ok((select transfer_no from app.stock_transfers where id = t1) like 'T______-001', 'first transfer number of the day is 001, got ' || (select transfer_no from app.stock_transfers where id = t1));
  perform test.ok((select transfer_no from app.stock_transfers where id = t2) like 'T______-002', 'the next one is 002');
  perform test.ok((select count(*) from app.stock_transfer_lines where transfer_id = t1) = 2, 'two lines');
  perform test.ok(test.qty('branch_a', 'coffee') = 1000 and test.qty('branch_b', 'coffee') = 0, 'a draft moves no stock');
end $$;

-- A2. Who may, and what is refused.
select test.as_member(test.id('cashier'));
select test.throws(format('select app.create_transfer(%L::jsonb)', jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_b'),
  'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty', 1)))), 'PERMISSION_DENIED');
select test.throws(format('select app.send_transfer(%L)', test.id('t_full')), 'PERMISSION_DENIED');
select test.throws(format('select app.receive_transfer(%L)', test.id('t_full')), 'PERMISSION_DENIED');
select test.as_user(test.id('owner'));
select test.throws(format('select app.receive_transfer(%L)', test.id('t_full')), 'TRANSFER_NOT_SENT');   -- still a draft
select test.throws(format('select app.send_transfer(%L)', gen_random_uuid()), 'NOT_FOUND');
-- Into another shop's location: refused, and that shop sees nothing of ours.
select test.throws(format('select app.create_transfer(%L::jsonb)', jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_other'),
  'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty', 1)))), 'NOT_FOUND');
do $$
begin
  -- A transfer to the same place, or of nothing / a negative amount, is refused by the table itself.
  begin
    perform app.create_transfer(jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_a'),
      'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty', 1))));
    raise exception 'ASSERTION FAILED: moving stock to the same place was accepted';
  exception when check_violation then null; end;
  begin
    perform app.create_transfer(jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_b'),
      'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty', -5))));
    raise exception 'ASSERTION FAILED: a negative quantity was accepted';
  exception when check_violation then null; end;
end $$;

-- A3. Sending takes the stock off the source branch at what it cost, once.
do $$
begin
  perform app.send_transfer(test.id('t_full'));
  perform test.ok((select status from app.stock_transfers where id = test.id('t_full')) = 'sent', 'status is sent');
  perform test.ok(test.qty('branch_a', 'coffee') = 900 and test.qty('branch_a', 'milk') = 4500, 'source lost what was sent');
  perform test.ok(test.qty('branch_b', 'coffee') = 0, 'destination has not received it yet');
  perform test.ok((select unit_cost from app.stock_transfer_lines where transfer_id = test.id('t_full') and ingredient_id = test.id('coffee')) = 0.80, 'the line records what it cost');
  perform test.ok((select count(*) from app.stock_movements where source_type = 'transfer' and source_id = test.id('t_full') and reason = 'transfer_out') = 2, 'one movement out per line');
end $$;
select test.throws(format('select app.send_transfer(%L)', test.id('t_full')), 'TRANSFER_NOT_DRAFT');
select test.ok(test.qty('branch_a', 'coffee') = 900, 'sending twice did not take the stock twice');

-- A4. Receiving in full puts it into the destination at the same cost, once, and nothing is lost.
do $$
begin
  perform app.receive_transfer(test.id('t_full'));
  perform test.ok((select status from app.stock_transfers where id = test.id('t_full')) = 'received', 'status is received');
  perform test.ok(test.qty('branch_b', 'coffee') = 100 and test.qty('branch_b', 'milk') = 500, 'destination has what was sent');
  perform test.ok((select avg_cost from app.stock_balances where location_id = test.id('loc_b') and ingredient_id = test.id('coffee')) = 0.80, 'at the cost it left with');
  perform test.ok(not exists (select 1 from app.stock_movements where source_id = test.id('t_full') and reason = 'waste'), 'nothing written off when all arrived');
end $$;
select test.throws(format('select app.receive_transfer(%L)', test.id('t_full')), 'TRANSFER_NOT_SENT');
select test.ok(test.qty('branch_b', 'coffee') = 100, 'receiving twice did not add it twice');

-- A5. A short delivery: what arrived is stocked, what did not is a visible loss at the receiving branch — not a silent gap.
do $$
begin
  perform app.send_transfer(test.id('t_short'));
  perform app.receive_transfer(test.id('t_short'), jsonb_build_array(jsonb_build_object('ingredient_id', test.id('coffee'), 'qty_received', 40)));
  perform test.ok(test.qty('branch_a', 'coffee') = 850, 'source lost all 50');
  perform test.ok(test.qty('branch_b', 'coffee') = 140, 'destination stocked only the 40 that arrived (100 + 40)');
  perform test.ok((select count(*) from app.stock_movements where source_id = test.id('t_short') and reason = 'waste' and reason_code = 'transfer_loss' and qty = -10) = 1, 'the 10 missing are written off as a transfer loss');
  perform test.ok((select -total_cost from app.stock_movements where source_id = test.id('t_short') and reason = 'waste') = 8.00, 'the loss is worth 10 g × ฿0.80');
  perform test.ok((select waste from app.v_branch_daily_pnl where branch_id = test.id('branch_b') and business_date = app.business_date(test.id('branch_b'))) = 8.00, 'and it shows as waste in the receiving branch''s profit');
end $$;

-- A6. A destination cannot be handed more than was sent (that would make stock out of nothing), or a negative amount.
do $$
declare t uuid;
begin
  t := app.create_transfer(jsonb_build_object('from_location_id', test.id('loc_a'), 'to_location_id', test.id('loc_b'),
         'lines', jsonb_build_array(jsonb_build_object('ingredient_id', test.id('milk'), 'qty', 200))));
  perform test.put('t_over', t);
  perform app.send_transfer(t);
end $$;
select test.throws(format('select app.receive_transfer(%L, %L::jsonb)', test.id('t_over'),
  jsonb_build_array(jsonb_build_object('ingredient_id', test.id('milk'), 'qty_received', 250))), 'TRANSFER_OVER_RECEIVED');
select test.ok(test.qty('branch_b', 'milk') = 500 and (select status from app.stock_transfers where id = test.id('t_over')) = 'sent', 'a refused receipt changes nothing: still sent, nothing stocked');
do $$
begin
  begin
    perform app.receive_transfer(test.id('t_over'), jsonb_build_array(jsonb_build_object('ingredient_id', test.id('milk'), 'qty_received', -1)));
    raise exception 'ASSERTION FAILED: a negative received quantity was accepted';
  exception when check_violation then null; end;
  perform app.receive_transfer(test.id('t_over'));   -- the whole 200 can still be received afterwards
end $$;
select test.ok(test.qty('branch_b', 'milk') = 700, 'a correct receipt after the refused one works');

-- A7. The other shop cannot see any of it.
select test.as_user(test.id('stranger'));
select test.ok((select count(*) from app.stock_transfers) = 0, 'another shop sees none of our transfers');
select test.ok((select count(*) from app.stock_transfer_lines) = 0, 'nor their lines');
select test.throws(format('select app.send_transfer(%L)', test.id('t_over')), 'PERMISSION_DENIED');   -- and cannot act on it either
select test.as_user(test.id('owner'));

-- A8. Closing both branches' days: the books balance, and "in transit" nets to nothing once everything has arrived.
do $$
declare da date := app.business_date(test.id('branch_a')); db date := app.business_date(test.id('branch_b'));
begin
  perform app.close_business_day(test.id('branch_a'), da, 'ปิดต้นทาง');
  perform app.close_business_day(test.id('branch_b'), db, 'ปิดปลายทาง');
end $$;
reset role;
select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant')), 'the ledger balances after the transfers');
select test.ok((select coalesce(sum(jl.debit - jl.credit), 0) from app.journal_lines jl join app.accounts a on a.id = jl.account_id
                 where jl.tenant_id = test.id('tenant') and a.system_key = 'inventory_in_transit') = 0, 'stock in transit nets to nothing once every transfer has arrived');
select test.ok((select coalesce(sum(jl.debit - jl.credit), 0) from app.journal_lines jl join app.accounts a on a.id = jl.account_id
                 where jl.tenant_id = test.id('tenant') and a.system_key = 'waste_expense') = 8.00, 'the only waste in the books is the 10 g that went missing');

-- ===========================================================================
-- B. Reopening a closed day
-- ===========================================================================
set role authenticated;
select test.as_user(test.id('owner'));

-- B1. What is refused.
select test.throws(format('select app.reopen_business_day(%L, %L, %L)', test.id('branch_a'), current_date + 30, 'ไม่เคยปิด'), 'DAY_NOT_CLOSED');
select test.as_member(test.id('cashier'));
select test.throws(format('select app.reopen_business_day(%L, app.business_date(%L) - 1, %L)', test.id('branch_a'), test.id('branch_a'), 'ลองดู'), 'PERMISSION_DENIED');
select test.as_user(test.id('owner'));
select test.throws(format('select app.reopen_business_day(%L, app.business_date(%L) - 1, %L)', test.id('branch_a'), test.id('branch_a'), ''), 'REASON_REQUIRED');
select test.throws(format('select app.reopen_business_day(%L, app.business_date(%L) - 1, %L)', test.id('branch_a'), test.id('branch_a'), '   '), 'REASON_REQUIRED');

-- B2. A day whose money has already been matched against the bank cannot be reopened.
reset role;
do $$
declare d date := app.business_date(test.id('branch_b')) - 1;
begin
  insert into app.expected_receipts (tenant_id, branch_id, business_date, source_type, label, clearing_account_id, expected_date, expected_amount, matched_amount, status)
  values (test.id('tenant'), test.id('branch_b'), d, 'other', 'ตรวจกับธนาคารแล้ว', (select id from app.accounts where tenant_id = test.id('tenant') and system_key = 'bank'), d, 100, 100, 'matched');
end $$;
set role authenticated;
select test.as_user(test.id('owner'));
select test.throws(format('select app.reopen_business_day(%L, app.business_date(%L) - 1, %L)', test.id('branch_b'), test.id('branch_b'), 'ลองเปิด'), 'DAY_ALREADY_RECONCILED');
select test.ok((select status from app.day_closes where branch_id = test.id('branch_b') order by business_date desc limit 1) = 'closed', 'a refused reopen leaves the day closed');

-- B3. Reopening reverses what closing posted, leaves a trail, and puts the day back in play.
do $$
declare d date := app.business_date(test.id('branch_a')) - 1;
begin
  perform test.ok((select count(*) from app.journal_entries where branch_id = test.id('branch_a') and source_type = 'day_close' and status = 'posted' and reversal_of is null) > 0, 'closing posted entries');
  perform app.reopen_business_day(test.id('branch_a'), d, 'นับของผิด ต้องแก้');
  perform test.ok((select status from app.day_closes where branch_id = test.id('branch_a') and business_date = d) = 'reopened', 'status is reopened');
  perform test.ok((select reopened_at is not null and note like '%นับของผิด ต้องแก้%' from app.day_closes where branch_id = test.id('branch_a') and business_date = d), 'who/when/why is kept');
  perform test.ok(not exists (select 1 from app.journal_entries where branch_id = test.id('branch_a') and source_type = 'day_close' and status = 'posted' and reversal_of is null), 'every entry the close posted is now reversed');
  perform test.ok((select count(*) from app.journal_entries where branch_id = test.id('branch_a') and reversal_of is not null) > 0, 'by reversal entries, not by deleting history');
  perform test.ok((select count(*) from app.domain_events where tenant_id = test.id('tenant') and event_type = 'finance.day_reopened') = 1, 'the reopening is announced');
  perform test.ok(app.business_date(test.id('branch_a')) = d, 'the business date is that day again');
end $$;
select test.throws(format('select app.reopen_business_day(%L, app.business_date(%L), %L)', test.id('branch_a'), test.id('branch_a'), 'อีกรอบ'), 'DAY_NOT_CLOSED');   -- already reopened
reset role;
select test.ok((select count(*) from (
                  select jl.account_id from app.journal_lines jl join app.journal_entries je on je.id = jl.entry_id
                   where je.branch_id = test.id('branch_a') and je.source_type = 'day_close'
                   group by jl.account_id having sum(jl.debit - jl.credit) <> 0) x) = 0, 'in every account, closing and then reopening nets to nothing');
select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant')), 'the ledger still balances after reopening');

-- B4. The day can be worked on and closed again, and the new close counts what was added.
set role authenticated;
select test.as_user(test.id('owner'));
do $$
declare d date := app.business_date(test.id('branch_a'));
begin
  perform app.record_waste(test.id('loc_a'), test.id('coffee'), 25, 'spoiled', 'ลืมปิดฝา');   -- 25 g × 0.80 = 20.00
  perform app.close_business_day(test.id('branch_a'), d, 'ปิดอีกครั้ง');
  perform test.ok((select status from app.day_closes where branch_id = test.id('branch_a') and business_date = d) = 'closed', 'closed again');
  perform test.ok(app.business_date(test.id('branch_a')) = d + 1, 'and the business date rolls forward again');
end $$;
reset role;
select test.ok((select coalesce(sum(jl.debit - jl.credit), 0) from app.journal_lines jl join app.accounts a on a.id = jl.account_id join app.journal_entries je on je.id = jl.entry_id
                 where je.branch_id = test.id('branch_a') and a.system_key = 'waste_expense') = 20.00, 'the second close books the waste added after reopening (the first close and its reversal cancel)');
select test.ok((select sum(debit) = sum(credit) from app.journal_lines where tenant_id = test.id('tenant')), 'the ledger balances after closing a second time');
