-- =============================================================================
-- Sabai — SaaS plans, subscriptions, entitlements & usage
--
-- Rule that never bends: billing problems NEVER stop a restaurant from selling.
-- past_due keeps every feature (with a banner); after the grace period the back
-- office becomes read-only but POS/KDS keep working. See docs/07-roadmap.md.
-- =============================================================================

create table app.plans (
  code           text primary key check (code ~ '^[a-z_]+$'),
  name           text not null,
  name_en        text not null,
  price_monthly  numeric(10,2),
  price_yearly   numeric(10,2),
  currency       text not null default 'THB',
  -- NULL limit = unlimited
  limits         jsonb not null default '{}'::jsonb,
  features       text[] not null default '{}',
  is_public      boolean not null default true,
  sort           int not null default 0
);

insert into app.plans (code, name, name_en, price_monthly, price_yearly, limits, features, sort) values
  ('free', 'เริ่มต้นฟรี', 'Free', 0, 0,
   '{"branches":1,"staff":3,"devices":1}',
   '{pos,kds,inventory_basic,reports_basic}', 1),
  ('starter', 'สตาร์ทเตอร์', 'Starter', 590, 5900,
   '{"branches":1,"staff":10,"devices":3}',
   '{pos,kds,inventory_basic,inventory,recipes,reports_basic}', 2),
  ('pro', 'โปร', 'Pro', 1490, 14900,
   '{"branches":3,"staff":30,"devices":10}',
   '{pos,kds,inventory_basic,inventory,recipes,purchasing,finance,reconciliation,reports_basic,reports_profit,multi_branch}', 3),
  ('business', 'บิสิเนส', 'Business', 3490, 34900,
   '{"branches":10,"staff":150,"devices":40}',
   '{pos,kds,inventory_basic,inventory,recipes,purchasing,finance,reconciliation,reports_basic,reports_profit,multi_branch,central_kitchen,analytics_advanced,api_access}', 4),
  ('enterprise', 'เอนเตอร์ไพรส์', 'Enterprise', null, null,
   '{"branches":null,"staff":null,"devices":null}',
   '{pos,kds,inventory_basic,inventory,recipes,purchasing,finance,reconciliation,reports_basic,reports_profit,multi_branch,central_kitchen,analytics_advanced,api_access,ai_copilot,sso}', 5);

create table app.subscriptions (
  tenant_id                  uuid primary key references app.tenants(id) on delete cascade,
  plan_code                  text not null references app.plans(code),
  status                     text not null default 'trialing' check (status in ('trialing','active','past_due','restricted','canceled')),
  billing_cycle              text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  trial_ends_at              timestamptz,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  provider                   text check (provider in ('omise','stripe','manual')),
  provider_customer_id       text,
  provider_subscription_id   text,
  addons                     jsonb not null default '{}'::jsonb,
  updated_at                 timestamptz not null default now()
);
create trigger subscriptions_touch before update on app.subscriptions for each row execute function app.touch_row();

create table app.subscription_invoices (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null references app.tenants(id) on delete cascade,
  invoice_no           text not null unique,
  period_start         date not null,
  period_end           date not null,
  subtotal             numeric(12,2) not null,
  vat_amount           numeric(12,2) not null default 0,
  total                numeric(12,2) not null,
  status               text not null default 'open' check (status in ('draft','open','paid','void','uncollectible')),
  provider_invoice_id  text,
  paid_at              timestamptz,
  pdf_url              text,
  created_at           timestamptz not null default now()
);
create index subscription_invoices_tenant on app.subscription_invoices (tenant_id, period_start desc);

create table app.usage_counters (
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  metric     text not null,
  period     text not null,
  value      bigint not null default 0,
  primary key (tenant_id, metric, period)
);

-- Effective plan: canceled subscriptions fall back to the free plan's entitlements.
create or replace function app.effective_plan(p_tenant uuid)
returns app.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from app.plans p
  where p.code = coalesce(
    (select case when s.status = 'canceled' then 'free' else s.plan_code end
       from app.subscriptions s where s.tenant_id = p_tenant),
    'free')
$$;

create or replace function app.has_feature(p_tenant uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_feature = any((app.effective_plan(p_tenant)).features)
      or coalesce(((select s.addons from app.subscriptions s where s.tenant_id = p_tenant) -> 'features') ? p_feature, false)
$$;

create or replace function app.plan_limit(p_tenant uuid, p_metric text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    ((select s.addons from app.subscriptions s where s.tenant_id = p_tenant) -> 'limits' ->> p_metric)::int,
    ((app.effective_plan(p_tenant)).limits ->> p_metric)::int)
$$;

-- Guard rails on growth: a friendly "อัปเกรดแพ็กเกจ" instead of a hard failure later.
create or replace function app.enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim int;
  used int;
  metric text;
begin
  metric := case tg_table_name when 'branches' then 'branches' when 'memberships' then 'staff' when 'devices' then 'devices' end;
  lim := app.plan_limit(new.tenant_id, metric);
  if lim is null then return new; end if;
  execute format('select count(*) from app.%I where tenant_id = $1 %s', tg_table_name,
                 case tg_table_name
                   when 'branches' then 'and archived_at is null'
                   when 'memberships' then 'and status in (''active'',''invited'')'
                   else 'and is_active' end)
    into used using new.tenant_id;
  if used >= lim then
    perform app.raise_error('PLAN_LIMIT_REACHED', jsonb_build_object('metric', metric, 'limit', lim));
  end if;
  return new;
end;
$$;
create trigger branches_plan_limit before insert on app.branches for each row execute function app.enforce_plan_limits();
create trigger memberships_plan_limit before insert on app.memberships for each row execute function app.enforce_plan_limits();
create trigger devices_plan_limit before insert on app.devices for each row execute function app.enforce_plan_limits();

alter table app.plans enable row level security;
create policy catalog_read on app.plans for select to authenticated using (is_public);
grant select on app.plans to authenticated;

call app.apply_tenant_rls('app.subscriptions', null);
call app.apply_tenant_rls('app.subscription_invoices', 'billing.manage');
call app.apply_tenant_rls('app.usage_counters', 'billing.manage');
