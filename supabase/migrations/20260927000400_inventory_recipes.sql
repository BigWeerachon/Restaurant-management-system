-- =============================================================================
-- Sabai — Inventory & recipes (BOM)
--
--   ingredients ──< recipe_lines >── recipes (menu_item | modifier_option | prep)
--   stock_locations ──< stock_movements (append-only ledger) ──> stock_balances
--
-- Design notes
--   * Recipe lines always reference *ingredients*. A "prep" ingredient (syrup,
--     curry paste) has its own prep recipe. If the prep is stock-tracked it is
--     produced in batches and consumed from stock; if not, sales explode it into
--     its raw ingredients. One uniform model, no special cases in the UI.
--   * Moving weighted-average cost, maintained by the ledger trigger.
--   * Negative on-hand is allowed on purpose: the kitchen must never be blocked
--     from selling because someone forgot to record a delivery. It is flagged.
--   * Inventory never calls finance. Day close summarises the sub-ledger into
--     the GL (see finance migration) — modules stay decoupled.
-- =============================================================================

create table app.stock_locations (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  branch_id   uuid not null,
  name        text not null,
  kind        text not null default 'store' check (kind in ('store','kitchen','bar','cold','dry','warehouse')),
  is_default  boolean not null default false,
  sort        int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id)
);
create unique index stock_locations_one_default on app.stock_locations (branch_id) where is_default;

create table app.ingredient_categories (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  name       text not null,
  sort       int not null default 0,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table app.ingredients (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references app.tenants(id) on delete cascade,
  category_id     uuid,
  name            text not null check (length(trim(name)) between 1 and 80),
  name_en         text,
  sku             text,
  kind            text not null default 'raw' check (kind in ('raw','prep','packaging','merchandise')),
  base_unit       text not null references app.units(code),
  display_unit    text references app.units(code),
  track_stock     boolean not null default true,
  reorder_point   numeric(18,4) check (reorder_point is null or reorder_point >= 0),
  par_level       numeric(18,4) check (par_level is null or par_level >= 0),
  standard_cost   numeric(18,6) check (standard_cost is null or standard_cost >= 0),
  last_cost       numeric(18,6),
  storage_zone    text,
  count_sort      int not null default 0,
  shelf_life_days int,
  is_high_value   boolean not null default false,
  archived_at     timestamptz,
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references app.ingredient_categories(tenant_id, id) on delete set null (category_id)
);
create unique index ingredients_name_unique on app.ingredients (tenant_id, lower(name)) where archived_at is null;
create trigger ingredients_touch before update on app.ingredients for each row execute function app.touch_versioned_row();

-- Base unit must be a base unit (g/ml/pcs) and display unit must share its dimension.
create or replace function app.check_ingredient_units()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base app.units;
  disp app.units;
begin
  select * into base from app.units where code = new.base_unit;
  if not base.is_base then
    perform app.raise_error('INVALID_BASE_UNIT', jsonb_build_object('unit', new.base_unit));
  end if;
  if new.display_unit is not null then
    select * into disp from app.units where code = new.display_unit;
    if disp.dimension <> base.dimension then
      perform app.raise_error('UNIT_DIMENSION_MISMATCH', jsonb_build_object('base', new.base_unit, 'display', new.display_unit));
    end if;
  end if;
  return new;
end;
$$;
create trigger ingredients_units before insert or update of base_unit, display_unit on app.ingredients
  for each row execute function app.check_ingredient_units();

-- -----------------------------------------------------------------------------
-- Recipes
-- -----------------------------------------------------------------------------
create table app.recipes (
  id                    uuid primary key default app.uuid_v7(),
  tenant_id             uuid not null,
  kind                  text not null check (kind in ('menu_item','modifier_option','prep')),
  menu_item_id          uuid,
  modifier_option_id    uuid,
  output_ingredient_id  uuid,
  -- Portions for menu items (usually 1); base units produced for prep recipes.
  yield_qty             numeric(18,4) not null default 1 check (yield_qty > 0),
  instructions          text,
  version               int not null default 1,
  is_current            boolean not null default true,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, id),
  check (
    (kind = 'menu_item'       and menu_item_id is not null and modifier_option_id is null and output_ingredient_id is null) or
    (kind = 'modifier_option' and modifier_option_id is not null and menu_item_id is null and output_ingredient_id is null) or
    (kind = 'prep'            and output_ingredient_id is not null and menu_item_id is null and modifier_option_id is null)
  ),
  foreign key (tenant_id, menu_item_id) references app.menu_items(tenant_id, id) on delete cascade,
  foreign key (tenant_id, modifier_option_id) references app.modifier_options(tenant_id, id) on delete cascade,
  foreign key (tenant_id, output_ingredient_id) references app.ingredients(tenant_id, id) on delete cascade
);
create unique index recipes_current_menu on app.recipes (menu_item_id) where is_current and kind = 'menu_item';
create unique index recipes_current_modifier on app.recipes (modifier_option_id) where is_current and kind = 'modifier_option';
create unique index recipes_current_prep on app.recipes (output_ingredient_id) where is_current and kind = 'prep';
create trigger recipes_touch before update on app.recipes for each row execute function app.touch_row();

create table app.recipe_lines (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  recipe_id      uuid not null,
  ingredient_id  uuid not null,
  -- Base units. Negative only allowed on modifier recipes (substitution, e.g. oat milk replaces milk).
  qty            numeric(18,4) not null check (qty <> 0),
  -- Trim/cooking loss, e.g. 0.15 = buy 115 g to serve 100 g.
  waste_rate     numeric(5,4) not null default 0 check (waste_rate between 0 and 0.95),
  sort           int not null default 0,
  note           text,
  unique (tenant_id, id),
  unique (recipe_id, ingredient_id),
  foreign key (tenant_id, recipe_id) references app.recipes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id)
);
create index recipe_lines_ingredient on app.recipe_lines (ingredient_id);

create or replace function app.check_recipe_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r app.recipes;
  cycle_found boolean;
begin
  select * into r from app.recipes where id = new.recipe_id;
  if new.qty < 0 and r.kind <> 'modifier_option' then
    perform app.raise_error('RECIPE_QTY_MUST_BE_POSITIVE');
  end if;
  if r.kind = 'prep' then
    if new.ingredient_id = r.output_ingredient_id then
      perform app.raise_error('RECIPE_CYCLE', jsonb_build_object('ingredient_id', new.ingredient_id));
    end if;
    -- Does the new component (transitively) use this prep's output?
    with recursive deps(ingredient_id, depth) as (
      select new.ingredient_id, 1
      union
      select l.ingredient_id, d.depth + 1
      from deps d
      join app.recipes pr on pr.output_ingredient_id = d.ingredient_id and pr.is_current and pr.kind = 'prep'
      join app.recipe_lines l on l.recipe_id = pr.id
      where d.depth < 12
    )
    select exists (select 1 from deps where ingredient_id = r.output_ingredient_id) into cycle_found;
    if cycle_found then
      perform app.raise_error('RECIPE_CYCLE', jsonb_build_object('ingredient_id', new.ingredient_id));
    end if;
  end if;
  return new;
end;
$$;
create trigger recipe_lines_check before insert or update on app.recipe_lines
  for each row execute function app.check_recipe_line();

-- -----------------------------------------------------------------------------
-- Stock ledger
-- -----------------------------------------------------------------------------
create table app.stock_movements (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  branch_id      uuid not null,
  location_id    uuid not null,
  ingredient_id  uuid not null,
  qty            numeric(18,4) not null check (qty <> 0),
  unit_cost      numeric(18,6) not null default 0 check (unit_cost >= 0),
  total_cost     numeric(18,4) generated always as (round(qty * unit_cost, 4)) stored,
  reason         text not null check (reason in (
                   'opening','purchase','sale','sale_void','waste','count_adjust',
                   'transfer_out','transfer_in','production_out','production_in',
                   'return_to_supplier','manual_adjust')),
  reason_code    text,
  source_type    text,
  source_id      uuid,
  business_date  date not null,
  occurred_at    timestamptz not null default now(),
  created_by     uuid,
  note           text,
  created_at     timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, location_id) references app.stock_locations(tenant_id, id),
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id)
);
create index stock_movements_item_time on app.stock_movements (ingredient_id, location_id, occurred_at desc);
create index stock_movements_branch_date on app.stock_movements (branch_id, business_date, reason);
create index stock_movements_source on app.stock_movements (source_type, source_id);

create table app.stock_balances (
  tenant_id         uuid not null,
  location_id       uuid not null,
  ingredient_id     uuid not null,
  qty_on_hand       numeric(18,4) not null default 0,
  avg_cost          numeric(18,6) not null default 0,
  last_movement_at  timestamptz,
  primary key (location_id, ingredient_id),
  foreign key (tenant_id, location_id) references app.stock_locations(tenant_id, id),
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id)
);
create index stock_balances_tenant on app.stock_balances (tenant_id);

create or replace function app.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bal       app.stock_balances;
  ing       app.ingredients;
  fallback  numeric;
  new_avg   numeric;
begin
  perform app.assert_period_open(new.branch_id, new.business_date);

  select * into ing from app.ingredients where id = new.ingredient_id;
  fallback := coalesce(ing.last_cost, ing.standard_cost, 0);

  insert into app.stock_balances (tenant_id, location_id, ingredient_id, qty_on_hand, avg_cost)
  values (new.tenant_id, new.location_id, new.ingredient_id, 0, fallback)
  on conflict (location_id, ingredient_id) do nothing;

  select * into bal from app.stock_balances
   where location_id = new.location_id and ingredient_id = new.ingredient_id
   for update;

  if new.qty < 0 or new.reason in ('count_adjust','manual_adjust','sale_void') then
    -- Outflows (and corrections) move at current average cost.
    new.unit_cost := coalesce(nullif(bal.avg_cost, 0), fallback);
    new_avg := bal.avg_cost;
  else
    if new.unit_cost = 0 then
      new.unit_cost := coalesce(nullif(bal.avg_cost, 0), fallback);
    end if;
    if bal.qty_on_hand <= 0 then
      new_avg := new.unit_cost;
    else
      new_avg := (bal.qty_on_hand * bal.avg_cost + new.qty * new.unit_cost) / (bal.qty_on_hand + new.qty);
    end if;
  end if;

  update app.stock_balances
     set qty_on_hand = qty_on_hand + new.qty,
         avg_cost = round(coalesce(new_avg, 0), 6),
         last_movement_at = greatest(coalesce(last_movement_at, new.occurred_at), new.occurred_at)
   where location_id = new.location_id and ingredient_id = new.ingredient_id;

  if new.reason = 'purchase' then
    update app.ingredients set last_cost = new.unit_cost where id = new.ingredient_id;
  end if;

  return new;
end;
$$;
create trigger stock_movements_apply before insert on app.stock_movements
  for each row execute function app.apply_stock_movement();
create trigger stock_movements_immutable before update or delete on app.stock_movements
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Costing
-- -----------------------------------------------------------------------------

-- Cost per base unit. Tracked items: average cost (location, else tenant-wide);
-- untracked prep: rolled up from its recipe.
create or replace function app.ingredient_unit_cost(p_ingredient uuid, p_location uuid default null, p_depth int default 0)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  ing app.ingredients;
  prep app.recipes;
  cost numeric;
begin
  if p_depth > 10 then
    perform app.raise_error('RECIPE_CYCLE');
  end if;
  select * into ing from app.ingredients where id = p_ingredient;
  if ing.kind = 'prep' and not ing.track_stock then
    select * into prep from app.recipes where output_ingredient_id = p_ingredient and is_current and kind = 'prep';
    if found then
      select coalesce(sum(l.qty * (1 + l.waste_rate) * app.ingredient_unit_cost(l.ingredient_id, p_location, p_depth + 1)), 0) / prep.yield_qty
        into cost
        from app.recipe_lines l where l.recipe_id = prep.id;
      return round(cost, 6);
    end if;
  end if;

  if p_location is not null then
    select nullif(b.avg_cost, 0) into cost from app.stock_balances b
     where b.location_id = p_location and b.ingredient_id = p_ingredient;
  end if;
  if cost is null then
    select case when sum(greatest(b.qty_on_hand, 0)) > 0
                then sum(greatest(b.qty_on_hand, 0) * b.avg_cost) / sum(greatest(b.qty_on_hand, 0)) end
      into cost
      from app.stock_balances b where b.ingredient_id = p_ingredient;
  end if;
  return round(coalesce(nullif(cost, 0), ing.last_cost, ing.standard_cost, 0), 6);
end;
$$;

-- Theoretical cost of one portion of a menu item incl. chosen modifier options.
create or replace function app.menu_item_cost(p_menu_item uuid, p_modifier_options uuid[] default '{}', p_location uuid default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(coalesce(sum(l.qty * (1 + l.waste_rate) * app.ingredient_unit_cost(l.ingredient_id, p_location) / r.yield_qty), 0), 4)
  from app.recipes r
  join app.recipe_lines l on l.recipe_id = r.id
  where r.is_current
    and ((r.kind = 'menu_item' and r.menu_item_id = p_menu_item)
      or (r.kind = 'modifier_option' and r.modifier_option_id = any(p_modifier_options)))
$$;

-- Explode a recipe into leaf ingredients to consume (untracked preps are expanded).
create or replace function app.explode_recipe(p_recipe uuid, p_multiplier numeric)
returns table (ingredient_id uuid, qty numeric)
language sql
stable
set search_path = ''
as $$
  with recursive x(ingredient_id, qty, depth) as (
    select l.ingredient_id, p_multiplier * l.qty * (1 + l.waste_rate) / r.yield_qty, 1
    from app.recipes r join app.recipe_lines l on l.recipe_id = r.id
    where r.id = p_recipe
    union all
    select l.ingredient_id, x.qty * l.qty * (1 + l.waste_rate) / pr.yield_qty, x.depth + 1
    from x
    join app.ingredients i on i.id = x.ingredient_id and i.kind = 'prep' and not i.track_stock
    join app.recipes pr on pr.output_ingredient_id = i.id and pr.is_current and pr.kind = 'prep'
    join app.recipe_lines l on l.recipe_id = pr.id
    where x.depth < 10
  )
  select x.ingredient_id, round(sum(x.qty), 4)
  from x
  join app.ingredients i on i.id = x.ingredient_id
  where i.track_stock
  group by x.ingredient_id
$$;

-- -----------------------------------------------------------------------------
-- Stock counts (blind by default), transfers, production
-- -----------------------------------------------------------------------------
create table app.stock_counts (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  branch_id      uuid not null,
  location_id    uuid not null,
  count_no       text not null,
  scope          text not null default 'full' check (scope in ('full','partial','cycle')),
  status         text not null default 'in_progress' check (status in ('in_progress','submitted','approved','cancelled')),
  is_blind       boolean not null default true,
  business_date  date not null,
  started_by     uuid,
  started_at     timestamptz not null default now(),
  submitted_by   uuid,
  submitted_at   timestamptz,
  approved_by    uuid,
  approved_at    timestamptz,
  note           text,
  unique (tenant_id, id),
  unique (branch_id, count_no),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, location_id) references app.stock_locations(tenant_id, id)
);
create unique index stock_counts_one_open on app.stock_counts (location_id) where status in ('in_progress','submitted');

create table app.stock_count_lines (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  count_id       uuid not null,
  ingredient_id  uuid not null,
  expected_qty   numeric(18,4),
  counted_qty    numeric(18,4) check (counted_qty is null or counted_qty >= 0),
  unit_cost      numeric(18,6),
  counted_by     uuid,
  counted_at     timestamptz,
  note           text,
  unique (count_id, ingredient_id),
  foreign key (tenant_id, count_id) references app.stock_counts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id)
);

create table app.stock_transfers (
  id                uuid primary key default app.uuid_v7(),
  tenant_id         uuid not null,
  transfer_no       text not null,
  from_branch_id    uuid not null,
  from_location_id  uuid not null,
  to_branch_id      uuid not null,
  to_location_id    uuid not null,
  status            text not null default 'draft' check (status in ('draft','sent','received','cancelled')),
  sent_by           uuid,
  sent_at           timestamptz,
  received_by       uuid,
  received_at       timestamptz,
  note              text,
  created_at        timestamptz not null default now(),
  check (from_location_id <> to_location_id),
  unique (tenant_id, id),
  unique (tenant_id, transfer_no),
  foreign key (tenant_id, from_branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, to_branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, from_location_id) references app.stock_locations(tenant_id, id),
  foreign key (tenant_id, to_location_id) references app.stock_locations(tenant_id, id)
);

create table app.stock_transfer_lines (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  transfer_id    uuid not null,
  ingredient_id  uuid not null,
  qty_sent       numeric(18,4) not null check (qty_sent > 0),
  qty_received   numeric(18,4) check (qty_received is null or qty_received >= 0),
  unit_cost      numeric(18,6),
  unique (transfer_id, ingredient_id),
  foreign key (tenant_id, transfer_id) references app.stock_transfers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ingredient_id) references app.ingredients(tenant_id, id)
);

create table app.production_batches (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null,
  branch_id      uuid not null,
  location_id    uuid not null,
  recipe_id      uuid not null,
  produced_qty   numeric(18,4) not null check (produced_qty > 0),
  unit_cost      numeric(18,6),
  business_date  date not null,
  produced_by    uuid,
  produced_at    timestamptz not null default now(),
  note           text,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, location_id) references app.stock_locations(tenant_id, id),
  foreign key (tenant_id, recipe_id) references app.recipes(tenant_id, id)
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
call app.apply_tenant_rls('app.stock_locations', null, 'settings.manage', 'branch_id');
call app.apply_tenant_rls('app.ingredient_categories', null, 'inventory.manage');
call app.apply_tenant_rls('app.ingredients', null, 'inventory.manage');
call app.apply_tenant_rls('app.recipes', 'recipes.view', 'recipes.manage');
call app.apply_tenant_rls('app.recipe_lines', 'recipes.view', 'recipes.manage');
-- Ledgers & documents: read by permission, write only through commands below.
call app.apply_tenant_rls('app.stock_movements', 'inventory.view', null, 'branch_id');
call app.apply_tenant_rls('app.stock_balances', 'inventory.view');
call app.apply_tenant_rls('app.stock_counts', 'inventory.count', null, 'branch_id');
call app.apply_tenant_rls('app.stock_count_lines', 'inventory.count');
call app.apply_tenant_rls('app.stock_transfers', 'inventory.view');
call app.apply_tenant_rls('app.stock_transfer_lines', 'inventory.view');
call app.apply_tenant_rls('app.production_batches', 'inventory.view', null, 'branch_id');
