-- =============================================================================
-- Sabai — API support: idempotency store and realtime fan-out.
-- =============================================================================

-- Idempotency-Key replay store (infrastructure; written by the API's service
-- connection, never exposed to app users). Keys expire after 24 h.
create table app.api_idempotency (
  tenant_id     uuid not null,
  key           text not null check (length(key) between 8 and 128),
  method        text not null,
  path          text not null,
  request_hash  text not null,
  status        int not null,
  response      jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, key)
);
create index api_idempotency_created on app.api_idempotency (created_at);
alter table app.api_idempotency enable row level security;
revoke all on app.api_idempotency from authenticated;

-- Realtime: every domain event pings listeners (API SSE hubs, workers).
-- The payload carries ids only; clients re-fetch through RLS-protected reads.
create or replace function app.notify_domain_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify('sabai_events', json_build_object(
    'id', new.id, 'tenant_id', new.tenant_id, 'branch_id', new.branch_id,
    'type', new.event_type, 'aggregate_id', new.aggregate_id)::text);
  return null;
end;
$$;
create trigger domain_events_notify after insert on app.domain_events
  for each row execute function app.notify_domain_event();
revoke execute on function app.notify_domain_event() from authenticated;
