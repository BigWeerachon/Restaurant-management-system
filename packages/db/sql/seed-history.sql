-- =============================================================================
-- Dev seed, part 2 (docs/v1.1-checklist.md item 1.2b): thirty days of sales history for the sample shop,
-- so that reports, the menu matrix, channel margins, the stock screen and the home screen have something to show
-- in API mode — the same idea as the web demo's `generateHistory` (apps/web/src/lib/demo/history.ts): two branches,
-- the same order volume, the same day-of-week, hour and channel mix, the same best-sellers.
--
--   pnpm db:seed:history          (after pnpm db:reset && pnpm db:seed)
--   pnpm stack:dev                (does all three; SEED_HISTORY=0 skips this one)
--
-- Why it is a separate script, and why it writes rows directly:
--   * The commands stamp everything with now(): a bill paid through `pay_order` today is a bill of today, and the
--     business date cannot be lent (see the note at the top of phase 1 in the checklist). So history is inserted as
--     rows — orders, lines, payments, shifts, stock movements, expenses — shaped exactly as the commands shape them
--     (totals by the arithmetic of `recalc_order`, receipt and order numbers from the same counters, cost from the
--     recipes through `explode_recipe` / `menu_item_cost`, fees from the payment method) and every trigger still runs.
--   * It is opt-in because the browser tests in CI assume a shop that has sold nothing; `pnpm db:seed` is unchanged.
--   * It switches on what the history sells through and is paid with — GrabFood and LINE MAN (+15 % menu price, 30 %
--     GP), PromptPay and card — as the web demo's shop has them. A history on channels that are switched off would be
--     a shop that contradicts its own settings.
--   * The days are NOT closed (`close_business_day`): closing would post a ledger for days nobody kept books for and
--     create a reconciliation task for every PromptPay payment (about two thousand). Reports read the orders, so
--     they are complete; the books begin when the shop closes its first day. Expenses are recorded without journal
--     entries for the same reason.
--   * Stock: an opening count on the day before the window (sized to what the window uses plus a reserve that leaves
--     some ingredients below their reorder point, so the purchasing screen has suggestions), then the sales, a little
--     waste every day and a weekly count adjustment. No balance goes negative (checked at the end).
--
-- Deterministic: a hash of (date, branch, channel, number) decides every choice, so the same day looks the same on
-- every run. Refuses to run on a shop that already has any order.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

create schema seed_history;
create function seed_history.rnd(p_key text) returns numeric
  language sql immutable parallel safe as $$ select (hashtextextended(p_key, 0) & 2147483647)::numeric / 2147483648 $$;

-- ---------------------------------------------------------------------------
-- 0. Whose shop, and is it empty
-- ---------------------------------------------------------------------------
create temp table h_tenant on commit drop as
select t.id as tenant_id, t.vat_registered, t.prices_include_vat, t.vat_rate
  from app.tenants t
  join app.memberships m on m.tenant_id = t.id
  join auth.users u on u.id = m.user_id
 where u.email = 'owner@sabai.dev'
 order by t.created_at
 limit 1;

do $$
begin
  if not exists (select 1 from h_tenant) then
    raise exception 'no sample shop for owner@sabai.dev — run `pnpm db:seed` first';
  end if;
  if exists (select 1 from app.orders o join h_tenant t on t.tenant_id = o.tenant_id) then
    raise exception 'the shop already has orders — history is added only to a shop that has sold nothing';
  end if;
end $$;

create temp table h_member on commit drop as
select r.key as role_key, m.id as membership_id
  from app.memberships m join app.roles r on r.id = m.role_id join h_tenant t on t.tenant_id = m.tenant_id;

-- ---------------------------------------------------------------------------
-- 1. What the shop sells through and is paid with (as in the web demo)
-- ---------------------------------------------------------------------------
update app.sales_channels c set is_active = true, price_markup = 0.15
  from h_tenant t where c.tenant_id = t.tenant_id and c.key in ('grabfood', 'lineman');
update app.payment_methods p set is_active = true, config = coalesce(p.config, '{}'::jsonb) || jsonb_build_object('promptpay_id', '0812345678')
  from h_tenant t where p.tenant_id = t.tenant_id and p.kind = 'promptpay';
update app.payment_methods p set is_active = true
  from h_tenant t where p.tenant_id = t.tenant_id and p.kind = 'card';

-- ---------------------------------------------------------------------------
-- 2. Lookup tables for the generator
-- ---------------------------------------------------------------------------
create temp table h_branch on commit drop as
select b.id as branch_id, b.code, b.timezone, b.service_charge_rate, app.business_date(b.id) as today,
       (select l.id from app.stock_locations l where l.branch_id = b.id and l.is_default) as location_id,
       case b.code when 'HQ' then 95 when 'TL' then 122 else 80 end as base_orders
  from app.branches b join h_tenant t on t.tenant_id = b.tenant_id
 where b.archived_at is null;

-- Share of a branch's orders per channel (web demo: CHANNEL_MIX).
create temp table h_mix (branch_code text, channel_key text, share numeric) on commit drop;
insert into h_mix values
  ('HQ', 'dine_in', 0.42), ('HQ', 'takeaway', 0.26), ('HQ', 'grabfood', 0.19), ('HQ', 'lineman', 0.13),
  ('TL', 'dine_in', 0.52), ('TL', 'takeaway', 0.20), ('TL', 'grabfood', 0.17), ('TL', 'lineman', 0.11);

-- Morning coffee, lunch peak, afternoon slump, early evening (web demo: HOUR_WEIGHTS).
create temp table h_hours on commit drop as
select (ord - 1)::int as h, w, sum(w) over (order by ord) - w as lo, sum(w) over (order by ord) as hi
  from unnest(array[0,0,0,0,0,0,0,3,8,9,7,9,12,10,6,5,6,6,5,4,3,2,1,0]) with ordinality as x(w, ord)
 where w > 0;

-- How often each menu item is ordered (web demo: the `weight` of each menu item), within drinks ("bar") and food.
create temp table h_menu on commit drop as
select mi.id as item_id, mi.name, mi.kitchen_route as route, w.weight,
       sum(w.weight) over (partition by mi.kitchen_route order by mi.name) - w.weight as lo,
       sum(w.weight) over (partition by mi.kitchen_route order by mi.name) as hi,
       sum(w.weight) over (partition by mi.kitchen_route) as total
  from app.menu_items mi
  join h_tenant t on t.tenant_id = mi.tenant_id
  join (values
    ('เอสเพรสโซ่', 3), ('อเมริกาโน่เย็น', 12), ('ลาเต้เย็น', 16), ('คาปูชิโน่ร้อน', 6), ('มอคค่าเย็น', 7),
    ('ชาไทยเย็น', 14), ('มัทฉะลาเต้', 9), ('โกโก้เย็น', 7),
    ('ข้าวกะเพราไก่', 13), ('ข้าวกะเพราหมูสับ', 10), ('ข้าวผัดกุ้ง', 7), ('ผัดซีอิ๊วหมู', 6), ('ข้าวไข่เจียว', 6),
    ('ข้าวผัดไก่', 5), ('เค้กช็อกโกแลต', 5), ('ครัวซองต์เนยสด', 6), ('ฮันนี่โทสต์', 3)
  ) as w(name, weight) on w.name = mi.name
 where mi.archived_at is null;

do $$
begin
  if not exists (select 1 from h_menu where route = 'bar') or not exists (select 1 from h_menu where route = 'kitchen') then
    raise exception 'the sample menu is not there (drinks and food) — run `pnpm db:reset && pnpm db:seed` first';
  end if;
end $$;

-- Price of each item on each channel at each branch, as the till would resolve it (delivery carries the markup).
create temp table h_price on commit drop as
select m.item_id, c.id as channel_id, b.branch_id, app.resolve_menu_price(m.item_id, c.id, b.branch_id) as price
  from h_menu m cross join h_branch b join app.sales_channels c on c.tenant_id = (select tenant_id from h_tenant);

-- Theoretical cost of one portion, as the till records it on the line (stock is still empty, so standard cost).
create temp table h_item_cost on commit drop as
select m.item_id, b.branch_id, app.menu_item_cost(m.item_id, '{}', b.location_id) as cost
  from h_menu m cross join h_branch b;

-- Modifier options the history uses: a sweetness on every drink, sometimes an extra shot.
create temp table h_option on commit drop as
select mo.id as option_id, mo.name, mo.price_delta
  from app.modifier_options mo join h_tenant t on t.tenant_id = mo.tenant_id
 where mo.name in ('หวานปกติ', 'หวานน้อย', 'ไม่หวาน', 'เพิ่มช็อต');

create temp table h_table on commit drop as
select dt.branch_id, dt.id as table_id, row_number() over (partition by dt.branch_id order by dt.sort, dt.id) as rn,
       count(*) over (partition by dt.branch_id) as n
  from app.dining_tables dt join h_tenant t on t.tenant_id = dt.tenant_id;

create temp table h_pm on commit drop as
select p.kind, p.id as method_id, p.fee_rate, p.fee_fixed
  from app.payment_methods p join h_tenant t on t.tenant_id = p.tenant_id;

-- ---------------------------------------------------------------------------
-- 3. The orders: how many per branch, day and channel, and when each one happened
-- ---------------------------------------------------------------------------
create temp table h_order_base on commit drop as
with day as (
  select b.branch_id, b.code, b.timezone, b.base_orders, b.service_charge_rate, b.today - d as bdate, d
    from h_branch b cross join generate_series(1, 30) d
), daily as (
  select day.*,
         (array[1.22, 0.86, 0.9, 0.95, 1.0, 1.16, 1.32])[extract(dow from day.bdate)::int + 1] as dow_factor,
         seed_history.rnd(day.bdate::text || ':' || day.code || ':day') as noise
    from day
), plan as (
  select d.*, c.id as channel_id, c.key as channel_key, c.kind as channel_kind, c.applies_service_charge,
         c.commission_vat_applies,
         greatest(1, round(d.base_orders * d.dow_factor * (1 + (30 - d.d) * 0.0028) * (0.9 + d.noise * 0.2) * mx.share))::int as n
    from daily d
    join h_mix mx on mx.branch_code = d.code
    join app.sales_channels c on c.tenant_id = (select tenant_id from h_tenant) and c.key = mx.channel_key
)
select app.uuid_v7() as order_id, p.*, g.idx,
       p.bdate::text || ':' || p.code || ':' || p.channel_key || ':' || g.idx as k
  from plan p cross join lateral generate_series(1, p.n) as g(idx);

create temp table h_order on commit drop as
select o.*, hh.h as hour,
       (o.bdate::timestamp + make_interval(hours => hh.h,
                                           mins => floor(seed_history.rnd(o.k || ':min') * 60)::int,
                                           secs => floor(seed_history.rnd(o.k || ':sec') * 60)::int)) at time zone o.timezone as opened_at,
       1 + (seed_history.rnd(o.k || ':l2') < 0.55)::int + (seed_history.rnd(o.k || ':l3') < 0.15)::int as n_lines,
       case when o.channel_kind = 'delivery_platform' then 'platform'
            when seed_history.rnd(o.k || ':pay') < 0.40 then 'cash'
            when seed_history.rnd(o.k || ':pay') < 0.82 then 'promptpay'
            else 'card' end as pay_kind
  from h_order_base o
  join h_hours hh on hh.lo <= seed_history.rnd(o.k || ':hour') * (select max(hi) from h_hours)
                 and hh.hi > seed_history.rnd(o.k || ':hour') * (select max(hi) from h_hours);

-- ---------------------------------------------------------------------------
-- 4. The lines: what was ordered (drinks first in the morning, more food at delivery)
-- ---------------------------------------------------------------------------
create temp table h_line on commit drop as
select app.uuid_v7() as line_id, o.order_id, o.branch_id, o.channel_id, o.k || ':' || l.n as lk, l.n as line_no,
       m.item_id, m.name, m.route,
       case when seed_history.rnd(o.k || ':' || l.n || ':q') < 0.1 then 2 else 1 end as qty,
       (m.route = 'bar' and seed_history.rnd(o.k || ':' || l.n || ':shot') < 0.12) as shot,
       pr.price as unit_price, ic.cost as item_cost
  from h_order o
  cross join lateral generate_series(1, o.n_lines) as l(n)
  cross join lateral (
    select case when o.channel_kind = 'delivery_platform' then
                  case when seed_history.rnd(o.k || ':' || l.n || ':g') < 0.55 then 'kitchen' else 'bar' end
                when l.n = 1 and o.hour < 11 then 'bar'
                when seed_history.rnd(o.k || ':' || l.n || ':g') < 0.62 then 'bar'
                else 'kitchen' end as grp,
           seed_history.rnd(o.k || ':' || l.n || ':i') as x
  ) g
  join h_menu m on m.route = g.grp and g.x * m.total >= m.lo and g.x * m.total < m.hi
  join h_price pr on pr.item_id = m.item_id and pr.channel_id = o.channel_id and pr.branch_id = o.branch_id
  join h_item_cost ic on ic.item_id = m.item_id and ic.branch_id = o.branch_id;

alter table h_line add column modifiers_total numeric(12,2), add column line_total numeric(14,2), add column cost_amount numeric(14,4);
update h_line set modifiers_total = case when shot then 15 else 0 end;
update h_line set line_total = round(qty * (unit_price + modifiers_total), 2), cost_amount = round(qty * item_cost, 4);

-- Sweetness on every drink (most people keep the default), and the extra shot where there was one.
create temp table h_line_mod on commit drop as
select l.line_id, o.option_id, o.name, o.price_delta
  from h_line l
  join h_option o on o.name = case when seed_history.rnd(l.lk || ':sweet') < 0.70 then 'หวานปกติ'
                                   when seed_history.rnd(l.lk || ':sweet') < 0.92 then 'หวานน้อย' else 'ไม่หวาน' end
 where l.route = 'bar'
union all
select l.line_id, o.option_id, o.name, o.price_delta
  from h_line l join h_option o on o.name = 'เพิ่มช็อต'
 where l.shot;

-- ---------------------------------------------------------------------------
-- 5. What each order used from the shelf (recipes, exploded the way the till does it)
-- ---------------------------------------------------------------------------
create temp table h_sale_mov on commit drop as
select x.order_id, x.ingredient_id, round(sum(x.qty), 4) as qty
  from (
    select l.order_id, e.ingredient_id, e.qty
      from h_line l
      join app.recipes r on r.menu_item_id = l.item_id and r.is_current and r.kind = 'menu_item'
      cross join lateral app.explode_recipe(r.id, l.qty) e
    union all
    select l.order_id, e.ingredient_id, e.qty
      from h_line l
      join h_line_mod m on m.line_id = l.line_id
      join app.recipes r on r.modifier_option_id = m.option_id and r.is_current and r.kind = 'modifier_option'
      cross join lateral app.explode_recipe(r.id, l.qty) e
  ) x
 group by x.order_id, x.ingredient_id
having sum(x.qty) <> 0;

-- ---------------------------------------------------------------------------
-- 6. Order totals — the arithmetic of app.recalc_order / app.pay_order, no discounts
-- ---------------------------------------------------------------------------
create temp table h_order_final on commit drop as
with items as (
  select order_id, sum(line_total) as items_total from h_line group by order_id
), cost as (
  select sm.order_id, round(sum(round(sm.qty * i.standard_cost, 4)), 4) as cost_total
    from h_sale_mov sm join app.ingredients i on i.id = sm.ingredient_id group by sm.order_id
), priced as (
  select o.*, it.items_total, t.prices_include_vat,
         case when t.vat_registered then t.vat_rate else 0 end as vat_rate,
         case when o.applies_service_charge then o.service_charge_rate else 0 end as sc_rate,
         app.channel_commission_rate(o.channel_id, o.bdate) as commission_rate,
         coalesce(c.cost_total, 0) as cost_total,
         o.opened_at + make_interval(mins => 4 + floor(seed_history.rnd(o.k || ':dur') * 34)::int) as paid_at
    from h_order o
    join items it on it.order_id = o.order_id
    left join cost c on c.order_id = o.order_id
    cross join h_tenant t
), totals as (
  select p.*, round(p.items_total * p.sc_rate, 2) as service_charge from priced p
), taxed as (
  select t.*,
         case when t.vat_rate = 0 then 0
              when t.prices_include_vat then round((t.items_total + t.service_charge) * t.vat_rate / (1 + t.vat_rate), 2)
              else round((t.items_total + t.service_charge) * t.vat_rate, 2) end as vat_amount
    from totals t
)
select t.*,
       case when t.vat_rate > 0 and not t.prices_include_vat then t.items_total + t.service_charge + t.vat_amount
            else t.items_total + t.service_charge end as total,
       round(t.items_total * t.commission_rate, 2) as commission_amount,
       case when t.commission_vat_applies then round(round(t.items_total * t.commission_rate, 2) * 0.07, 2) else 0 end as commission_vat_amount,
       row_number() over (partition by t.branch_id, t.bdate order by t.opened_at, t.k) as day_no,
       row_number() over (partition by t.branch_id, to_char(t.bdate, 'YYYYMM') order by t.paid_at, t.k) as month_no,
       row_number() over (partition by t.channel_id order by t.opened_at, t.k) as channel_no
  from taxed t;

-- ---------------------------------------------------------------------------
-- 7. Cash drawers: one shift per branch per day, counted and closed at night
-- ---------------------------------------------------------------------------
create temp table h_shift on commit drop as
with cash as (
  select o.branch_id, o.bdate, sum(o.total) as cash_sales
    from h_order_final o where o.pay_kind = 'cash' group by o.branch_id, o.bdate
), days as (
  select b.branch_id, b.code, b.timezone, b.today - d as bdate from h_branch b cross join generate_series(1, 30) d
)
select app.uuid_v7() as shift_id, d.branch_id, d.bdate, d.timezone, 2000::numeric as opening_float,
       2000 + coalesce(c.cash_sales, 0) as expected_cash,
       2000 + coalesce(c.cash_sales, 0)
         + case when seed_history.rnd(d.bdate::text || d.code || ':var') < 0.82 then 0
                when seed_history.rnd(d.bdate::text || d.code || ':var') < 0.93
                  then -(5 * (1 + floor(seed_history.rnd(d.bdate::text || d.code || ':amt') * 10)))
                else 5 * (1 + floor(seed_history.rnd(d.bdate::text || d.code || ':amt') * 6)) end as counted_cash
  from days d left join cash c on c.branch_id = d.branch_id and c.bdate = d.bdate;

insert into app.shifts (id, tenant_id, branch_id, business_date, status, opening_float, expected_cash, counted_cash, cash_variance,
                        opened_by, opened_at, closed_by, closed_at)
select s.shift_id, (select tenant_id from h_tenant), s.branch_id, s.bdate, 'closed', s.opening_float, s.expected_cash, s.counted_cash,
       s.counted_cash - s.expected_cash,
       (select membership_id from h_member where role_key = 'cashier'),
       (s.bdate::timestamp + interval '6 hours 30 minutes') at time zone s.timezone,
       (select membership_id from h_member where role_key = 'manager'),
       (s.bdate::timestamp + interval '22 hours 30 minutes') at time zone s.timezone
  from h_shift s;

-- ---------------------------------------------------------------------------
-- 8. The bills, their lines, and the money
-- ---------------------------------------------------------------------------
insert into app.orders (id, tenant_id, branch_id, channel_id, table_id, shift_id, order_no, receipt_no, status, business_date,
                        guest_count, external_ref, prices_include_vat, vat_rate, service_charge_rate, commission_rate, commission_vat,
                        items_total, discount_total, service_charge, vat_amount, rounding, total, commission_amount, commission_vat_amount,
                        cost_total, opened_by, opened_at, paid_by, paid_at, created_at, updated_at)
select o.order_id, (select tenant_id from h_tenant), o.branch_id, o.channel_id,
       case when o.channel_kind = 'dine_in' then (select ht.table_id from h_table ht
                                                   where ht.branch_id = o.branch_id
                                                     and ht.rn = 1 + floor(seed_history.rnd(o.k || ':table') * ht.n)::int) end,
       sh.shift_id,
       lpad(o.day_no::text, 3, '0'),
       br.code || '-' || to_char(o.bdate, 'YYMM') || '-' || lpad(o.month_no::text, 5, '0'),
       'paid', o.bdate,
       case when o.channel_kind = 'dine_in' then 1 + floor(seed_history.rnd(o.k || ':guests') * 4)::int end,
       case o.channel_key when 'grabfood' then 'GF-' || lpad(o.channel_no::text, 6, '0')
                          when 'lineman' then 'LM-' || lpad(o.channel_no::text, 6, '0') end,
       o.prices_include_vat, o.vat_rate, o.sc_rate, o.commission_rate, o.commission_vat_applies,
       o.items_total, 0, o.service_charge, o.vat_amount, 0, o.total, o.commission_amount, o.commission_vat_amount,
       o.cost_total,
       (select membership_id from h_member where role_key = case when o.channel_kind = 'dine_in' and o.code = 'HQ' then 'waiter' else 'cashier' end),
       o.opened_at,
       (select membership_id from h_member where role_key = 'cashier'),
       o.paid_at, o.opened_at, o.paid_at
  from h_order_final o
  join h_branch br on br.branch_id = o.branch_id
  join h_shift sh on sh.branch_id = o.branch_id and sh.bdate = o.bdate;

insert into app.order_items (id, tenant_id, order_id, menu_item_id, name, qty, unit_price, modifiers_total, line_total, cost_amount,
                             kitchen_route, status, sent_at, created_by, created_at)
select l.line_id, (select tenant_id from h_tenant), l.order_id, l.item_id, l.name, l.qty, l.unit_price, l.modifiers_total, l.line_total,
       l.cost_amount, l.route, 'served', o.opened_at + interval '1 minute',
       (select membership_id from h_member where role_key = 'cashier'), o.opened_at
  from h_line l join h_order_final o on o.order_id = l.order_id;

insert into app.order_item_modifiers (tenant_id, order_item_id, modifier_option_id, name, price_delta)
select (select tenant_id from h_tenant), m.line_id, m.option_id, m.name, m.price_delta from h_line_mod m;

insert into app.payments (tenant_id, branch_id, order_id, shift_id, method_id, kind, amount, tendered, change_given, fee_amount,
                          reference, business_date, created_by, created_at)
select (select tenant_id from h_tenant), o.branch_id, o.order_id, sh.shift_id, pm.method_id, 'payment', o.total,
       case when o.pay_kind = 'cash' then ceil(o.total / 20) * 20 end,
       case when o.pay_kind = 'cash' then ceil(o.total / 20) * 20 - o.total else 0 end,
       round(o.total * pm.fee_rate + pm.fee_fixed, 2),
       case when o.pay_kind = 'card' then lpad((floor(seed_history.rnd(o.k || ':ref') * 1000000))::int::text, 6, '0') end,
       o.bdate, (select membership_id from h_member where role_key = 'cashier'), o.paid_at
  from h_order_final o
  join h_shift sh on sh.branch_id = o.branch_id and sh.bdate = o.bdate
  join h_pm pm on pm.kind = o.pay_kind;

-- Numbers already handed out, so the next real bill continues the sequence.
insert into app.doc_sequences (tenant_id, branch_id, doc_type, period, last_value)
select (select tenant_id from h_tenant), branch_id, 'order', bdate::text, max(day_no) from h_order_final group by branch_id, bdate
union all
select (select tenant_id from h_tenant), branch_id, 'receipt', to_char(bdate, 'YYYYMM'), max(month_no)
  from h_order_final group by branch_id, to_char(bdate, 'YYYYMM')
on conflict (branch_id, doc_type, period) do update set last_value = greatest(app.doc_sequences.last_value, excluded.last_value);

-- ---------------------------------------------------------------------------
-- 9. The shelf: waste every day, a count adjustment every Sunday, and an opening count before it all
-- ---------------------------------------------------------------------------
create temp table h_used on commit drop as
select o.branch_id, o.code, o.bdate, sm.ingredient_id, i.name as ingredient, sum(sm.qty) as used
  from h_sale_mov sm
  join h_order_final o on o.order_id = sm.order_id
  join app.ingredients i on i.id = sm.ingredient_id
 group by o.branch_id, o.code, o.bdate, sm.ingredient_id, i.name;

-- Three things go in the bin each day at each branch: 4–14 % of something that was used that day.
create temp table h_waste on commit drop as
select r.branch_id, r.bdate, r.ingredient_id,
       greatest(round(r.used * (0.04 + seed_history.rnd(r.bdate::text || r.code || r.ingredient || ':wq') * 0.10), 4), 0.0001) as qty,
       (array['expired', 'spoiled', 'dropped', 'overcooked'])[1 + floor(seed_history.rnd(r.bdate::text || r.ingredient || ':wr') * 4)::int] as reason_code
  from (
    select u.*, row_number() over (partition by u.branch_id, u.bdate
                                   order by seed_history.rnd(u.bdate::text || u.code || u.ingredient || ':w')) as rk
      from h_used u
  ) r
 where r.rk <= 3;

-- On Sundays the shelf is counted and a few items come up a little short.
create temp table h_count on commit drop as
select r.branch_id, r.bdate, r.ingredient_id,
       greatest(round(r.week_used * (0.01 + seed_history.rnd(r.bdate::text || r.code || r.ingredient || ':cq') * 0.03), 4), 0.0001) as qty
  from (
    select u.branch_id, u.code, u.bdate, u.ingredient_id, u.ingredient, w.week_used,
           row_number() over (partition by u.branch_id, u.bdate
                              order by seed_history.rnd(u.bdate::text || u.code || u.ingredient || ':c')) as rk
      from h_used u
      cross join lateral (select sum(u2.used) as week_used from h_used u2
                           where u2.branch_id = u.branch_id and u2.ingredient_id = u.ingredient_id
                             and u2.bdate between u.bdate - 6 and u.bdate) w
     where extract(dow from u.bdate) = 0
  ) r
 where r.rk <= 6;

-- Opening count the day before the window: what the window uses, plus a reserve of 35–120 % of the par level.
create temp table h_opening on commit drop as
select b.branch_id, b.location_id, b.timezone, b.today - 31 as bdate, i.id as ingredient_id, i.standard_cost,
       round(coalesce(u.total, 0) + coalesce(w.total, 0) + coalesce(c.total, 0)
             + coalesce(i.par_level, 0) * (0.35 + seed_history.rnd(b.code || i.name || ':open') * 0.85), 0) as qty
  from h_branch b
  cross join app.ingredients i
  left join lateral (select sum(used) as total from h_used where branch_id = b.branch_id and ingredient_id = i.id) u on true
  left join lateral (select sum(qty) as total from h_waste where branch_id = b.branch_id and ingredient_id = i.id) w on true
  left join lateral (select sum(qty) as total from h_count where branch_id = b.branch_id and ingredient_id = i.id) c on true
 where i.tenant_id = (select tenant_id from h_tenant) and i.track_stock and i.archived_at is null;

insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, unit_cost, reason, source_type, business_date,
                                 occurred_at, created_by, note)
select (select tenant_id from h_tenant), o.branch_id, o.location_id, o.ingredient_id, o.qty, o.standard_cost, 'opening', 'opening', o.bdate,
       (o.bdate::timestamp + interval '8 hours') at time zone o.timezone, (select membership_id from h_member where role_key = 'stock'),
       'ยอดยกมาก่อนเริ่มมีประวัติขาย'
  from h_opening o where o.qty > 0
 order by o.bdate, o.branch_id, o.ingredient_id;

insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, source_type, source_id, business_date,
                                 occurred_at, created_by)
select (select tenant_id from h_tenant), o.branch_id, b.location_id, sm.ingredient_id, -sm.qty, 'sale', 'order', o.order_id, o.bdate,
       o.paid_at, (select membership_id from h_member where role_key = 'cashier')
  from h_sale_mov sm
  join h_order_final o on o.order_id = sm.order_id
  join h_branch b on b.branch_id = o.branch_id
 order by o.paid_at, o.k;

insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, reason_code, source_type, business_date,
                                 occurred_at, created_by)
select (select tenant_id from h_tenant), w.branch_id, b.location_id, w.ingredient_id, -w.qty, 'waste', w.reason_code, 'waste', w.bdate,
       (w.bdate::timestamp + interval '21 hours 30 minutes') at time zone b.timezone, (select membership_id from h_member where role_key = 'kitchen')
  from h_waste w join h_branch b on b.branch_id = w.branch_id
 order by w.bdate, w.branch_id, w.ingredient_id;

insert into app.stock_movements (tenant_id, branch_id, location_id, ingredient_id, qty, reason, source_type, business_date,
                                 occurred_at, created_by, note)
select (select tenant_id from h_tenant), c.branch_id, b.location_id, c.ingredient_id, -c.qty, 'count_adjust', 'count', c.bdate,
       (c.bdate::timestamp + interval '22 hours') at time zone b.timezone, (select membership_id from h_member where role_key = 'stock'),
       'นับสต็อกประจำสัปดาห์'
  from h_count c join h_branch b on b.branch_id = c.branch_id
 order by c.bdate, c.branch_id, c.ingredient_id;

-- ---------------------------------------------------------------------------
-- 10. What the owner spent (web demo: historyExpenses) — rent, utilities, wages, advertising, supplies
-- ---------------------------------------------------------------------------
create temp table h_expense on commit drop as
with days as (
  select b.branch_id, b.code, b.today - d as bdate from h_branch b cross join generate_series(0, 61) d
), monthly as (
  select d.branch_id, d.bdate, x.category, x.description, x.amount,
         date_trunc('month', d.bdate)::date as period_start,
         (date_trunc('month', d.bdate) + interval '1 month' - interval '1 day')::date as period_end,
         'bank'::text as paid_from
    from days d
    join (values
      ('HQ', 1,  'rent',      'ค่าเช่าร้าน สาขาอารีย์',    45000), ('TL', 1,  'rent',      'ค่าเช่าร้าน สาขาทองหล่อ',  65000),
      ('HQ', 5,  'utilities', 'ค่าไฟ ค่าน้ำ ค่าแก๊ส',      12400), ('TL', 5,  'utilities', 'ค่าไฟ ค่าน้ำ ค่าแก๊ส',      17800),
      ('HQ', 28, 'salaries',  'เงินเดือนพนักงาน 5 คน',   72000), ('TL', 28, 'salaries',  'เงินเดือนพนักงาน 7 คน',   108000)
    ) as x(code, dom, category, description, amount) on x.code = d.code and x.dom = extract(day from d.bdate)::int
), weekly as (
  select d.branch_id, d.bdate, x.category, x.description, x.amount, d.bdate as period_start, d.bdate + 6 as period_end, x.paid_from
    from days d
    join (values
      ('HQ', 'marketing', 'โฆษณาบนแพลตฟอร์มเดลิเวอรี',        1800, 'bank'),         ('TL', 'marketing', 'โฆษณาบนแพลตฟอร์มเดลิเวอรี',        2400, 'bank'),
      ('HQ', 'supplies',  'ของใช้สิ้นเปลือง น้ำยาล้างจาน ทิชชู', 1350, 'cash_on_hand'), ('TL', 'supplies',  'ของใช้สิ้นเปลือง น้ำยาล้างจาน ทิชชู', 1750, 'cash_on_hand')
    ) as x(code, category, description, amount, paid_from) on x.code = d.code
   where extract(dow from d.bdate) = 1
)
select * from monthly union all select * from weekly;

insert into app.expenses (tenant_id, branch_id, expense_date, period_start, period_end, account_id, description, amount, paid_from, created_by, created_at)
select (select tenant_id from h_tenant), e.branch_id, e.bdate, e.period_start, e.period_end, a.id, e.description, e.amount, e.paid_from,
       (select membership_id from h_member where role_key = 'owner'), e.bdate::timestamp
  from h_expense e
  join app.accounts a on a.tenant_id = (select tenant_id from h_tenant) and a.system_key = e.category;

-- ---------------------------------------------------------------------------
-- 11. Checks — a history that does not add up must not be left behind
-- ---------------------------------------------------------------------------
do $$
declare
  v_orders int; v_paid numeric; v_total numeric; v_neg int; v_unbalanced int; v_dupes int;
begin
  select count(*), coalesce(sum(total), 0) into v_orders, v_total
    from app.orders o join h_tenant t on t.tenant_id = o.tenant_id;
  select coalesce(sum(p.amount), 0) into v_paid from app.payments p join h_tenant t on t.tenant_id = p.tenant_id;
  if v_orders = 0 or v_paid <> v_total then
    raise exception 'history check failed: % orders, payments % against bills %', v_orders, v_paid, v_total;
  end if;
  select count(*) into v_unbalanced from app.orders o join h_tenant t on t.tenant_id = o.tenant_id
   where o.total <> (select coalesce(sum(p.amount), 0) from app.payments p where p.order_id = o.id);
  if v_unbalanced > 0 then raise exception 'history check failed: % bills whose payments differ from the total', v_unbalanced; end if;
  select count(*) into v_neg from app.stock_balances sb join app.ingredients i on i.id = sb.ingredient_id
   where i.track_stock and sb.qty_on_hand < 0;
  if v_neg > 0 then raise exception 'history check failed: % tracked ingredients went below zero', v_neg; end if;
  select count(*) - count(distinct (branch_id, receipt_no)) into v_dupes from app.orders;
  if v_dupes > 0 then raise exception 'history check failed: duplicate receipt numbers'; end if;
end $$;

select 'history: ' || count(*) || ' bills over ' || count(distinct business_date) || ' days, ฿' || round(sum(total))::text || ' taken, '
       || (select count(*) from app.stock_movements) || ' stock movements, ' || (select count(*) from app.expenses) || ' expenses' as result
  from app.orders;

drop schema seed_history cascade;
commit;
analyze;
