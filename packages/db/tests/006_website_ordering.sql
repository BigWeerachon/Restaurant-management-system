-- =============================================================================
-- The shop's website: a key per branch, the public menu, and an order that lands on the kitchen screen (channel
-- "เว็บไซต์", no GP) and counts for pay-per-order once paid.
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
  if sqlerrm <> p_code then raise exception 'ASSERTION FAILED: expected %, got "%" from: %', p_code, sqlerrm, p_sql; end if;
end $$;
create or replace function test.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
create or replace function test.id(p_key text) returns uuid language sql stable as $$ select current_setting('test.' || p_key)::uuid; $$;
create or replace function test.put(p_key text, p_val uuid) returns void language sql as $$ select set_config('test.' || p_key, p_val::text, false); $$;
grant execute on all functions in schema test to authenticated;

select test.put('owner', '00000000-0000-7000-8006-0000000000a1');
insert into auth.users (id, email) values (test.id('owner'), 'web-owner@example.com');
set role authenticated;
select test.as_user(test.id('owner'));
do $$
declare r jsonb; k jsonb; c uuid; br uuid;
begin
  r := app.create_tenant('{"name":"คาเฟ่มีเว็บ","business_type":"cafe","branch_name":"สาขาหลัก","owner_name":"คุณเว็บ"}');
  perform test.put('tenant', (r->>'tenant_id')::uuid);
  perform test.put('branch', (r->>'branch_id')::uuid);
  k := app.create_website_key((r->>'branch_id')::uuid);
  perform set_config('test.key', k->>'key', false);
  perform test.ok((k->>'key') like 'sbw_%' and length(k->>'key') = 52, 'a long random key, shown once');
end $$;
reset role;

-- a menu: one plain item, one sold out
do $$
declare br uuid; c uuid; i1 uuid; i2 uuid;
begin
  select id into br from app.brands where tenant_id = test.id('tenant') limit 1;
  insert into app.menu_categories (tenant_id, brand_id, name) values (test.id('tenant'), br, 'กาแฟ') returning id into c;
  insert into app.menu_items (tenant_id, brand_id, category_id, name, price) values (test.id('tenant'), br, c, 'ลาเต้เย็น', 65) returning id into i1;
  insert into app.menu_items (tenant_id, brand_id, category_id, name, price) values (test.id('tenant'), br, c, 'มัทฉะ', 75) returning id into i2;
  insert into app.menu_item_availability (tenant_id, menu_item_id, branch_id, is_available) values (test.id('tenant'), i2, test.id('branch'), false);
  perform test.put('latte', i1);
  perform test.put('matcha', i2);
end $$;

select test.ok(not exists (select 1 from app.website_keys where key_hash = current_setting('test.key')), 'only the hash is kept');
select test.throws($$select app.website_menu('sbw_wrong')$$, 'NOT_FOUND');
select test.ok((select m->>'shop' = 'คาเฟ่มีเว็บ' and (m->>'ordering')::boolean
                       and exists (select 1 from jsonb_array_elements(m->'categories') c, jsonb_array_elements(c->'items') i
                                    where i->>'name' = 'ลาเต้เย็น' and (i->>'price')::numeric = 65 and (i->>'available')::boolean)
                       and exists (select 1 from jsonb_array_elements(m->'categories') c, jsonb_array_elements(c->'items') i
                                    where i->>'name' = 'มัทฉะ' and not (i->>'available')::boolean)
                  from app.website_menu(current_setting('test.key')) m), 'the menu comes from the POS, with sold out marked');

-- an order
select test.throws(format($$select app.website_place_order(%L, '{"customer_name":"","phone":"0812345678","items":[{"menu_item_id":"%s","qty":1}]}')$$, current_setting('test.key'), test.id('latte')), 'VALIDATION');
select test.throws(format($$select app.website_place_order(%L, '{"customer_name":"ก้อย","phone":"0812345678","items":[{"menu_item_id":"%s","qty":1}]}')$$, current_setting('test.key'), test.id('matcha')), 'MENU_ITEM_SOLD_OUT');
select set_config('test.r', app.website_place_order(current_setting('test.key'),
  jsonb_build_object('customer_name', 'ก้อย', 'phone', '081-234-5678', 'pickup_at', '12:30', 'external_ref', 'web-1',
                     'items', jsonb_build_array(jsonb_build_object('menu_item_id', test.id('latte'), 'qty', 2, 'note', 'หวานน้อย'))))::text, false);
select test.ok((select o.total = 130 and o.status = 'open' and o.commission_rate = 0 and c.key = 'website' and o.customer_name = 'ก้อย' and o.note like 'โทร 0812345678%'
                  from app.orders o join app.sales_channels c on c.id = o.channel_id where o.id = (current_setting('test.r')::jsonb->>'id')::uuid), 'a website order with no GP');
select test.ok(exists (select 1 from app.kitchen_tickets k where k.order_id = (current_setting('test.r')::jsonb->>'id')::uuid), 'it is on the kitchen screen');
select test.ok((app.website_place_order(current_setting('test.key'),
  jsonb_build_object('customer_name', 'ก้อย', 'phone', '0812345678', 'external_ref', 'web-1',
                     'items', jsonb_build_array(jsonb_build_object('menu_item_id', test.id('latte'), 'qty', 2)))) ->> 'repeat')::boolean, 'the same order sent twice is one order');

-- revoked → the website stops
set role authenticated;
select test.as_user(test.id('owner'));
select app.revoke_website_key(test.id('branch'));
reset role;
select test.throws(format($$select app.website_menu(%L)$$, current_setting('test.key')), 'NOT_FOUND');
