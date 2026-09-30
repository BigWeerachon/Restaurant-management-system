-- =============================================================================
-- Sabai — V1.1: settings commands that need privileges beyond a table grant.
-- =============================================================================

-- app.subscriptions only grants SELECT to `authenticated` (see saas_billing.sql) —
-- plan changes go through billing once that lands (docs/07-roadmap.md, phase 8),
-- so a real "buy this plan" flow can add proration/invoicing without a table
-- grant already letting anyone with settings.manage write straight to it.
-- For now, changing plan_code directly is the whole feature: no payment is
-- collected yet, matching "billing problems never stop a restaurant from
-- selling" — the reverse holds too, plan changes never wait on billing.
create or replace function app.change_plan(p_tenant uuid, p_plan_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_permission(p_tenant, 'settings.manage');
  if not exists (select 1 from app.plans where code = p_plan_code) then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'plan'));
  end if;
  update app.subscriptions set plan_code = p_plan_code where tenant_id = p_tenant;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'subscription')); end if;
  perform app.emit_event(p_tenant, null, 'subscription', p_tenant, 'subscription.plan_changed',
    jsonb_build_object('plan_code', p_plan_code), app.actor_membership_id(p_tenant));
end;
$$;
