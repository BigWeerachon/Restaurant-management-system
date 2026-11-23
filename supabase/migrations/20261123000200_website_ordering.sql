-- =============================================================================
-- Sabai — the shop's own website (สั่งจากเว็บไซต์ร้าน)
--
--   A branch can have one website key. The website uses it to:
--     app.website_menu(key)            show the menu, prices and what is sold out, straight from the POS
--     app.website_place_order(key, p) send an order to the kitchen screen on the channel "เว็บไซต์" (no GP)
--   The order is paid at the counter like any other; once paid it counts for pay-per-order like any other order.
--
--   app.create_website_key(branch)    a new key (the old one stops working). Shown once; only its hash is kept.
--   app.revoke_website_key(branch)    switches the website off.
--
-- The key is not a secret in the browser sense (the website shows the menu with it), so it can only read the public
-- menu and place an order of up to 30 lines, never pay, refund or read anything else. A branch takes at most 30 open
-- website orders at a time, so a flood of fake orders stops there and staff see it.
-- =============================================================================

create table app.website_keys (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references app.tenants(id) on delete cascade,
  branch_id   uuid not null references app.branches(id) on delete cascade,
  key_hash    text not null unique,
  key_hint    text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index website_keys_one_live on app.website_keys (branch_id) where revoked_at is null;
call app.apply_tenant_rls('app.website_keys', 'settings.manage');

create or replace function app.website_key_hash(p_key text)
returns text language sql immutable set search_path = ''
as $$ select encode(extensions.digest(convert_to(coalesce(p_key, ''), 'UTF8'), 'sha256'), 'hex') $$;

-- The website channel of a shop: made the first time it is needed, with no commission.
create or replace function app.website_channel(p_tenant uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid;
begin
  select id into v from app.sales_channels where tenant_id = p_tenant and key = 'website';
  if v is null then
    insert into app.sales_channels (tenant_id, key, kind, name, icon, commission_rate, sort)
    values (p_tenant, 'website', 'other', 'เว็บไซต์', 'globe', 0, 90)
    returning id into v;
  end if;
  return v;
end;
$$;

create or replace function app.create_website_key(p_branch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b app.branches;
  v_key text;
begin
  select * into b from app.branches where id = p_branch;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'branch')); end if;
  perform app.assert_permission(b.tenant_id, 'settings.manage');
  v_key := 'sbw_' || encode(extensions.gen_random_bytes(24), 'hex');
  update app.website_keys set revoked_at = now() where branch_id = b.id and revoked_at is null;
  insert into app.website_keys (tenant_id, branch_id, key_hash, key_hint, created_by)
  values (b.tenant_id, b.id, app.website_key_hash(v_key), right(v_key, 4), app.actor_membership_id(b.tenant_id));
  perform app.website_channel(b.tenant_id);
  perform app.emit_event(b.tenant_id, b.id, 'branch', b.id, 'website.key_created', jsonb_build_object('hint', right(v_key, 4)), app.actor_membership_id(b.tenant_id));
  return jsonb_build_object('key', v_key, 'hint', right(v_key, 4), 'branch_id', b.id);
end;
$$;

create or replace function app.revoke_website_key(p_branch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b app.branches;
begin
  select * into b from app.branches where id = p_branch;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'branch')); end if;
  perform app.assert_permission(b.tenant_id, 'settings.manage');
  update app.website_keys set revoked_at = now() where branch_id = b.id and revoked_at is null;
end;
$$;

-- Which branch a key opens. NOT_FOUND for a wrong or revoked key (never says which).
create or replace function app.website_branch(p_key text)
returns app.branches
language plpgsql stable
security definer
set search_path = ''
as $$
declare b app.branches;
begin
  select br.* into b from app.website_keys k join app.branches br on br.id = k.branch_id
   where k.key_hash = app.website_key_hash(p_key) and k.revoked_at is null and br.archived_at is null and br.is_active;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  return b;
end;
$$;

-- What the website may sell: active, not archived, and needing no choice the website cannot ask for (a required option).
create or replace function app.website_sellable(p_item uuid)
returns boolean language sql stable set search_path = ''
as $$
  select not exists (select 1 from app.menu_item_modifier_groups mg join app.modifier_groups g on g.id = mg.group_id
                      where mg.menu_item_id = p_item and g.min_select > 0)
$$;

create or replace function app.website_menu(p_key text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  b app.branches;
  t app.tenants;
  v_channel uuid;
begin
  b := app.website_branch(p_key);
  select * into t from app.tenants where id = b.tenant_id;
  select id into v_channel from app.sales_channels where tenant_id = t.id and key = 'website';
  return jsonb_build_object(
    'shop', t.name, 'branch', b.name, 'phone', b.phone, 'address', b.address, 'currency', 'THB',
    'prices_include_vat', t.prices_include_vat,
    'ordering', v_channel is not null and exists (select 1 from app.sales_channels c where c.id = v_channel and c.is_active),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'items', c.items) order by c.sort, c.name)
        from (
          select mc.id, mc.name, mc.sort,
                 jsonb_agg(jsonb_build_object(
                   'id', mi.id, 'name', mi.name, 'name_en', mi.name_en, 'description', mi.description, 'image_url', mi.image_url,
                   'price', case when v_channel is null then mi.price else app.resolve_menu_price(mi.id, v_channel, b.id) end,
                   'tags', mi.tags,
                   'available', not exists (select 1 from app.menu_item_availability a where a.menu_item_id = mi.id and a.branch_id = b.id
                                              and (not a.is_available or (a.sold_out_until is not null and a.sold_out_until > now()))))
                   order by mi.sort, mi.name) as items
            from app.menu_categories mc
            join app.menu_items mi on mi.category_id = mc.id and mi.is_active and mi.archived_at is null and app.website_sellable(mi.id)
           where mc.tenant_id = t.id and mc.archived_at is null
           group by mc.id, mc.name, mc.sort
        ) c), '[]'::jsonb));
end;
$$;

-- p: {customer_name, phone, note?, pickup_at?, external_ref?, items: [{menu_item_id, qty, note?}]}
-- Returns the order number to show the customer. The kitchen sees it at once.
create or replace function app.website_place_order(p_key text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b app.branches;
  t app.tenants;
  ch app.sales_channels;
  o app.orders;
  mi app.menu_items;
  it jsonb;
  bd date;
  v_qty numeric;
  v_price numeric;
  v_name text := left(btrim(coalesce(p->>'customer_name', '')), 60);
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
  v_note text;
begin
  b := app.website_branch(p_key);
  select * into t from app.tenants where id = b.tenant_id;
  select * into ch from app.sales_channels where tenant_id = t.id and key = 'website' and is_active;
  if not found then perform app.raise_error('CHANNEL_NOT_FOUND'); end if;

  if v_name = '' then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'customerName')); end if;
  if length(v_phone) not between 9 and 15 then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'phone')); end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') not between 1 and 30 then
    perform app.raise_error('VALIDATION', jsonb_build_object('field', 'items'));
  end if;

  -- The same website order sent twice (a double tap, a retry) is one order.
  if nullif(p->>'external_ref', '') is not null then
    select * into o from app.orders where tenant_id = t.id and branch_id = b.id and channel_id = ch.id and external_ref = p->>'external_ref';
    if found then return jsonb_build_object('id', o.id, 'order_no', o.order_no, 'total', o.total, 'status', o.status, 'repeat', true); end if;
  end if;

  perform 1 from app.branches where id = b.id for update;
  if (select count(*) from app.orders where branch_id = b.id and channel_id = ch.id and status = 'open') >= 30 then
    perform app.raise_error('RATE_LIMITED');
  end if;

  bd := app.business_date(b.id);
  perform app.assert_period_open(b.id, bd);
  v_note := left(concat_ws(' · ', 'โทร ' || v_phone, 'รับ ' || nullif(left(p->>'pickup_at', 40), ''), nullif(left(btrim(p->>'note'), 200), '')), 300);
  insert into app.orders (tenant_id, branch_id, channel_id, order_no, business_date, customer_name, external_ref, note,
                          prices_include_vat, vat_rate, service_charge_rate, commission_rate, commission_vat, shift_id)
  values (t.id, b.id, ch.id, lpad(app.next_doc_no(b.id, 'order', bd::text)::text, 3, '0'), bd, v_name, nullif(left(p->>'external_ref', 80), ''), v_note,
          t.prices_include_vat, case when t.vat_registered then t.vat_rate else 0 end, 0, 0, ch.commission_vat_applies,
          (select s.id from app.shifts s where s.branch_id = b.id and s.status = 'open' order by s.opened_at desc limit 1))
  returning * into o;

  for it in select * from jsonb_array_elements(p->'items') loop
    select * into mi from app.menu_items where id = (it->>'menu_item_id')::uuid and tenant_id = t.id and is_active and archived_at is null;
    if not found or not app.website_sellable(mi.id) then
      perform app.raise_error('MENU_ITEM_NOT_FOUND', jsonb_build_object('menu_item_id', it->>'menu_item_id'));
    end if;
    if exists (select 1 from app.menu_item_availability a where a.menu_item_id = mi.id and a.branch_id = b.id
                and (not a.is_available or (a.sold_out_until is not null and a.sold_out_until > now()))) then
      perform app.raise_error('MENU_ITEM_SOLD_OUT', jsonb_build_object('name', mi.name));
    end if;
    v_qty := coalesce((it->>'qty')::numeric, 1);
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 20 then perform app.raise_error('INVALID_QTY'); end if;
    v_price := app.resolve_menu_price(mi.id, ch.id, b.id);
    insert into app.order_items (tenant_id, order_id, menu_item_id, name, qty, unit_price, modifiers_total, line_total, note, kitchen_route)
    values (t.id, o.id, mi.id, mi.name, v_qty, v_price, 0, round(v_qty * v_price, 2), nullif(left(btrim(it->>'note'), 120), ''), mi.kitchen_route);
  end loop;

  o := app.recalc_order(o.id);
  perform app.emit_event(t.id, b.id, 'order', o.id, 'order.opened', jsonb_build_object('order_no', o.order_no, 'channel_id', ch.id, 'source', 'website'));
  perform app.fire_order(o.id);
  return jsonb_build_object('id', o.id, 'order_no', o.order_no, 'total', o.total, 'status', o.status, 'repeat', false);
end;
$$;

revoke all on function app.website_menu(text), app.website_place_order(text, jsonb), app.website_branch(text) from public, authenticated;
grant execute on function app.create_website_key(uuid), app.revoke_website_key(uuid) to authenticated;
