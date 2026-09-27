-- =============================================================================
-- Sabai — Foundation
-- Schemas, extensions, ID generation, shared trigger functions.
--
-- Conventions (see docs/05-database.md):
--   * Every business table lives in schema `app` (not exposed via PostgREST by default).
--   * Every tenant-owned row carries `tenant_id`; children reference parents with a
--     composite FK (tenant_id, parent_id) so a row can never point across tenants.
--     This is also the co-location rule required to shard by tenant later (Citus).
--   * Primary keys are UUIDv7 (time-ordered → index locality; clients can generate them
--     offline, which gives POS natural idempotency).
--   * Status/kind columns are `text` + CHECK (evolvable), not Postgres enums.
--   * Ledgers (stock, journal, audit) are append-only; corrections are new rows.
--   * Money: numeric(14,2). Quantities in base unit: numeric(18,4). Unit cost: numeric(18,6).
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
create schema if not exists audit;

comment on schema app is 'Sabai business domain (multi-tenant, RLS-protected)';
comment on schema audit is 'Append-only audit trail';

-- -----------------------------------------------------------------------------
-- UUIDv7 (RFC 9562). Postgres 18 ships uuidv7(); this keeps us portable to 15+.
-- -----------------------------------------------------------------------------
create or replace function app.uuid_v7()
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  ts_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  bytes bytea;
begin
  bytes := substring(int8send(ts_ms) from 3) || extensions.gen_random_bytes(10);
  -- version 7
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  -- RFC 4122 variant
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  return encode(bytes, 'hex')::uuid;
end;
$$;

-- -----------------------------------------------------------------------------
-- Shared triggers
-- -----------------------------------------------------------------------------

-- Maintains updated_at on mutable master data.
create or replace function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Same, plus an optimistic-concurrency counter. Clients send the version they
-- edited (If-Match); the API rejects stale writes with a friendly
-- "มีคนแก้ไขรายการนี้ไปก่อนแล้ว" instead of silently overwriting.
create or replace function app.touch_versioned_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- Ledgers never change. Corrections are posted as new, reversing rows.
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LEDGER_IMMUTABLE'
    using errcode = 'P0001',
          detail = format('%s rows are append-only; post a correcting entry instead', tg_table_name);
end;
$$;

-- Current actor from the JWT (Supabase-compatible). NULL for system jobs.
create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

-- Correlates DB writes with API logs ("รหัสอ้างอิง" shown to staff on errors).
create or replace function app.current_request_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.request_id', true), '')
$$;

-- Raise a domain error that the API maps to a human message (docs/06-api.md).
create or replace function app.raise_error(p_code text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = p_detail::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- Transactional outbox. Commands append domain events in the same transaction
-- as the state change; a worker publishes them (realtime KDS, analytics rollups,
-- notifications, webhooks). This is the seam for extracting services later.
-- -----------------------------------------------------------------------------
create table app.domain_events (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  branch_id       uuid,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  event_type      text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  payload         jsonb not null default '{}'::jsonb,
  actor_id        uuid,
  request_id      text,
  occurred_at     timestamptz not null default now(),
  published_at    timestamptz
);
create index domain_events_unpublished on app.domain_events (occurred_at) where published_at is null;
create index domain_events_tenant_time on app.domain_events (tenant_id, occurred_at desc);
create index domain_events_aggregate on app.domain_events (aggregate_id);

create or replace function app.emit_event(
  p_tenant uuid,
  p_branch uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_actor uuid default null
)
returns uuid
language sql
volatile
set search_path = ''
as $$
  insert into app.domain_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload, actor_id, request_id)
  values (p_tenant, p_branch, p_aggregate_type, p_aggregate_id, p_event_type, coalesce(p_payload, '{}'::jsonb), p_actor, app.current_request_id())
  returning id
$$;
