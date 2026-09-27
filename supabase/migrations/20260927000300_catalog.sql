-- =============================================================================
-- Sabai — Catalog: units, sales channels, payment methods, kitchen stations,
-- menu (categories, items, modifiers, channel/branch prices, availability), tables.
-- =============================================================================

-- Global unit catalog. Stock is always stored in a *base* unit (g, ml, pcs);
-- everything else is a display/entry conversion.
create table app.units (
  code            text primary key,
  dimension       text not null check (dimension in ('mass','volume','count')),
  factor_to_base  numeric(18,6) not null check (factor_to_base > 0),
  name_th         text not null,
  name_en         text not null,
  is_base         boolean not null default false
);
insert into app.units (code, dimension, factor_to_base, name_th, name_en, is_base) values
  ('g',     'mass',   1,      'กรัม',       'gram',        true),
  ('kg',    'mass',   1000,   'กิโลกรัม',    'kilogram',    false),
  ('ml',    'volume', 1,      'มิลลิลิตร',    'millilitre',  true),
  ('l',     'volume', 1000,   'ลิตร',        'litre',       false),
  ('tsp',   'volume', 5,      'ช้อนชา',      'teaspoon',    false),
  ('tbsp',  'volume', 15,     'ช้อนโต๊ะ',     'tablespoon',  false),
  ('cup',   'volume', 240,    'ถ้วยตวง',     'cup',         false),
  ('pcs',   'count',  1,      'ชิ้น',         'piece',       true),
  ('dozen', 'count',  12,     'โหล',         'dozen',       false);

alter table app.units enable row level security;
create policy catalog_read on app.units for select to authenticated using (true);
grant select on app.units to authenticated;

-- -----------------------------------------------------------------------------
-- Sales channels — "ขายผ่านช่องทางไหน"
-- -----------------------------------------------------------------------------
create table app.sales_channels (
  id                       uuid primary key default app.uuid_v7(),
  tenant_id                uuid not null references app.tenants(id) on delete cascade,
  key                      text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind                     text not null check (kind in ('dine_in','takeaway','delivery_platform','own_delivery','catering','other')),
  name                     text not null,
  color                    text,
  icon                     text,
  applies_service_charge   boolean not null default false,
  -- Default GP/commission; history lives in channel_commission_rates.
  commission_rate          numeric(6,4) not null default 0 check (commission_rate between 0 and 1),
  commission_vat_applies   boolean not null default true,
  settlement_days          int not null default 0 check (settlement_days between 0 and 90),
  receivable_account_id    uuid,
  is_active                boolean not null default true,
  sort                     int not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);
create trigger sales_channels_touch before update on app.sales_channels for each row execute function app.touch_row();

-- GP changes with platform promotions / government co-pay schemes. Orders snapshot
-- the rate valid on their business date, so historical profit never shifts.
create table app.channel_commission_rates (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  channel_id  uuid not null,
  rate        numeric(6,4) not null check (rate between 0 and 1),
  valid_from  date not null,
  valid_to    date,
  note        text,
  created_at  timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  foreign key (tenant_id, channel_id) references app.sales_channels(tenant_id, id) on delete cascade
);
create index channel_commission_rates_lookup on app.channel_commission_rates (channel_id, valid_from desc);

create or replace function app.channel_commission_rate(p_channel uuid, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select r.rate from app.channel_commission_rates r
      where r.channel_id = p_channel and r.valid_from <= p_date
        and (r.valid_to is null or r.valid_to >= p_date)
      order by r.valid_from desc limit 1),
    (select c.commission_rate from app.sales_channels c where c.id = p_channel),
    0)
$$;

-- -----------------------------------------------------------------------------
-- Payment methods — "รับเงินทางไหน"
-- -----------------------------------------------------------------------------
create table app.payment_methods (
  id                     uuid primary key default app.uuid_v7(),
  tenant_id              uuid not null references app.tenants(id) on delete cascade,
  kind                   text not null check (kind in ('cash','promptpay','card','ewallet','bank_transfer','platform','voucher','other')),
  name                   text not null,
  icon                   text,
  fee_rate               numeric(6,4) not null default 0 check (fee_rate between 0 and 0.2),
  fee_fixed              numeric(10,2) not null default 0 check (fee_fixed >= 0),
  opens_drawer           boolean not null default false,
  requires_reference     boolean not null default false,
  settlement_account_id  uuid,
  settlement_days        int not null default 0 check (settlement_days between 0 and 60),
  -- Non-secret configuration, e.g. {"promptpay_id":"0812345678"}.
  config                 jsonb not null default '{}'::jsonb,
  is_active              boolean not null default true,
  sort                   int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tenant_id, id)
);
create trigger payment_methods_touch before update on app.payment_methods for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Kitchen stations (per branch). Menu items carry a `kitchen_route` key; each
-- branch maps routes to its own stations, so one menu works across branches
-- with different kitchen layouts.
-- -----------------------------------------------------------------------------
create table app.kitchen_stations (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  branch_id       uuid not null,
  name            text not null,
  route_key       text not null default 'kitchen' check (route_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  color           text,
  warn_after_sec  int not null default 300 check (warn_after_sec > 0),
  late_after_sec  int not null default 600,
  sort            int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (late_after_sec > warn_after_sec),
  unique (tenant_id, id),
  unique (branch_id, route_key),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id)
);
create trigger kitchen_stations_touch before update on app.kitchen_stations for each row execute function app.touch_row();

alter table app.devices
  add foreign key (tenant_id, station_id) references app.kitchen_stations(tenant_id, id);

-- -----------------------------------------------------------------------------
-- Menu
-- -----------------------------------------------------------------------------
create table app.menu_categories (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null,
  brand_id     uuid not null,
  name         text not null check (length(trim(name)) between 1 and 60),
  name_en      text,
  color        text,
  icon         text,
  sort         int not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references app.brands(tenant_id, id)
);
create trigger menu_categories_touch before update on app.menu_categories for each row execute function app.touch_row();

create table app.menu_items (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  brand_id        uuid not null,
  category_id     uuid not null,
  sku             text,
  name            text not null check (length(trim(name)) between 1 and 80),
  name_en         text,
  description     text,
  image_url       text,
  price           numeric(12,2) not null check (price >= 0),
  kitchen_route   text not null default 'kitchen',
  prep_time_sec   int check (prep_time_sec is null or prep_time_sec between 0 and 7200),
  tags            text[] not null default '{}',
  sort            int not null default 0,
  is_active       boolean not null default true,
  archived_at     timestamptz,
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references app.brands(tenant_id, id),
  foreign key (tenant_id, category_id) references app.menu_categories(tenant_id, id)
);
create index menu_items_category on app.menu_items (category_id) where archived_at is null;
create unique index menu_items_sku on app.menu_items (tenant_id, sku) where sku is not null and archived_at is null;
create trigger menu_items_touch before update on app.menu_items for each row execute function app.touch_versioned_row();

-- Price overrides by channel and/or branch (delivery prices often differ).
-- Resolution order: branch+channel → channel → branch → base price.
create table app.menu_item_prices (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null,
  menu_item_id  uuid not null,
  channel_id    uuid,
  branch_id     uuid,
  price         numeric(12,2) not null check (price >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (channel_id is not null or branch_id is not null),
  foreign key (tenant_id, menu_item_id) references app.menu_items(tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_id) references app.sales_channels(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id) on delete cascade
);
create unique index menu_item_prices_unique on app.menu_item_prices (menu_item_id, channel_id, branch_id) nulls not distinct;
create trigger menu_item_prices_touch before update on app.menu_item_prices for each row execute function app.touch_row();

-- "86" / sold out, per branch.
create table app.menu_item_availability (
  tenant_id       uuid not null,
  menu_item_id    uuid not null,
  branch_id       uuid not null,
  is_available    boolean not null default true,
  sold_out_until  timestamptz,
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  primary key (menu_item_id, branch_id),
  foreign key (tenant_id, menu_item_id) references app.menu_items(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id) on delete cascade
);
create trigger menu_item_availability_touch before update on app.menu_item_availability for each row execute function app.touch_row();

create table app.modifier_groups (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  brand_id    uuid not null,
  name        text not null,
  min_select  int not null default 0 check (min_select >= 0),
  max_select  int not null default 1 check (max_select >= 1),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (max_select >= min_select),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references app.brands(tenant_id, id)
);
create trigger modifier_groups_touch before update on app.modifier_groups for each row execute function app.touch_row();

create table app.modifier_options (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null,
  group_id     uuid not null,
  name         text not null,
  price_delta  numeric(12,2) not null default 0,
  is_default   boolean not null default false,
  sort         int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, group_id) references app.modifier_groups(tenant_id, id) on delete cascade
);
create index modifier_options_group on app.modifier_options (group_id);
create trigger modifier_options_touch before update on app.modifier_options for each row execute function app.touch_row();

create table app.menu_item_modifier_groups (
  tenant_id     uuid not null,
  menu_item_id  uuid not null,
  group_id      uuid not null,
  sort          int not null default 0,
  primary key (menu_item_id, group_id),
  foreign key (tenant_id, menu_item_id) references app.menu_items(tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_id) references app.modifier_groups(tenant_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Dining areas & tables
-- -----------------------------------------------------------------------------
create table app.dining_areas (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null,
  branch_id  uuid not null,
  name       text not null,
  sort       int not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id) on delete cascade
);

create table app.dining_tables (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null,
  branch_id  uuid not null,
  area_id    uuid,
  name       text not null,
  seats      int not null default 2 check (seats between 1 and 50),
  sort       int not null default 0,
  is_active  boolean not null default true,
  unique (tenant_id, id),
  unique (branch_id, name),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, area_id) references app.dining_areas(tenant_id, id) on delete set null (area_id)
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
call app.apply_tenant_rls('app.sales_channels', null, 'settings.manage');
call app.apply_tenant_rls('app.channel_commission_rates', null, 'settings.manage');
call app.apply_tenant_rls('app.payment_methods', null, 'settings.manage');
call app.apply_tenant_rls('app.kitchen_stations', null, 'settings.manage', 'branch_id');
call app.apply_tenant_rls('app.menu_categories', null, 'menu.manage');
call app.apply_tenant_rls('app.menu_items', null, 'menu.manage');
call app.apply_tenant_rls('app.menu_item_prices', null, 'menu.manage');
call app.apply_tenant_rls('app.menu_item_availability', null, 'menu.availability', 'branch_id');
call app.apply_tenant_rls('app.modifier_groups', null, 'menu.manage');
call app.apply_tenant_rls('app.modifier_options', null, 'menu.manage');
call app.apply_tenant_rls('app.menu_item_modifier_groups', null, 'menu.manage');
call app.apply_tenant_rls('app.dining_areas', null, 'settings.manage', 'branch_id');
call app.apply_tenant_rls('app.dining_tables', null, 'settings.manage', 'branch_id');

-- Price resolution used by POS and reporting.
create or replace function app.resolve_menu_price(p_item uuid, p_channel uuid, p_branch uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select p.price from app.menu_item_prices p where p.menu_item_id = p_item and p.channel_id = p_channel and p.branch_id = p_branch),
    (select p.price from app.menu_item_prices p where p.menu_item_id = p_item and p.channel_id = p_channel and p.branch_id is null),
    (select p.price from app.menu_item_prices p where p.menu_item_id = p_item and p.channel_id is null and p.branch_id = p_branch),
    (select i.price from app.menu_items i where i.id = p_item)
  )
$$;
