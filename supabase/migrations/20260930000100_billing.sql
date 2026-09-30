-- =============================================================================
-- Sabai — SaaS billing that never stops a sale (V1.1, 8.1)
--
--   subscriptions   + past_due_since, grace_days              — the dunning clock
--   invoices        + plan, cycle, kind, due date             — one open invoice per shop at a time
--   billing_events  one row per provider event (idempotency)  — a webhook may arrive twice, or out of order
--
--   app.billing_stage(tenant, now)      trial | ok | past_due | restricted | canceled — derived from time, so it is right
--                                       even if the nightly job has not run (same rule as billingStage in @sabai/domain)
--   app.issue_subscription_invoice(...) the invoice for a renewal or a plan change (internal)
--   app.request_plan_change(...)        downgrades apply at once; upgrades become an invoice to pay first
--   app.apply_billing_event(...)        what a provider's "paid" / "payment failed" / "canceled" does (internal)
--   app.billing_run(now)                the nightly job: renewals, overdue, grace over, trial over (internal)
--
-- The rule that never bends: billing NEVER stops a shop from selling. An overdue bill first shows a banner (grace
-- period, nothing taken away); after the grace period it stops the shop from adding branches, staff and tills — and
-- nothing else. Paying at any point puts everything back.
-- =============================================================================

alter table app.subscriptions
  add column past_due_since timestamptz,
  add column grace_days     int not null default 14 check (grace_days between 0 and 90);

alter table app.subscription_invoices
  add column plan_code     text references app.plans(code),
  add column billing_cycle text check (billing_cycle in ('monthly', 'yearly')),
  -- A renewal is what the schedule asks for; a plan change is what the shop asked for. Only a missed renewal is a debt.
  add column kind          text not null default 'renewal' check (kind in ('renewal', 'plan_change')),
  add column due_at        timestamptz,
  add column provider      text,
  add column voided_at     timestamptz;

-- One invoice waiting to be paid per shop: a new one (another plan, the next period) replaces the old.
create unique index subscription_invoices_one_open on app.subscription_invoices (tenant_id) where status = 'open';

-- Each event a payment provider sends is recorded once. Nobody signed in can read or write it.
create table app.billing_events (
  provider     text not null,
  event_id     text not null,
  type         text not null,
  tenant_id    uuid references app.tenants(id) on delete set null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  outcome      text,
  primary key (provider, event_id)
);
alter table app.billing_events enable row level security;
revoke all on app.billing_events from authenticated;

-- Invoice numbers are the company's own (INV-2610-00001), one run for all shops, by Bangkok month.
create table app.billing_sequences (
  period     text primary key,
  last_value bigint not null default 0
);
alter table app.billing_sequences enable row level security;
revoke all on app.billing_sequences from authenticated;

-- -----------------------------------------------------------------------------
-- Where a shop stands. Same rule as billingStage in @sabai/domain.
-- -----------------------------------------------------------------------------
create or replace function app.billing_stage(p_tenant uuid, p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case s.status
      when 'canceled'   then 'canceled'
      when 'restricted' then 'restricted'
      when 'past_due'   then case when s.past_due_since is not null and p_now >= s.past_due_since + make_interval(days => s.grace_days)
                                  then 'restricted' else 'past_due' end
      when 'trialing'   then case when s.trial_ends_at is not null and s.trial_ends_at <= p_now then 'canceled' else 'trial' end
      else 'ok'
    end
    from app.subscriptions s where s.tenant_id = p_tenant), 'ok')
$$;

-- A trial that has run out is over, and the shop carries on with the free plan, owing nothing.
create or replace function app.effective_plan(p_tenant uuid)
returns app.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from app.plans p
  where p.code = coalesce(
    (select case when app.billing_stage(p_tenant) = 'canceled' then 'free' else s.plan_code end
       from app.subscriptions s where s.tenant_id = p_tenant),
    'free')
$$;

-- Growth is what an overdue bill takes away, and only after the grace period.
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
  if app.billing_stage(new.tenant_id) = 'restricted' then
    perform app.raise_error('BILLING_RESTRICTED', jsonb_build_object('metric', metric));
  end if;
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

-- -----------------------------------------------------------------------------
-- Invoices
-- -----------------------------------------------------------------------------
create or replace function app.next_invoice_no(p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(p_at at time zone 'Asia/Bangkok', 'YYMM');
  n bigint;
begin
  insert into app.billing_sequences as s (period, last_value) values (v_period, 1)
  on conflict (period) do update set last_value = s.last_value + 1
  returning last_value into n;
  return 'INV-' || v_period || '-' || lpad(n::text, 5, '0');
end;
$$;

-- Prices include VAT, as the price list shows them: the invoice splits it out (7/107, like a receipt does).
create or replace function app.issue_subscription_invoice(
  p_tenant uuid, p_plan text, p_cycle text, p_start date, p_kind text default 'renewal',
  p_due timestamptz default null, p_at timestamptz default now()
)
returns app.subscription_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl app.plans;
  v_price numeric;
  v_vat numeric;
  v_end date;
  inv app.subscription_invoices;
begin
  perform 1 from app.subscriptions where tenant_id = p_tenant for update;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'subscription')); end if;
  select * into pl from app.plans where code = p_plan;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'plan')); end if;
  if p_cycle not in ('monthly', 'yearly') then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'billingCycle')); end if;
  v_price := case p_cycle when 'yearly' then pl.price_yearly else pl.price_monthly end;
  if v_price is null or v_price <= 0 then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'planCode')); end if;

  v_end := (p_start + case p_cycle when 'yearly' then interval '1 year' else interval '1 month' end - interval '1 day')::date;
  v_vat := round(v_price * 7 / 107, 2);

  -- Only one invoice waits to be paid: this one replaces it.
  update app.subscription_invoices set status = 'void', voided_at = p_at where tenant_id = p_tenant and status = 'open';

  insert into app.subscription_invoices (tenant_id, invoice_no, period_start, period_end, subtotal, vat_amount, total, status,
                                         plan_code, billing_cycle, kind, due_at)
  values (p_tenant, app.next_invoice_no(p_at), p_start, v_end, v_price - v_vat, v_vat, v_price, 'open',
          p_plan, p_cycle, p_kind, coalesce(p_due, (p_start::timestamp at time zone 'Asia/Bangkok')))
  returning * into inv;

  perform app.emit_event(p_tenant, null, 'subscription', inv.id, 'subscription.invoice_issued',
    jsonb_build_object('invoice_no', inv.invoice_no, 'total', inv.total, 'kind', p_kind));
  return inv;
end;
$$;

-- A plan the shop already outgrew is refused before anyone is asked to pay for it.
create or replace function app.assert_plan_fits(p_tenant uuid, p_plan text)
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
  select * into pl from app.plans where code = p_plan;
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
end;
$$;

-- What a shop that asks for another plan gets.
--   * on a trial, or after leaving: any paid plan is an invoice to pay first — the plan starts when the payment arrives;
--   * the same plan with another billing cycle: nothing to pay now, it takes effect at the next renewal;
--   * a dearer plan (compared per month, so a yearly price is not "dearer" than a monthly one): an invoice;
--   * a cheaper one, or the free plan: applies now, if the shop fits it. The period already paid runs on; there are no refunds.
create or replace function app.request_plan_change(p_tenant uuid, p_plan text, p_cycle text default 'monthly')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app.subscriptions;
  cur app.plans;
  pl app.plans;
  v_current numeric;
  v_target numeric;
  inv app.subscription_invoices;
begin
  perform app.assert_permission(p_tenant, 'billing.manage');
  select * into s from app.subscriptions where tenant_id = p_tenant for update;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'subscription')); end if;
  select * into pl from app.plans where code = p_plan;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'plan')); end if;
  if p_cycle not in ('monthly', 'yearly') then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'billingCycle')); end if;

  -- Enterprise has no price on the list: that is a conversation, not a checkout.
  if pl.price_monthly is null then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'planCode')); end if;
  v_target := case p_cycle when 'yearly' then pl.price_yearly / 12 else pl.price_monthly end;

  select * into cur from app.plans where code = s.plan_code;
  -- What the shop pays now, per month: nothing during a trial or after it ended.
  v_current := case when s.status in ('trialing', 'canceled') then 0
                    else coalesce(case s.billing_cycle when 'yearly' then cur.price_yearly / 12 else cur.price_monthly end, 0) end;

  perform app.assert_plan_fits(p_tenant, p_plan);

  if v_target > 0 and (s.status in ('trialing', 'canceled') or (p_plan <> s.plan_code and v_target > v_current)) then
    inv := app.issue_subscription_invoice(p_tenant, p_plan, p_cycle, (now() at time zone 'Asia/Bangkok')::date, 'plan_change', now() + interval '3 days');
    return jsonb_build_object('applied', false, 'invoice_id', inv.id, 'invoice_no', inv.invoice_no, 'total', inv.total);
  end if;

  if p_plan <> s.plan_code then
    perform app.change_plan(p_tenant, p_plan);
  end if;
  -- Asking for what they have (or less) means they no longer want the dearer plan they had asked for.
  update app.subscription_invoices set status = 'void', voided_at = now() where tenant_id = p_tenant and status = 'open' and kind = 'plan_change';
  -- The cycle is what the next renewal is invoiced for.
  update app.subscriptions
     set billing_cycle = p_cycle,
         status = case when pl.price_monthly = 0 then 'active' else status end,
         past_due_since = case when pl.price_monthly = 0 then null else past_due_since end,
         cancel_at_period_end = case when p_plan <> s.plan_code then false else cancel_at_period_end end
   where tenant_id = p_tenant;
  return jsonb_build_object('applied', true);
end;
$$;


-- Until a payment provider is switched on, choosing a paid plan just applies it (see docs/v1.1-checklist.md, 8.1).
-- It must also leave the trial: a trial that has run out means "free plan", whatever plan was picked.
create or replace function app.change_plan(p_tenant uuid, p_plan_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl app.plans;
begin
  perform app.assert_permission(p_tenant, 'billing.manage');
  perform app.assert_plan_fits(p_tenant, p_plan_code);
  select * into pl from app.plans where code = p_plan_code;

  update app.subscriptions
     set plan_code = p_plan_code,
         status = case when coalesce(pl.price_monthly, 0) > 0 and status in ('trialing', 'canceled') then 'active' else status end
   where tenant_id = p_tenant;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'subscription')); end if;
  perform app.emit_event(p_tenant, null, 'subscription', p_tenant, 'subscription.plan_changed',
    jsonb_build_object('plan_code', p_plan_code), app.actor_membership_id(p_tenant));
end;
$$;

-- -----------------------------------------------------------------------------
-- What a payment provider tells us. Recorded once by (provider, event id); a repeat changes nothing.
-- p_data: invoice_no (ours, which the provider carries as its reference), amount, provider_invoice_id,
--         provider_customer_id, provider_subscription_id.
-- Returns what happened, in a word: paid | already_paid | past_due | noted | cancel_scheduled | duplicate |
--         unknown_invoice | amount_mismatch | needs_review | ignored
-- -----------------------------------------------------------------------------
create or replace function app.apply_billing_event(p_provider text, p_event_id text, p_type text, p_data jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv app.subscription_invoices;
  v_tenant uuid;
  v_outcome text := 'ignored';
  v_rows int;
begin
  insert into app.billing_events (provider, event_id, type, payload) values (p_provider, p_event_id, p_type, coalesce(p_data, '{}'::jsonb))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'duplicate'; end if;

  select * into inv from app.subscription_invoices where invoice_no = p_data ->> 'invoice_no' for update;
  v_tenant := inv.tenant_id;
  if v_tenant is null and p_data ->> 'provider_subscription_id' is not null then
    select tenant_id into v_tenant from app.subscriptions where provider_subscription_id = p_data ->> 'provider_subscription_id';
  end if;

  if p_type = 'invoice.paid' then
    if inv.id is null then
      v_outcome := 'unknown_invoice';
    elsif inv.status = 'paid' then
      v_outcome := 'already_paid';
    elsif inv.status = 'void' then
      -- Money arrived for an invoice we had replaced: a person has to look at it.
      v_outcome := 'needs_review';
    elsif p_data ->> 'amount' is not null and (p_data ->> 'amount')::numeric <> inv.total then
      v_outcome := 'amount_mismatch';
    else
      update app.subscription_invoices
         set status = 'paid', paid_at = now(), provider = p_provider,
             provider_invoice_id = coalesce(p_data ->> 'provider_invoice_id', provider_invoice_id)
       where id = inv.id;
      update app.subscriptions
         set plan_code = inv.plan_code,
             billing_cycle = inv.billing_cycle,
             status = 'active',
             current_period_start = inv.period_start::timestamp at time zone 'Asia/Bangkok',
             current_period_end = (inv.period_end + 1)::timestamp at time zone 'Asia/Bangkok',
             past_due_since = null,
             cancel_at_period_end = false,
             provider = case when p_provider in ('omise', 'stripe', 'manual') then p_provider else provider end,
             provider_customer_id = coalesce(p_data ->> 'provider_customer_id', provider_customer_id),
             provider_subscription_id = coalesce(p_data ->> 'provider_subscription_id', provider_subscription_id)
       where tenant_id = inv.tenant_id;
      perform app.emit_event(inv.tenant_id, null, 'subscription', inv.id, 'subscription.paid',
        jsonb_build_object('invoice_no', inv.invoice_no, 'plan_code', inv.plan_code));
      v_outcome := 'paid';
    end if;
  elsif p_type = 'invoice.payment_failed' then
    if inv.id is not null and inv.kind = 'renewal' and inv.status = 'open' then
      update app.subscriptions set status = 'past_due', past_due_since = coalesce(past_due_since, now())
       where tenant_id = inv.tenant_id and status = 'active';
      v_outcome := 'past_due';
    elsif inv.id is not null then
      v_outcome := 'noted';
    else
      v_outcome := 'unknown_invoice';
    end if;
  elsif p_type = 'subscription.canceled' then
    if v_tenant is null then
      v_outcome := 'unknown_invoice';
    else
      update app.subscriptions set cancel_at_period_end = true where tenant_id = v_tenant;
      v_outcome := 'cancel_scheduled';
    end if;
  end if;

  update app.billing_events set tenant_id = v_tenant, processed_at = now(), outcome = v_outcome
   where provider = p_provider and event_id = p_event_id;
  return v_outcome;
end;
$$;

-- -----------------------------------------------------------------------------
-- The nightly job. Safe to run as often as you like, at any time: each step only does what is due.
-- -----------------------------------------------------------------------------
create or replace function app.billing_run(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_next date;
  v_trials int := 0;
  v_ended int := 0;
  v_voided int := 0;
  v_invoiced int := 0;
  v_overdue int := 0;
  v_restricted int := 0;
begin
  -- Two servers waking at once must not both invoice: whoever is second simply skips this round.
  if not pg_try_advisory_xact_lock(hashtextextended('sabai.billing_run', 0)) then
    return jsonb_build_object('skipped', true);
  end if;

  -- A trial that ran out: the shop carries on with the free plan, owing nothing.
  for s in update app.subscriptions set status = 'canceled' where status = 'trialing' and trial_ends_at <= p_now returning tenant_id loop
    perform app.emit_event(s.tenant_id, null, 'subscription', s.tenant_id, 'subscription.trial_ended');
    v_trials := v_trials + 1;
  end loop;

  -- Asked to end with the period, and the period is over.
  for s in update app.subscriptions set status = 'canceled', past_due_since = null
            where status in ('active', 'past_due', 'restricted') and cancel_at_period_end and current_period_end <= p_now returning tenant_id loop
    perform app.emit_event(s.tenant_id, null, 'subscription', s.tenant_id, 'subscription.canceled');
    v_ended := v_ended + 1;
  end loop;

  -- A plan change nobody paid for in three days simply lapses.
  update app.subscription_invoices set status = 'void', voided_at = p_now where kind = 'plan_change' and status = 'open' and due_at <= p_now;
  get diagnostics v_voided = row_count;

  -- The next period's invoice, a week ahead, for shops on a paid plan that are not leaving.
  for s in
    select sub.tenant_id, sub.plan_code, sub.billing_cycle, sub.current_period_end
      from app.subscriptions sub
      join app.plans pl on pl.code = sub.plan_code
     where sub.status = 'active' and not sub.cancel_at_period_end and sub.current_period_end is not null
       and coalesce(case sub.billing_cycle when 'yearly' then pl.price_yearly else pl.price_monthly end, 0) > 0
       and sub.current_period_end <= p_now + interval '7 days'
       and not exists (select 1 from app.subscription_invoices i where i.tenant_id = sub.tenant_id and i.status = 'open')
  loop
    v_next := (s.current_period_end at time zone 'Asia/Bangkok')::date;
    if not exists (select 1 from app.subscription_invoices i where i.tenant_id = s.tenant_id and i.status in ('open', 'paid') and i.period_start = v_next) then
      perform app.issue_subscription_invoice(s.tenant_id, s.plan_code, s.billing_cycle, v_next, 'renewal', s.current_period_end, p_now);
      v_invoiced := v_invoiced + 1;
    end if;
  end loop;

  -- A renewal that is past due: the clock starts at the due date, not when this job happened to run.
  for s in
    update app.subscriptions sub set status = 'past_due', past_due_since = i.due_at
      from app.subscription_invoices i
     where i.tenant_id = sub.tenant_id and i.kind = 'renewal' and i.status = 'open' and i.due_at <= p_now and sub.status = 'active'
    returning sub.tenant_id
  loop
    perform app.emit_event(s.tenant_id, null, 'subscription', s.tenant_id, 'subscription.past_due');
    v_overdue := v_overdue + 1;
  end loop;

  -- Grace is over: no new branches, staff or tills until it is paid. Selling goes on.
  for s in
    update app.subscriptions set status = 'restricted'
     where status = 'past_due' and past_due_since is not null and p_now >= past_due_since + make_interval(days => grace_days)
    returning tenant_id
  loop
    perform app.emit_event(s.tenant_id, null, 'subscription', s.tenant_id, 'subscription.restricted');
    v_restricted := v_restricted + 1;
  end loop;

  return jsonb_build_object('trials_ended', v_trials, 'canceled', v_ended, 'plan_changes_lapsed', v_voided, 'invoiced', v_invoiced,
                            'past_due', v_overdue, 'restricted', v_restricted);
end;
$$;

-- A shop that changed its mind about a plan can withdraw the invoice. A renewal is a bill, not a request: it stays.
create or replace function app.void_subscription_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv app.subscription_invoices;
begin
  select * into inv from app.subscription_invoices where id = p_invoice for update;
  if not found then perform app.raise_error('NOT_FOUND', jsonb_build_object('entity', 'invoice')); end if;
  perform app.assert_permission(inv.tenant_id, 'billing.manage');
  if inv.status <> 'open' then perform app.raise_error('INVOICE_NOT_OPEN'); end if;
  if inv.kind <> 'plan_change' then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'invoice')); end if;
  update app.subscription_invoices set status = 'void', voided_at = now() where id = inv.id;
  perform app.emit_event(inv.tenant_id, null, 'subscription', inv.id, 'subscription.invoice_voided',
    jsonb_build_object('invoice_no', inv.invoice_no), app.actor_membership_id(inv.tenant_id));
end;
$$;

-- Only the plan request is for signed-in people; the rest (stage, invoicing, provider events, the nightly job) is internal.
grant execute on function app.request_plan_change(uuid, text, text), app.void_subscription_invoice(uuid) to authenticated;
revoke execute on function
  app.billing_stage(uuid, timestamptz),
  app.assert_plan_fits(uuid, text),
  app.next_invoice_no(timestamptz),
  app.issue_subscription_invoice(uuid, text, text, date, text, timestamptz, timestamptz),
  app.apply_billing_event(text, text, text, jsonb),
  app.billing_run(timestamptz)
from authenticated, public;
