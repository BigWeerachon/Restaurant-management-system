-- =============================================================================
-- The lookups the till, the kitchen and the stock screens make all day each have an index to go by (migration
-- 20261001000300_hot_path_indexes.sql). The tables here are empty, so the planner would read them whole whatever exists; with
-- sequential scans switched off it must pick an index if one fits the question — so a missing or mis-shaped index shows up.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists test;
create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;

-- (A constant, not gen_random_uuid(): a volatile function is evaluated per row and can never be an index condition.)
-- The plan Postgres would use for a query, as text.
create or replace function test.plan(p_sql text) returns text language plpgsql as $$
declare line text; out text := '';
begin
  for line in execute 'explain ' || p_sql loop out := out || line || E'\n'; end loop;
  return out;
end $$;

-- Asserts that the question is answered through the named index.
create or replace function test.uses_index(p_sql text, p_index text, p_what text) returns void language plpgsql as $$
declare plan text;
begin
  set local enable_seqscan = off;
  plan := test.plan(p_sql);
  if position(p_index in plan) = 0 then
    raise exception 'ASSERTION FAILED: % should use index % but the plan is:%', p_what, p_index, E'\n' || plan;
  end if;
end $$;

select test.ok((select count(*) from pg_indexes where schemaname = 'app' and indexname in (
  'kitchen_tickets_branch_status', 'kitchen_ticket_items_order_item', 'payments_shift',
  'cash_movements_shift', 'stock_balances_ingredient', 'purchase_order_lines_ingredient', 'expected_receipts_branch_date')) = 7, 'all seven indexes exist');

-- The kitchen screen's list (apps/api/src/routes/kitchen.ts): a branch's tickets that are new or in progress.
select test.uses_index($$select kt.id from app.kitchen_tickets kt where kt.branch_id = '00000000-0000-0000-0000-000000000001'::uuid
  and (kt.status in ('new','in_progress') or (kt.status = 'ready' and kt.ready_at > now() - interval '10 minutes'))$$,
  'kitchen_tickets_branch_status', 'the kitchen screen''s list');
-- Voiding a line voids its ticket items (app.void_order_item).
select test.uses_index($$update app.kitchen_ticket_items set status = 'voided' where order_item_id = '00000000-0000-0000-0000-000000000001'::uuid$$,
  'kitchen_ticket_items_order_item', 'voiding a line');
-- Cash that should be in a drawer (app.shift_expected_cash).
select test.uses_index($$select sum(p.amount) from app.payments p where p.shift_id = '00000000-0000-0000-0000-000000000001'::uuid$$, 'payments_shift', 'payments of a shift');
select test.uses_index($$select sum(c.amount) from app.cash_movements c where c.shift_id = '00000000-0000-0000-0000-000000000001'::uuid$$, 'cash_movements_shift', 'cash movements of a shift');
-- Cost of an ingredient across the shop's locations (app.ingredient_unit_cost).
select test.uses_index($$select sum(b.qty_on_hand) from app.stock_balances b where b.ingredient_id = '00000000-0000-0000-0000-000000000001'::uuid$$, 'stock_balances_ingredient', 'balances of an ingredient');
-- "Already on order" in the reorder suggestions (app.v_reorder_suggestions).
select test.uses_index($$select sum(pol.qty_packs) from app.purchase_order_lines pol where pol.ingredient_id = '00000000-0000-0000-0000-000000000001'::uuid$$, 'purchase_order_lines_ingredient', 'order lines of an ingredient');
-- Reopening a day first asks whether any of its money has already been matched with the bank (app.reopen_business_day).
select test.uses_index($$select 1 from app.expected_receipts where branch_id = '00000000-0000-0000-0000-000000000001'::uuid and business_date = current_date and status <> 'open'$$,
  'expected_receipts_branch_date', 'a branch''s expected receipts on a day');
