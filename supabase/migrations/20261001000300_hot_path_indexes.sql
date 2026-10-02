-- =============================================================================
-- Sabai — indexes for the lookups the till, the kitchen and the stock screens make all day.
--
-- 68 of the 132 foreign keys have no index of their own. Most do not need one: they guard a delete that never happens, or
-- sit on a table that stays small. These seven serve real queries on tables that grow with every sale, and a lookup that has no
-- index reads the whole table once the shop has been trading for a while (measured on a copy of `payments`
-- with 300,000 rows, 100 per shift: 20 ms per lookup by shift without an index, 0.2 ms with one — against 0.5 ms today, with 30
-- days of history, where nobody would notice). Each row written pays a few microseconds per index (300,000 inserts into a copy
-- of `payments`: 3.8 s with no extra index, 4.8 s with two), so only these:
--
--   kitchen_tickets (branch_id, status, fired_at)  the kitchen screen's list, asked again on every event
--   kitchen_ticket_items (order_item_id)           voiding a line
--   payments (shift_id)                            expected cash of a shift, asked at every close
--   cash_movements (shift_id)                      the same
--   stock_balances (ingredient_id)                 cost of an ingredient across locations, asked on every costing
--   purchase_order_lines (ingredient_id)           "already on order" in the reorder suggestions
--   expected_receipts (branch_id, business_date)   reopening a day asks which of its money is already matched
--
-- NOT added, on purpose: `kitchen_tickets (order_id)` (cancelling an order's tickets only looks at the ones still active, which
-- the small partial index `kitchen_tickets_active` already holds), `stock_movements (location_id)` (the busiest table to write, and every read of it already goes by
-- ingredient and location through `stock_movements_item_time`), and the foreign keys that only guard deletes.
-- `create index` takes a lock that blocks writes while it builds: on a database that already holds a lot of data, run these
-- statements by hand with `create index concurrently` instead.
-- =============================================================================
create index if not exists kitchen_tickets_branch_status on app.kitchen_tickets (branch_id, status, fired_at);
create index if not exists kitchen_ticket_items_order_item on app.kitchen_ticket_items (order_item_id);
create index if not exists payments_shift on app.payments (shift_id);
create index if not exists cash_movements_shift on app.cash_movements (shift_id);
create index if not exists stock_balances_ingredient on app.stock_balances (ingredient_id);
create index if not exists purchase_order_lines_ingredient on app.purchase_order_lines (ingredient_id);
create index if not exists expected_receipts_branch_date on app.expected_receipts (branch_id, business_date);
