-- =============================================================================
-- Sabai — Reporting read models
--
-- All views are `security_invoker`, so the caller's RLS applies (a branch
-- manager only ever sees their branches). They answer the owner's four questions:
--   อะไรขายดี (v_item_sales) · ขายที่ไหน (branch) · ผ่านช่องทางไหน (channel)
--   · เหลือเงินจริงเท่าไร (v_branch_daily_pnl)
--
-- Scale path: when a tenant outgrows on-the-fly aggregation, the outbox worker
-- maintains rollup tables with the same shape (see docs/04-architecture.md).
-- =============================================================================

create view app.v_stock_status with (security_invoker = true) as
select i.tenant_id,
       l.branch_id,
       l.id as location_id,
       i.id as ingredient_id,
       i.name,
       i.category_id,
       i.base_unit,
       i.display_unit,
       i.storage_zone,
       coalesce(b.qty_on_hand, 0) as qty_on_hand,
       coalesce(nullif(b.avg_cost, 0), i.last_cost, i.standard_cost, 0) as unit_cost,
       round(greatest(coalesce(b.qty_on_hand, 0), 0) * coalesce(nullif(b.avg_cost, 0), i.last_cost, i.standard_cost, 0), 2) as stock_value,
       i.reorder_point,
       i.par_level,
       b.last_movement_at,
       case
         when coalesce(b.qty_on_hand, 0) < 0 then 'negative'
         when coalesce(b.qty_on_hand, 0) = 0 then 'out'
         when i.reorder_point is not null and b.qty_on_hand <= i.reorder_point then 'low'
         else 'ok'
       end as status
  from app.ingredients i
  join app.stock_locations l on l.tenant_id = i.tenant_id and l.is_active
  left join app.stock_balances b on b.location_id = l.id and b.ingredient_id = i.id
 where i.track_stock and i.archived_at is null;

create view app.v_daily_sales with (security_invoker = true) as
select o.tenant_id,
       o.branch_id,
       o.business_date,
       o.channel_id,
       count(*) as orders,
       coalesce(sum(o.guest_count), 0) as guests,
       sum(o.items_total) as gross_sales,
       sum(o.discount_total) as discounts,
       sum(o.service_charge) as service_charge,
       sum(o.vat_amount) as vat,
       sum(o.total) as total,
       sum(o.total - o.vat_amount - o.rounding) as net_sales,
       sum(o.commission_amount) as commission,
       sum(o.commission_vat_amount) as commission_vat,
       sum(coalesce(o.cost_total, 0)) as cost
  from app.orders o
 where o.status = 'paid'
 group by o.tenant_id, o.branch_id, o.business_date, o.channel_id;

create view app.v_item_sales with (security_invoker = true) as
select o.tenant_id,
       o.branch_id,
       o.business_date,
       o.channel_id,
       oi.menu_item_id,
       oi.name,
       sum(oi.qty) as qty,
       -- Order-level discount allocated pro-rata so item revenue sums to the bill.
       round(sum(oi.line_total * case when o.items_total > 0 then (o.items_total - o.discount_total) / o.items_total else 1 end), 2) as sales,
       sum(coalesce(oi.cost_amount, 0)) as cost
  from app.order_items oi
  join app.orders o on o.id = oi.order_id
 where o.status = 'paid' and oi.status <> 'voided'
 group by o.tenant_id, o.branch_id, o.business_date, o.channel_id, oi.menu_item_id, oi.name;

create view app.v_menu_costing with (security_invoker = true) as
select mi.tenant_id,
       mi.id as menu_item_id,
       mi.name,
       mi.category_id,
       mi.price,
       app.menu_item_cost(mi.id) as cost,
       exists (select 1 from app.recipes r where r.menu_item_id = mi.id and r.is_current) as has_recipe
  from app.menu_items mi
 where mi.archived_at is null;

create view app.v_reorder_suggestions with (security_invoker = true) as
select i.tenant_id,
       l.branch_id,
       l.id as location_id,
       i.id as ingredient_id,
       i.name,
       i.base_unit,
       coalesce(b.qty_on_hand, 0) as on_hand,
       i.reorder_point,
       i.par_level,
       coalesce(oo.on_order, 0) as on_order,
       greatest(coalesce(i.par_level, i.reorder_point * 2) - coalesce(b.qty_on_hand, 0) - coalesce(oo.on_order, 0), 0) as suggested_qty,
       si.supplier_id,
       si.pack_name,
       si.pack_qty,
       si.last_price,
       ceil(greatest(coalesce(i.par_level, i.reorder_point * 2) - coalesce(b.qty_on_hand, 0) - coalesce(oo.on_order, 0), 0)
            / coalesce(si.pack_qty, 1)) as suggested_packs
  from app.ingredients i
  join app.stock_locations l on l.tenant_id = i.tenant_id and l.is_default
  left join app.stock_balances b on b.location_id = l.id and b.ingredient_id = i.id
  left join lateral (
    select sum((pol.qty_packs - pol.received_packs) * pol.pack_qty) as on_order
      from app.purchase_order_lines pol
      join app.purchase_orders po on po.id = pol.po_id
     where pol.ingredient_id = i.id and po.location_id = l.id
       and po.status in ('submitted','approved','sent','partially_received')
  ) oo on true
  left join lateral (
    select s.* from app.supplier_items s where s.ingredient_id = i.id
     order by s.is_preferred desc, s.updated_at desc limit 1
  ) si on true
 where i.track_stock and i.archived_at is null and i.reorder_point is not null
   and coalesce(b.qty_on_hand, 0) + coalesce(oo.on_order, 0) <= i.reorder_point;

-- "เหลือเงินจริงเท่าไร" per branch per day (operating view; the GL is the book of record).
create view app.v_branch_daily_pnl with (security_invoker = true) as
with facts as (
  select o.tenant_id, o.branch_id, o.business_date,
         o.total - o.vat_amount - o.rounding as net_sales,
         0::numeric as cogs, 0::numeric as waste, 0::numeric as variance,
         o.commission_amount + case when o.vat_rate = 0 then o.commission_vat_amount else 0 end as commission,
         0::numeric as fees, 0::numeric as expenses, 1 as orders
    from app.orders o where o.status = 'paid'
  union all
  select sm.tenant_id, sm.branch_id, sm.business_date, 0,
         case when sm.reason in ('sale','sale_void') then -sm.total_cost else 0 end,
         case when sm.reason = 'waste' then -sm.total_cost else 0 end,
         case when sm.reason in ('count_adjust','manual_adjust','production_out','production_in') then -sm.total_cost else 0 end,
         0, 0, 0, 0
    from app.stock_movements sm where sm.reason not in ('purchase','opening','transfer_in','transfer_out')
  union all
  select p.tenant_id, p.branch_id, p.business_date, 0, 0, 0, 0, 0, p.fee_amount, 0, 0
    from app.payments p
  union all
  select e.tenant_id, e.branch_id, e.expense_date, 0, 0, 0, 0, 0, 0, e.amount, 0
    from app.expenses e where e.branch_id is not null
)
select tenant_id, branch_id, business_date,
       sum(orders) as orders,
       round(sum(net_sales), 2) as net_sales,
       round(sum(cogs), 2) as cogs,
       round(sum(waste), 2) as waste,
       round(sum(variance), 2) as stock_variance,
       round(sum(commission), 2) as commission,
       round(sum(fees), 2) as payment_fees,
       round(sum(expenses), 2) as expenses,
       round(sum(net_sales) - sum(cogs) - sum(waste) - sum(variance) - sum(commission) - sum(fees) - sum(expenses), 2) as profit
  from facts
 group by tenant_id, branch_id, business_date;

-- Facts behind the "เริ่มต้นใช้งาน" checklist. Wording, order and progress
-- maths live in packages/domain/src/onboarding.ts.
create view app.v_onboarding_facts with (security_invoker = true) as
select t.id as tenant_id,
       exists (select 1 from app.branches b where b.tenant_id = t.id and b.archived_at is null
                 and (b.address is not null or b.phone is not null)) as branch_ready,
       exists (select 1 from app.payment_methods pm where pm.tenant_id = t.id and pm.is_active
                 and pm.kind in ('promptpay','card','ewallet','bank_transfer'))
         or coalesce((t.settings -> 'onboarding' ->> 'payments_confirmed')::boolean, false) as payments_ready,
       (select count(*) from app.ingredients i where i.tenant_id = t.id and i.archived_at is null) as ingredients,
       (select count(*) from app.menu_items m where m.tenant_id = t.id and m.archived_at is null) as menu_items,
       (select count(*) from app.recipes r where r.tenant_id = t.id and r.is_current and r.kind = 'menu_item') as recipes,
       (select count(*) from app.memberships m where m.tenant_id = t.id and m.status in ('active','invited')) as staff,
       exists (select 1 from app.orders o where o.tenant_id = t.id and o.status = 'paid') as has_sale,
       coalesce(t.settings -> 'onboarding' -> 'skipped', '[]'::jsonb) as skipped
  from app.tenants t;

grant select on app.v_stock_status, app.v_daily_sales, app.v_item_sales, app.v_menu_costing,
                app.v_reorder_suggestions, app.v_branch_daily_pnl, app.v_onboarding_facts to authenticated;
