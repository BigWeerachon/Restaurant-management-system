-- =============================================================================
-- Sabai — V1.1: every event says who did it.
-- Most commands passed their actor to app.emit_event, but shift open/close, waste,
-- counts, order opening, availability and the like did not, so the owner's activity
-- feed named "the system" for things a person did. The person is whoever the
-- request is signed in as; work done with no signed-in person (a trigger, a job)
-- still has no actor.
-- =============================================================================
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
  values (p_tenant, p_branch, p_aggregate_type, p_aggregate_id, p_event_type, coalesce(p_payload, '{}'::jsonb),
          coalesce(p_actor, app.actor_membership_id(p_tenant)), app.current_request_id())
  returning id
$$;
