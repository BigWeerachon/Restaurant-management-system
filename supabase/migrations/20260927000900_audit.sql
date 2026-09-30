-- =============================================================================
-- Sabai — Audit trail
--
-- Two complementary records:
--   audit.log          row-level "who changed which field from what to what"
--                      on configuration & money-sensitive master data
--   app.domain_events  business-level "what happened" (void, discount, refund,
--                      count approved…) with reason and approver — this is what
--                      the owner reads as the activity feed.
-- Both are append-only.
-- =============================================================================

create table audit.log (
  id            bigint generated always as identity primary key,
  tenant_id     uuid,
  table_name    text not null,
  record_id     uuid,
  action        text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_id      uuid,
  auth_user_id  uuid,
  changes       jsonb,
  row_data      jsonb,
  request_id    text,
  at            timestamptz not null default now()
);
create index audit_log_tenant_time on audit.log (tenant_id, at desc);
create index audit_log_record on audit.log (record_id);

create or replace function audit.capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  t uuid;
  diff jsonb;
begin
  t := coalesce((n->>'tenant_id')::uuid, (o->>'tenant_id')::uuid,
                case when tg_table_name = 'tenants' then coalesce((n->>'id')::uuid, (o->>'id')::uuid) end);
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(o->k, n->k)) into diff
      from jsonb_object_keys(n) k
     where k not in ('updated_at','version') and (o->k) is distinct from (n->k);
    if diff is null then return null; end if;
  end if;
  insert into audit.log (tenant_id, table_name, record_id, action, actor_id, auth_user_id, changes, row_data, request_id)
  values (t, tg_table_name, coalesce((n->>'id')::uuid, (o->>'id')::uuid), tg_op,
          case when t is not null then app.actor_membership_id(t) end, app.current_user_id(),
          diff, case when tg_op = 'UPDATE' then null else coalesce(n, o) end - 'pin_hash',
          app.current_request_id());
  return null;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'tenants','branches','roles','role_permissions','memberships','membership_branches','devices',
    'sales_channels','channel_commission_rates','payment_methods',
    'menu_items','menu_item_prices','modifier_options',
    'ingredients','recipes','recipe_lines','suppliers',
    'purchase_orders','day_closes','accounts','bills','subscriptions','approvals']
  loop
    execute format('create trigger audit_capture after insert or update or delete on app.%I
                    for each row execute function audit.capture()', tbl);
  end loop;
end
$$;

create trigger audit_log_immutable before update or delete on audit.log
  for each row execute function app.forbid_mutation();

alter table audit.log enable row level security;
create policy tenant_read on audit.log for select to authenticated
  using (tenant_id in (select app.tenants_with_permission('audit.view')));
grant usage on schema audit to authenticated;
grant select on audit.log to authenticated;

-- Business activity feed (human-readable timeline for owners/managers).
call app.apply_tenant_rls('app.domain_events', 'audit.view', null, 'branch_id');
