-- =============================================================================
-- Registered till devices (V1.1, 6.3)
--
-- Staff on a shared till sign in with a PIN and no e-mail. What lets a device ask "who is here?" without any
-- account is a secret the owner hands it when registering it in Settings. The secret is shown once; only its
-- SHA-256 lives here, in a table no app user can read. Revoking the device deletes the hash, so a lost tablet
-- stops working the moment the owner says so.
--
--   app.register_device / app.revoke_device   — called as the signed-in owner/manager (settings.manage)
--   app.device_roster / app.device_pin_login   — called by the API on behalf of a device (no user): the only way
--                                                in, and they return nothing beyond what the PIN screen shows
-- =============================================================================

alter table app.devices
  add column registered_by uuid,
  add column registered_at timestamptz,
  add column revoked_at    timestamptz,
  add foreign key (tenant_id, registered_by) references app.memberships (tenant_id, id);

create table app.device_credentials (
  tenant_id   uuid not null,
  device_id   uuid primary key,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, device_id) references app.devices (tenant_id, id) on delete cascade
);
-- Row security on with no policy: nobody signed in can read or write it. Only the functions below touch it.
alter table app.device_credentials enable row level security;
revoke all on app.device_credentials from authenticated;

-- p_token_hash: SHA-256 (hex) of a secret the API just generated; the secret itself never reaches the database.
create or replace function app.register_device(p_branch uuid, p_name text, p_kind text, p_token_hash text, p_station uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid;
  d uuid;
  mem uuid;
begin
  select tenant_id into t from app.branches where id = p_branch and archived_at is null;
  if t is null then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(t, 'settings.manage', p_branch);
  if coalesce(trim(p_name), '') = '' then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'name')); end if;
  if p_kind is null or p_kind not in ('pos', 'kds', 'kiosk', 'printer_hub') then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'kind')); end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'token')); end if;
  mem := app.actor_membership_id(t);

  -- The plan's device limit is enforced by the devices_plan_limit trigger on this insert.
  insert into app.devices (tenant_id, branch_id, name, kind, station_id, registered_by, registered_at)
  values (t, p_branch, trim(p_name), p_kind, p_station, mem, now())
  returning id into d;
  insert into app.device_credentials (tenant_id, device_id, token_hash) values (t, d, p_token_hash);
  perform app.emit_event(t, p_branch, 'device', d, 'device.registered', jsonb_build_object('name', trim(p_name), 'kind', p_kind), mem);
  return d;
end;
$$;

create or replace function app.revoke_device(p_device uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d app.devices;
begin
  select * into d from app.devices where id = p_device;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(d.tenant_id, 'settings.manage', d.branch_id);
  if d.revoked_at is not null then return; end if; -- already done: a second press changes nothing and adds nothing to the feed
  update app.devices set is_active = false, revoked_at = coalesce(revoked_at, now()) where id = p_device;
  delete from app.device_credentials where device_id = p_device;
  perform app.emit_event(d.tenant_id, d.branch_id, 'device', d.id, 'device.revoked', jsonb_build_object('name', d.name), app.actor_membership_id(d.tenant_id));
end;
$$;

-- What a registered device may see before anyone has signed in on it: which shop and branch it belongs to, and the
-- names and roles of the people who can sign in here (those with a PIN and access to this branch) — the PIN screen.
-- Null when the secret is not (or no longer) a registered device's.
create or replace function app.device_roster(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d app.devices;
  br app.branches;
  t app.tenants;
begin
  select dv.* into d
    from app.devices dv join app.device_credentials c on c.device_id = dv.id
   where c.token_hash = p_token_hash and dv.is_active and dv.revoked_at is null;
  if not found then return null; end if;
  update app.devices set last_seen_at = now() where id = d.id;
  select * into br from app.branches where id = d.branch_id;
  select * into t from app.tenants where id = d.tenant_id;
  return jsonb_build_object(
    'device', jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind),
    'tenant', jsonb_build_object('id', t.id, 'name', t.name),
    'branch', jsonb_build_object('id', br.id, 'name', br.name),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'display_name', m.display_name, 'nickname', m.nickname,
                                          'role_key', r.key, 'role_name', r.name, 'color', r.color)
                       order by r.sort, m.display_name)
        from app.memberships m join app.roles r on r.id = m.role_id
       where m.tenant_id = d.tenant_id and m.status = 'active' and m.pin_hash is not null
         and (m.all_branches or exists (select 1 from app.membership_branches mb where mb.membership_id = m.id and mb.branch_id = d.branch_id))
    ), '[]'::jsonb));
end;
$$;

-- A PIN entered on a registered device. {"device": false} = the device is unknown or revoked;
-- {"device": true, "membership_id": null} = wrong PIN; otherwise who signed in.
create or replace function app.device_pin_login(p_token_hash text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d app.devices;
  mem uuid;
  m record;
begin
  select dv.* into d
    from app.devices dv join app.device_credentials c on c.device_id = dv.id
   where c.token_hash = p_token_hash and dv.is_active and dv.revoked_at is null;
  if not found then return jsonb_build_object('device', false); end if;
  update app.devices set last_seen_at = now() where id = d.id;
  mem := app.verify_pin(d.tenant_id, d.branch_id, p_pin);
  if mem is null then return jsonb_build_object('device', true, 'membership_id', null); end if;
  select m2.display_name, r.key as role_key, r.home into m
    from app.memberships m2 join app.roles r on r.id = m2.role_id where m2.id = mem;
  return jsonb_build_object('device', true, 'membership_id', mem, 'display_name', m.display_name, 'role_key', m.role_key,
                            'home', m.home, 'tenant_id', d.tenant_id, 'branch_id', d.branch_id, 'device_id', d.id);
end;
$$;

grant execute on function app.register_device(uuid, text, text, text, uuid), app.revoke_device(uuid) to authenticated;
revoke execute on function app.device_roster(text), app.device_pin_login(text, text) from authenticated, public;
