-- =============================================================================
-- Dev seed: the same sample shop as the web demo ("สบายดี คาเฟ่ & ครัว"), created
-- through the real commands (as the `authenticated` role, with JWT claims) so
-- every RLS policy and permission check runs exactly as in production.
--
--   pnpm --filter @sabai/db seed
--
-- Re-running against a fresh database (via reset.sh) is the supported path;
-- this script is not idempotent against a database it has already seeded.
-- Historical 30-day order/sales data is not seeded yet (docs/v1.1-checklist.md
-- item 1.2b) — reports will look thin until then, but POS/KDS/menu/stock all
-- work today against this seed.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Session-scoped id lookup, same pattern as packages/db/tests/001_end_to_end.sql.
create schema if not exists seed;
grant usage on schema seed to authenticated;
create or replace function seed.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
create or replace function seed.put(p_key text, p_val uuid) returns void language sql as $$
  select set_config('seed.' || p_key, p_val::text, false);
$$;
create or replace function seed.id(p_key text) returns uuid language sql stable as $$
  select current_setting('seed.' || p_key)::uuid;
$$;
grant execute on all functions in schema seed to authenticated;

insert into auth.users (id, email) values ('00000000-0000-7000-9000-000000000001', 'owner@sabai.dev')
  on conflict (id) do nothing;

set role authenticated;
select seed.as_user('00000000-0000-7000-9000-000000000001');

-- ---------------------------------------------------------------------------
-- 1. Tenant + branches
-- ---------------------------------------------------------------------------
select seed.put('tenant', (r->>'tenant_id')::uuid), seed.put('branch_ari', (r->>'branch_id')::uuid)
  from app.create_tenant(jsonb_build_object(
    'name', 'สบายดี คาเฟ่ & ครัว', 'business_type', 'cafe', 'branch_name', 'สาขาอารีย์',
    'owner_name', 'คุณปิยะ', 'vat_registered', true, 'prices_include_vat', true)) as r;

select seed.put('branch_tl', app.add_branch(jsonb_build_object(
  'tenant_id', seed.id('tenant'), 'code', 'TL', 'name', 'สาขาทองหล่อ')));

select seed.put('brand', id) from app.brands where tenant_id = seed.id('tenant') and is_default limit 1;

-- ---------------------------------------------------------------------------
-- 1b. Dining areas + tables (dine-in orders need somewhere to seat guests)
-- ---------------------------------------------------------------------------
with a as (insert into app.dining_areas (tenant_id, branch_id, name, sort)
  values (seed.id('tenant'), seed.id('branch_ari'), 'ในร้าน', 1) returning id)
select seed.put('area_ari_main', id) from a;
with a as (insert into app.dining_areas (tenant_id, branch_id, name, sort)
  values (seed.id('tenant'), seed.id('branch_ari'), 'ระเบียง', 2) returning id)
select seed.put('area_ari_patio', id) from a;
insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats, sort)
  select seed.id('tenant'), seed.id('branch_ari'), seed.id('area_ari_main'), 'A' || n, 2, n from generate_series(1, 8) n;
insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats, sort)
  select seed.id('tenant'), seed.id('branch_ari'), seed.id('area_ari_patio'), 'B' || n, 4, 8 + n from generate_series(1, 4) n;

with a as (insert into app.dining_areas (tenant_id, branch_id, name, sort)
  values (seed.id('tenant'), seed.id('branch_tl'), 'ในร้าน', 1) returning id)
select seed.put('area_tl_main', id) from a;
with a as (insert into app.dining_areas (tenant_id, branch_id, name, sort)
  values (seed.id('tenant'), seed.id('branch_tl'), 'โซน VIP', 2) returning id)
select seed.put('area_tl_vip', id) from a;
insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats, sort)
  select seed.id('tenant'), seed.id('branch_tl'), seed.id('area_tl_main'), 'T' || n, 2, n from generate_series(1, 10) n;
insert into app.dining_tables (tenant_id, branch_id, area_id, name, seats, sort)
  select seed.id('tenant'), seed.id('branch_tl'), seed.id('area_tl_vip'), 'V' || n, 6, 10 + n from generate_series(1, 4) n;

-- ---------------------------------------------------------------------------
-- 2. Menu categories
-- ---------------------------------------------------------------------------
insert into app.menu_categories (tenant_id, brand_id, name, icon, sort) values
  (seed.id('tenant'), seed.id('brand'), 'กาแฟ', 'coffee', 1),
  (seed.id('tenant'), seed.id('brand'), 'ชา นม โกโก้', 'cup-soda', 2),
  (seed.id('tenant'), seed.id('brand'), 'อาหารจานเดียว', 'utensils', 3),
  (seed.id('tenant'), seed.id('brand'), 'ขนมและเบเกอรี่', 'croissant', 4);

-- ---------------------------------------------------------------------------
-- 3. Ingredients (all raw; base_unit g/ml/pcs — no prep step, to keep the
--    seed simple. standard_cost is baht per base unit.)
-- ---------------------------------------------------------------------------
insert into app.ingredients (tenant_id, name, base_unit, kind, track_stock, standard_cost, reorder_point, par_level) values
  (seed.id('tenant'), 'เมล็ดกาแฟคั่ว', 'g',   'raw', true, 0.80,  2000, 4000),
  (seed.id('tenant'), 'นมสด',         'ml',  'raw', true, 0.045, 5000, 10000),
  (seed.id('tenant'), 'นมข้นหวาน',    'ml',  'raw', true, 0.09,  1000, 2000),
  (seed.id('tenant'), 'น้ำเชื่อม',     'ml',  'raw', true, 0.02,  2000, 4000),
  (seed.id('tenant'), 'ใบชาไทย',      'g',   'raw', true, 0.35,  1000, 2000),
  (seed.id('tenant'), 'ผงมัทฉะ',      'g',   'raw', true, 1.20,  300,  600),
  (seed.id('tenant'), 'ผงโกโก้',      'g',   'raw', true, 0.45,  800,  1600),
  (seed.id('tenant'), 'น้ำแข็ง',       'g',   'raw', false, 0.01, 0,    0),
  (seed.id('tenant'), 'ข้าวหอมมะลิ',  'g',   'raw', true, 0.036, 10000, 20000),
  (seed.id('tenant'), 'อกไก่',        'g',   'raw', true, 0.12,  8000, 16000),
  (seed.id('tenant'), 'หมูสับ',       'g',   'raw', true, 0.16,  5000, 10000),
  (seed.id('tenant'), 'กุ้ง',          'g',   'raw', true, 0.45,  3000, 6000),
  (seed.id('tenant'), 'ไข่ไก่',        'pcs', 'raw', true, 5.00,  200,  400),
  (seed.id('tenant'), 'ใบกะเพรา',     'g',   'raw', true, 0.20,  1000, 2000),
  (seed.id('tenant'), 'กระเทียม',     'g',   'raw', true, 0.09,  1000, 2000),
  (seed.id('tenant'), 'พริกขี้หนู',    'g',   'raw', true, 0.15,  500,  1000),
  (seed.id('tenant'), 'น้ำปลา',        'ml',  'raw', true, 0.06,  2000, 4000),
  (seed.id('tenant'), 'ซีอิ๊วขาว',      'ml',  'raw', true, 0.04,  2000, 4000),
  (seed.id('tenant'), 'แป้งสาลี',      'g',   'raw', true, 0.05,  5000, 10000),
  (seed.id('tenant'), 'เนยสด',        'g',   'raw', true, 0.35,  2000, 4000),
  (seed.id('tenant'), 'น้ำตาลทราย',   'g',   'raw', true, 0.03,  5000, 10000),
  (seed.id('tenant'), 'ช็อกโกแลต',    'g',   'raw', true, 0.55,  2000, 4000),
  (seed.id('tenant'), 'ผงฟู',         'g',   'raw', true, 0.10,  300,  600);

-- Stock starts at zero, same as a real new shop — `stock_balances` is written
-- only by the `apply_stock_movement` trigger (RLS grants it no direct writes).
-- Receive goods from the app (or see item 1.2b) to get opening stock in.

-- ---------------------------------------------------------------------------
-- 4. Modifier groups (shared by every drink)
-- ---------------------------------------------------------------------------
insert into app.modifier_groups (tenant_id, brand_id, name, min_select, max_select, sort) values
  (seed.id('tenant'), seed.id('brand'), 'ความหวาน', 1, 1, 1),
  (seed.id('tenant'), seed.id('brand'), 'ตัวเลือกเสริม', 0, 3, 2);

select seed.put('mg_sweet', id) from app.modifier_groups where tenant_id = seed.id('tenant') and name = 'ความหวาน';
select seed.put('mg_extra', id) from app.modifier_groups where tenant_id = seed.id('tenant') and name = 'ตัวเลือกเสริม';

insert into app.modifier_options (tenant_id, group_id, name, price_delta, is_default, sort) values
  (seed.id('tenant'), seed.id('mg_sweet'), 'หวานปกติ', 0, true, 1),
  (seed.id('tenant'), seed.id('mg_sweet'), 'หวานน้อย', 0, false, 2),
  (seed.id('tenant'), seed.id('mg_sweet'), 'ไม่หวาน', 0, false, 3),
  (seed.id('tenant'), seed.id('mg_extra'), 'เพิ่มช็อต', 15, false, 1),
  (seed.id('tenant'), seed.id('mg_extra'), 'เปลี่ยนเป็นนมโอ๊ต', 15, false, 2);

-- ---------------------------------------------------------------------------
-- 5. Menu items + recipes
-- ---------------------------------------------------------------------------
create temporary table seed_menu_item (key text primary key, id uuid not null);

do $$
declare
  cat uuid;
  mi uuid;
  rid uuid;
  item record;
  items jsonb := '[
    {"key":"espresso","cat":"กาแฟ","name":"เอสเพรสโซ่","price":55,"route":"bar",
     "recipe":[["เมล็ดกาแฟคั่ว",18]]},
    {"key":"americano","cat":"กาแฟ","name":"อเมริกาโน่เย็น","price":60,"route":"bar",
     "recipe":[["เมล็ดกาแฟคั่ว",18],["น้ำแข็ง",200]]},
    {"key":"latte","cat":"กาแฟ","name":"ลาเต้เย็น","price":70,"route":"bar",
     "recipe":[["เมล็ดกาแฟคั่ว",18],["นมสด",150],["น้ำแข็ง",150]]},
    {"key":"cappuccino","cat":"กาแฟ","name":"คาปูชิโน่ร้อน","price":65,"route":"bar",
     "recipe":[["เมล็ดกาแฟคั่ว",18],["นมสด",100]]},
    {"key":"mocha","cat":"กาแฟ","name":"มอคค่าเย็น","price":80,"route":"bar",
     "recipe":[["เมล็ดกาแฟคั่ว",18],["นมสด",120],["ผงโกโก้",15],["น้ำแข็ง",150]]},
    {"key":"thaitea","cat":"ชา นม โกโก้","name":"ชาไทยเย็น","price":55,"route":"bar",
     "recipe":[["ใบชาไทย",12],["นมข้นหวาน",30],["น้ำเชื่อม",15],["น้ำแข็ง",180]]},
    {"key":"matcha","cat":"ชา นม โกโก้","name":"มัทฉะลาเต้","price":85,"route":"bar",
     "recipe":[["ผงมัทฉะ",6],["นมสด",150],["น้ำเชื่อม",15],["น้ำแข็ง",150]]},
    {"key":"cocoa","cat":"ชา นม โกโก้","name":"โกโก้เย็น","price":60,"route":"bar",
     "recipe":[["ผงโกโก้",20],["นมสด",150],["น้ำเชื่อม",10],["น้ำแข็ง",150]]},
    {"key":"krapao_gai","cat":"อาหารจานเดียว","name":"ข้าวกะเพราไก่","price":75,"route":"kitchen",
     "recipe":[["ข้าวหอมมะลิ",180],["อกไก่",120],["ใบกะเพรา",15],["กระเทียม",8],["พริกขี้หนู",5],["น้ำปลา",10],["ไข่ไก่",1]]},
    {"key":"krapao_moo","cat":"อาหารจานเดียว","name":"ข้าวกะเพราหมูสับ","price":75,"route":"kitchen",
     "recipe":[["ข้าวหอมมะลิ",180],["หมูสับ",120],["ใบกะเพรา",15],["กระเทียม",8],["พริกขี้หนู",5],["น้ำปลา",10]]},
    {"key":"padkrapao_kung","cat":"อาหารจานเดียว","name":"ข้าวผัดกุ้ง","price":95,"route":"kitchen",
     "recipe":[["ข้าวหอมมะลิ",180],["กุ้ง",100],["ไข่ไก่",1],["ซีอิ๊วขาว",10],["กระเทียม",8]]},
    {"key":"padsiew","cat":"อาหารจานเดียว","name":"ผัดซีอิ๊วหมู","price":75,"route":"kitchen",
     "recipe":[["หมูสับ",100],["ไข่ไก่",1],["ซีอิ๊วขาว",15],["กระเทียม",5]]},
    {"key":"friedegg_rice","cat":"อาหารจานเดียว","name":"ข้าวไข่เจียว","price":45,"route":"kitchen",
     "recipe":[["ข้าวหอมมะลิ",180],["ไข่ไก่",2],["น้ำปลา",5]]},
    {"key":"padkaiwan","cat":"อาหารจานเดียว","name":"ข้าวผัดไก่","price":70,"route":"kitchen",
     "recipe":[["ข้าวหอมมะลิ",180],["อกไก่",100],["ไข่ไก่",1],["ซีอิ๊วขาว",10],["กระเทียม",5]]},
    {"key":"chocolate_cake","cat":"ขนมและเบเกอรี่","name":"เค้กช็อกโกแลต","price":95,"route":"kitchen",
     "recipe":[["แป้งสาลี",60],["เนยสด",40],["น้ำตาลทราย",50],["ช็อกโกแลต",40],["ไข่ไก่",1],["ผงฟู",2]]},
    {"key":"croissant","cat":"ขนมและเบเกอรี่","name":"ครัวซองต์เนยสด","price":75,"route":"kitchen",
     "recipe":[["แป้งสาลี",70],["เนยสด",45],["น้ำตาลทราย",8],["ผงฟู",1]]},
    {"key":"honeytoast","cat":"ขนมและเบเกอรี่","name":"ฮันนี่โทสต์","price":129,"route":"kitchen",
     "recipe":[["แป้งสาลี",120],["เนยสด",30],["น้ำตาลทราย",25],["ไข่ไก่",1]]}
  ]'::jsonb;
  ln jsonb;
begin
  for item in select * from jsonb_to_recordset(items) as x(key text, cat text, name text, price numeric, route text, recipe jsonb)
  loop
    select id into cat from app.menu_categories where tenant_id = seed.id('tenant') and name = item.cat;
    insert into app.menu_items (tenant_id, brand_id, category_id, name, price, kitchen_route)
      values (seed.id('tenant'), seed.id('brand'), cat, item.name, item.price, item.route)
      returning id into mi;
    insert into seed_menu_item (key, id) values (item.key, mi);

    insert into app.recipes (tenant_id, kind, menu_item_id) values (seed.id('tenant'), 'menu_item', mi) returning id into rid;
    for ln in select * from jsonb_array_elements(item.recipe)
    loop
      insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty)
      select seed.id('tenant'), rid, i.id, (ln->>1)::numeric
        from app.ingredients i where i.tenant_id = seed.id('tenant') and i.name = ln->>0;
    end loop;

    -- Every drink (bar route) gets sweetness + extras.
    if item.route = 'bar' then
      insert into app.menu_item_modifier_groups (tenant_id, menu_item_id, group_id, sort)
      values (seed.id('tenant'), mi, seed.id('mg_sweet'), 1), (seed.id('tenant'), mi, seed.id('mg_extra'), 2);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Suppliers
-- ---------------------------------------------------------------------------
insert into app.suppliers (tenant_id, name, contact_name, phone, payment_terms_days, lead_time_days) values
  (seed.id('tenant'), 'ตลาดสดสี่มุมเมือง', 'พี่แดง', '0812345678', 0, 1),
  (seed.id('tenant'), 'ฟาร์มนมออร์แกนิค', 'คุณสมศรี', '0898765432', 30, 2),
  (seed.id('tenant'), 'โรงคั่วกาแฟดอยตุง', 'คุณอนันต์', '0855512345', 15, 3);

-- The usual pack each ingredient comes in, and from whom — what the receive-goods
-- screen offers first. Unit prices match `standard_cost` above, so costs do not jump.
insert into app.supplier_items (tenant_id, supplier_id, ingredient_id, pack_name, pack_qty, last_price, is_preferred)
select seed.id('tenant'), s.id, i.id, v.pack_name, v.pack_qty, v.price, true
  from (values
    ('โรงคั่วกาแฟดอยตุง',  'เมล็ดกาแฟคั่ว', 'ถุง 1 กก.',      1000, 800),
    ('โรงคั่วกาแฟดอยตุง',  'ใบชาไทย',      'ถุง 400 ก.',     400,  140),
    ('โรงคั่วกาแฟดอยตุง',  'ผงมัทฉะ',      'ถุง 100 ก.',     100,  120),
    ('ฟาร์มนมออร์แกนิค',   'นมสด',         'ขวด 2 ลิตร',    2000, 90),
    ('ฟาร์มนมออร์แกนิค',   'นมข้นหวาน',    'กระป๋อง 380 มล.', 380,  34.2),
    ('ฟาร์มนมออร์แกนิค',   'เนยสด',        'ก้อน 500 ก.',    500,  175),
    ('ตลาดสดสี่มุมเมือง',  'น้ำเชื่อม',     'ขวด 1 ลิตร',     1000, 20),
    ('ตลาดสดสี่มุมเมือง',  'ผงโกโก้',      'ถุง 500 ก.',     500,  225),
    ('ตลาดสดสี่มุมเมือง',  'ข้าวหอมมะลิ',  'ถุง 5 กก.',      5000, 180),
    ('ตลาดสดสี่มุมเมือง',  'อกไก่',        'แพ็ก 1 กก.',     1000, 120),
    ('ตลาดสดสี่มุมเมือง',  'หมูสับ',       'แพ็ก 1 กก.',     1000, 160),
    ('ตลาดสดสี่มุมเมือง',  'กุ้ง',          'แพ็ก 1 กก.',     1000, 450),
    ('ตลาดสดสี่มุมเมือง',  'ไข่ไก่',        'แผง 30 ฟอง',     30,   150),
    ('ตลาดสดสี่มุมเมือง',  'ใบกะเพรา',     'กำ 500 ก.',      500,  100),
    ('ตลาดสดสี่มุมเมือง',  'กระเทียม',     'ถุง 1 กก.',      1000, 90),
    ('ตลาดสดสี่มุมเมือง',  'พริกขี้หนู',    'ถุง 500 ก.',     500,  75),
    ('ตลาดสดสี่มุมเมือง',  'น้ำปลา',        'ขวด 700 มล.',    700,  42),
    ('ตลาดสดสี่มุมเมือง',  'ซีอิ๊วขาว',      'ขวด 700 มล.',    700,  28),
    ('ตลาดสดสี่มุมเมือง',  'แป้งสาลี',      'ถุง 1 กก.',      1000, 50),
    ('ตลาดสดสี่มุมเมือง',  'น้ำตาลทราย',   'ถุง 1 กก.',      1000, 30),
    ('ตลาดสดสี่มุมเมือง',  'ช็อกโกแลต',    'ถุง 500 ก.',     500,  275),
    ('ตลาดสดสี่มุมเมือง',  'ผงฟู',         'กระป๋อง 100 ก.', 100,  10)
  ) as v(supplier, ingredient, pack_name, pack_qty, price)
  join app.suppliers s on s.tenant_id = seed.id('tenant') and s.name = v.supplier
  join app.ingredients i on i.tenant_id = seed.id('tenant') and i.name = v.ingredient;

-- ---------------------------------------------------------------------------
-- 7. Staff — same PINs as the web demo, all working every branch except the
--    ones the demo scopes to one branch.
-- ---------------------------------------------------------------------------
create temporary table seed_member (key text primary key, id uuid not null);

do $$
declare
  role_id uuid;
  mem_id uuid;
  m record;
  members jsonb := '[
    {"key":"manager",    "name":"พี่นิด",    "role":"manager",    "pin":"2222", "all_branches":true},
    {"key":"cashier",    "name":"น้องแพรว",  "role":"cashier",    "pin":"3333", "all_branches":false, "max_discount":0.1},
    {"key":"waiter",     "name":"น้องโอ๊ต",  "role":"waiter",     "pin":"4444", "all_branches":false},
    {"key":"kitchen",    "name":"ป้าแดง",    "role":"kitchen",    "pin":"5555", "all_branches":false},
    {"key":"stock",      "name":"พี่ต้น",    "role":"stock",      "pin":"6666", "all_branches":true},
    {"key":"accountant", "name":"คุณมิ้นท์", "role":"accountant", "pin":"7777", "all_branches":true}
  ]'::jsonb;
begin
  for m in select * from jsonb_to_recordset(members) as x(key text, name text, role text, pin text, all_branches boolean, max_discount numeric)
  loop
    select id into role_id from app.roles where tenant_id = seed.id('tenant') and key = m.role;
    -- Same as the demo: only the cashier has a discount cap (10%); anything above needs a manager's PIN.
    insert into app.memberships (tenant_id, display_name, role_id, all_branches, status, limits)
      values (seed.id('tenant'), m.name, role_id, m.all_branches, 'active',
              case when m.max_discount is null then '{}'::jsonb else jsonb_build_object('max_discount_rate', m.max_discount) end)
      returning id into mem_id;
    insert into seed_member (key, id) values (m.key, mem_id);
    perform app.set_member_pin(mem_id, m.pin);
    if not m.all_branches then
      insert into app.membership_branches (tenant_id, membership_id, branch_id) values (seed.id('tenant'), mem_id, seed.id('branch_ari'));
    end if;
  end loop;
end $$;

select app.set_member_pin(m.id, '1234') from app.memberships m where m.tenant_id = seed.id('tenant') and m.user_id is not null;

reset role;

select 'seeded tenant ' || seed.id('tenant') || ' (branches: อารีย์ ' || seed.id('branch_ari') || ', ทองหล่อ ' || seed.id('branch_tl') || ')' as result;
