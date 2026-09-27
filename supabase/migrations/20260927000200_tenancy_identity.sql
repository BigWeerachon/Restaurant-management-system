-- =============================================================================
-- Sabai — Tenancy, identity, roles & permissions
--
-- tenant (the SaaS customer / company)
--   ├─ brands          (one kitchen can run several brands — common for cloud kitchens)
--   ├─ branches        (outlet | central_kitchen | warehouse)
--   ├─ roles ─ role_permissions ─ permissions (global catalog, code-defined keys)
--   └─ memberships     (a person inside a tenant; may be PIN-only staff without e-mail)
--        └─ membership_branches (branch scope when not all_branches)
--
-- Actor model: a request carries either an auth user (JWT `sub`) or a device
-- token minted by the API after a staff PIN switch (JWT claim `mid` = membership).
-- All `created_by` / `*_by` columns store the membership id (the person *inside*
-- the tenant), so PIN-only part-timers are first-class and auditable.
-- =============================================================================

create table app.tenants (
  id                  uuid primary key default app.uuid_v7(),
  name                text not null check (length(trim(name)) between 1 and 120),
  legal_name          text,
  tax_id              text check (tax_id is null or tax_id ~ '^[0-9]{13}$'),
  business_type       text not null default 'restaurant'
                      check (business_type in ('cafe','restaurant','bar','bakery','cloud_kitchen','food_truck','buffet','other')),
  country             text not null default 'TH',
  currency            text not null default 'THB',
  timezone            text not null default 'Asia/Bangkok',
  locale              text not null default 'th-TH',
  vat_registered      boolean not null default false,
  prices_include_vat  boolean not null default true,
  vat_rate            numeric(5,4) not null default 0.07 check (vat_rate between 0 and 1),
  cash_rounding       text not null default 'none' check (cash_rounding in ('none','0.25','1.00')),
  status              text not null default 'active' check (status in ('active','suspended','closed')),
  settings            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger tenants_touch before update on app.tenants for each row execute function app.touch_row();

create table app.brands (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references app.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  color       text,
  logo_url    text,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index brands_one_default on app.brands (tenant_id) where is_default;
create trigger brands_touch before update on app.brands for each row execute function app.touch_row();

create table app.branches (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null references app.tenants(id) on delete cascade,
  code                 text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name                 text not null check (length(trim(name)) between 1 and 120),
  kind                 text not null default 'outlet' check (kind in ('outlet','central_kitchen','warehouse')),
  address              text,
  phone                text,
  timezone             text not null default 'Asia/Bangkok',
  -- Sales after midnight but before the cutoff belong to the previous business day.
  day_cutoff           time not null default '05:00',
  opening_hours        jsonb not null default '{}'::jsonb,
  -- Thai tax invoice requires the branch number (00000 = head office).
  tax_branch_no        text not null default '00000' check (tax_branch_no ~ '^[0-9]{5}$'),
  service_charge_rate  numeric(5,4) not null default 0 check (service_charge_rate between 0 and 0.3),
  is_active            boolean not null default true,
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create trigger branches_touch before update on app.branches for each row execute function app.touch_row();

-- One row per auth user (Supabase auth.users.id). Personal, cross-tenant.
create table app.profiles (
  id            uuid primary key,
  display_name  text not null,
  phone         text,
  avatar_url    text,
  locale        text not null default 'th-TH',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_touch before update on app.profiles for each row execute function app.touch_row();

-- Global catalog. Keys are defined in code (packages/domain/src/permissions.ts)
-- and synced here; tenants compose them into roles.
create table app.permissions (
  key             text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module          text not null,
  name_th         text not null,
  name_en         text not null,
  risk            text not null default 'low' check (risk in ('low','medium','high')),
  sort            int not null default 0
);

create table app.roles (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references app.tenants(id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         text not null,
  description  text,
  -- Owners implicitly hold every permission, including ones added in future releases.
  grants_all   boolean not null default false,
  is_system    boolean not null default false,
  -- Where the person lands after login (task-based home, not a table list).
  home         text not null default 'today' check (home in ('today','pos','kds','inventory','finance','reports')),
  color        text,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);
create trigger roles_touch before update on app.roles for each row execute function app.touch_row();

create table app.role_permissions (
  tenant_id       uuid not null,
  role_id         uuid not null,
  permission_key  text not null references app.permissions(key) on update cascade on delete cascade,
  primary key (role_id, permission_key),
  foreign key (tenant_id, role_id) references app.roles(tenant_id, id) on delete cascade
);
create index role_permissions_tenant on app.role_permissions (tenant_id);

create table app.memberships (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references app.tenants(id) on delete cascade,
  -- NULL for PIN-only staff (no e-mail/phone login) — very common for part-timers.
  user_id         uuid,
  display_name    text not null check (length(trim(display_name)) between 1 and 80),
  nickname        text,
  invite_contact  text,
  role_id         uuid not null,
  all_branches    boolean not null default true,
  status          text not null default 'active' check (status in ('invited','active','suspended','removed')),
  -- bcrypt hash of a 4–6 digit PIN used to switch user on a shared POS/KDS device.
  pin_hash        text,
  -- Per-person limits for sensitive actions (e.g. max discount % without approval).
  limits          jsonb not null default '{}'::jsonb,
  invited_by      uuid,
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, role_id) references app.roles(tenant_id, id)
);
create unique index memberships_user_per_tenant on app.memberships (tenant_id, user_id) where user_id is not null;
create index memberships_user on app.memberships (user_id) where status = 'active';
create trigger memberships_touch before update on app.memberships for each row execute function app.touch_row();

create table app.membership_branches (
  tenant_id      uuid not null,
  membership_id  uuid not null,
  branch_id      uuid not null,
  primary key (membership_id, branch_id),
  foreign key (tenant_id, membership_id) references app.memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id) on delete cascade
);
create index membership_branches_branch on app.membership_branches (branch_id);

create table app.devices (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null,
  branch_id     uuid not null,
  name          text not null,
  kind          text not null check (kind in ('pos','kds','kiosk','printer_hub')),
  station_id    uuid,
  app_version   text,
  last_seen_at  timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id)
);
create index devices_branch on app.devices (branch_id);
create trigger devices_touch before update on app.devices for each row execute function app.touch_row();

-- =============================================================================
-- Authorization helpers (used by RLS policies and by SECURITY DEFINER commands)
--
-- Performance: policies call these wrapped in `(select ...)` so Postgres evaluates
-- them once per statement (initPlan) instead of once per row.
-- =============================================================================

create or replace function app.jwt_claim(p_claim text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> p_claim, '')
$$;

-- Memberships of the current actor (auth user and/or PIN-switched staff).
create or replace function app.actor_memberships()
returns setof app.memberships
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from app.memberships m
  where m.status = 'active'
    and (
      (m.user_id is not null and m.user_id = app.current_user_id())
      or m.id = app.jwt_claim('mid')::uuid
    )
$$;

create or replace function app.user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id from app.actor_memberships() m
$$;

create or replace function app.tenants_with_permission(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from app.actor_memberships() m
  join app.roles r on r.id = m.role_id
  where r.grants_all
     or exists (
       select 1 from app.role_permissions rp
       where rp.role_id = r.id and rp.permission_key = p_permission
     )
$$;

create or replace function app.user_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from app.actor_memberships() m
  join app.branches b on b.tenant_id = m.tenant_id
  where m.all_branches
     or exists (
       select 1 from app.membership_branches mb
       where mb.membership_id = m.id and mb.branch_id = b.id
     )
$$;

create or replace function app.has_permission(p_tenant uuid, p_permission text, p_branch uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant in (select app.tenants_with_permission(p_permission))
     and (p_branch is null or p_branch in (select app.user_branch_ids()))
$$;

-- For commands: fail loudly with a code the API turns into a human message.
create or replace function app.assert_permission(p_tenant uuid, p_permission text, p_branch uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_tenant, p_permission, p_branch) then
    perform app.raise_error('PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end;
$$;

-- The acting membership inside a given tenant (stored in *_by columns).
create or replace function app.actor_membership_id(p_tenant uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from app.actor_memberships() m where m.tenant_id = p_tenant
  order by (m.id = app.jwt_claim('mid')::uuid) desc nulls last
  limit 1
$$;

-- =============================================================================
-- Standard RLS policy generator — keeps 60+ tables consistent.
--   read_perm   NULL → any active member of the tenant may read
--   write_perm  NULL → no direct writes; changes only via SECURITY DEFINER commands
--   branch_col  set  → rows are also limited to branches the actor can access
-- =============================================================================
create or replace procedure app.apply_tenant_rls(
  p_table regclass,
  p_read_perm text default null,
  p_write_perm text default null,
  p_branch_col text default null
)
language plpgsql
set search_path = ''
as $$
declare
  read_expr  text;
  write_expr text;
  branch_expr text := '';
begin
  perform set_config('client_min_messages', 'warning', true);
  execute format('alter table %s enable row level security', p_table);

  if p_branch_col is not null then
    branch_expr := format(' and (%I is null or %I in (select app.user_branch_ids()))', p_branch_col, p_branch_col);
  end if;

  if p_read_perm is null then
    read_expr := 'tenant_id in (select app.user_tenant_ids())' || branch_expr;
  else
    read_expr := format('tenant_id in (select app.tenants_with_permission(%L))', p_read_perm) || branch_expr;
  end if;

  execute format('drop policy if exists tenant_read on %s', p_table);
  execute format('create policy tenant_read on %s for select to authenticated using (%s)', p_table, read_expr);

  if p_write_perm is not null then
    write_expr := format('tenant_id in (select app.tenants_with_permission(%L))', p_write_perm) || branch_expr;
    execute format('drop policy if exists tenant_insert on %s', p_table);
    execute format('create policy tenant_insert on %s for insert to authenticated with check (%s)', p_table, write_expr);
    execute format('drop policy if exists tenant_update on %s', p_table);
    execute format('create policy tenant_update on %s for update to authenticated using (%s) with check (%s)', p_table, write_expr, write_expr);
    execute format('drop policy if exists tenant_delete on %s', p_table);
    execute format('create policy tenant_delete on %s for delete to authenticated using (%s)', p_table, write_expr);
    execute format('grant select, insert, update, delete on %s to authenticated', p_table);
  else
    execute format('grant select on %s to authenticated', p_table);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS for identity tables
-- ---------------------------------------------------------------------------
alter table app.tenants enable row level security;
create policy tenant_read on app.tenants for select to authenticated
  using (id in (select app.user_tenant_ids()));
create policy tenant_update on app.tenants for update to authenticated
  using (id in (select app.tenants_with_permission('settings.manage')))
  with check (id in (select app.tenants_with_permission('settings.manage')));
grant select, update on app.tenants to authenticated;

alter table app.profiles enable row level security;
create policy own_profile on app.profiles for all to authenticated
  using (id = (select app.current_user_id()))
  with check (id = (select app.current_user_id()));
-- Colleagues can see each other's display name/avatar.
create policy colleague_profiles on app.profiles for select to authenticated
  using (id in (select m.user_id from app.memberships m where m.tenant_id in (select app.user_tenant_ids())));
grant select, insert, update on app.profiles to authenticated;

alter table app.permissions enable row level security;
create policy catalog_read on app.permissions for select to authenticated using (true);
grant select on app.permissions to authenticated;

call app.apply_tenant_rls('app.brands', null, 'settings.manage');
call app.apply_tenant_rls('app.branches', null, 'settings.manage');
call app.apply_tenant_rls('app.roles', null, 'staff.manage');
call app.apply_tenant_rls('app.role_permissions', null, 'staff.manage');
call app.apply_tenant_rls('app.memberships', null, 'staff.manage');
call app.apply_tenant_rls('app.membership_branches', null, 'staff.manage');
call app.apply_tenant_rls('app.devices', null, 'settings.manage', 'branch_id');

-- PIN hashes are never readable or writable through the table surface;
-- they change only via app.set_member_pin() (column grants exclude pin_hash).
revoke select, insert, update on app.memberships from authenticated;
grant select (id, tenant_id, user_id, display_name, nickname, invite_contact, role_id, all_branches,
              status, limits, invited_by, joined_at, created_at, updated_at)
  on app.memberships to authenticated;
grant insert (id, tenant_id, user_id, display_name, nickname, invite_contact, role_id, all_branches,
              status, limits, invited_by)
  on app.memberships to authenticated;
grant update (display_name, nickname, invite_contact, role_id, all_branches, status, limits)
  on app.memberships to authenticated;

-- Branch visibility is additionally scoped: staff limited to some branches only see those.
drop policy tenant_read on app.branches;
create policy tenant_read on app.branches for select to authenticated
  using (tenant_id in (select app.user_tenant_ids()) and id in (select app.user_branch_ids()));

grant usage on schema app to authenticated;
