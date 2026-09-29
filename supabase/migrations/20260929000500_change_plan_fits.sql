-- =============================================================================
-- Sabai — V1.1: a plan can only be chosen if the shop fits in it.
-- The screen has always refused to drop to a plan with fewer branches or staff
-- than the shop already has ("PLAN_LIMIT_REACHED"), and asked for the billing
-- right to change plans at all; the database checked neither. Growth is guarded
-- by app.enforce_plan_limits when adding; this is the same guard when shrinking.
-- =============================================================================
create or replace function app.change_plan(p_tenant uuid, p_plan_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl app.plans;
  v_branches int;
  v_staff int;
begin
  perform app.assert_permission(p_tenant, 'billing.manage');
  select * into pl from app.plans where code = p_plan_code;
  if not found then
    perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'plan'));
  end if;

  select count(*) into v_branches from app.branches where tenant_id = p_tenant and archived_at is null;
  select count(*) into v_staff from app.memberships where tenant_id = p_tenant and status in ('active', 'invited');
  if (pl.limits ->> 'branches') is not null and v_branches > (pl.limits ->> 'branches')::int then
    perform app.raise_error('PLAN_LIMIT_REACHED', jsonb_build_object('metric', 'branches', 'limit', (pl.limits ->> 'branches')::int));
  end if;
  if (pl.limits ->> 'staff') is not null and v_staff > (pl.limits ->> 'staff')::int then
    perform app.raise_error('PLAN_LIMIT_REACHED', jsonb_build_object('metric', 'staff', 'limit', (pl.limits ->> 'staff')::int));
  end if;

  update app.subscriptions set plan_code = p_plan_code where tenant_id = p_tenant;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'subscription')); end if;
  perform app.emit_event(p_tenant, null, 'subscription', p_tenant, 'subscription.plan_changed',
    jsonb_build_object('plan_code', p_plan_code), app.actor_membership_id(p_tenant));
end;
$$;
