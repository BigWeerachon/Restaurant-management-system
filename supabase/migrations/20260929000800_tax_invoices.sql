-- =============================================================================
-- Tax invoices (V1.1, 7.3)
--
--   1. Receipt numbers per till. A registered till's staff token carries `did`; `app.pay_order` gives that till its
--      own continuous series (HQ-T1-2609-00001). Anyone else keeps the branch series (HQ-2609-00001).
--   2. Full tax invoices (ใบกำกับภาษีเต็มรูป) on request: `app.tax_invoices`, one per paid order, append-only,
--      with the seller and the buyer as they were on the day (a later change of address must not change a document
--      that has been handed out) and its own running number (HQ-TI-2609-00001).
--
-- Credit notes (ใบลดหนี้) for a refunded bill with a tax invoice are not part of this: a refunded bill cannot get an
-- invoice, and a bill that has one cannot be refunded here without the accountant's credit note.
-- =============================================================================

alter table app.devices add column receipt_code text check (receipt_code is null or receipt_code ~ '^T[0-9]{1,4}$');
create unique index devices_receipt_code on app.devices (branch_id, receipt_code) where receipt_code is not null;

-- Same rule as isValidThaiTaxId in @sabai/domain (weights 13..2 over the first twelve digits); a parity test runs both
-- on the same numbers.
create or replace function app.is_valid_thai_tax_id(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  sum int := 0;
  i int;
begin
  if p_value is null or p_value !~ '^[0-9]{13}$' then return false; end if;
  for i in 1..12 loop
    sum := sum + substr(p_value, i, 1)::int * (14 - i);
  end loop;
  return ((11 - (sum % 11)) % 10) = substr(p_value, 13, 1)::int;
end;
$$;

-- -----------------------------------------------------------------------------
-- pay_order, now numbering per till (everything else is as before)
-- -----------------------------------------------------------------------------
create or replace function app.pay_order(p_order uuid, p_payments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  t app.tenants;
  b app.branches;
  pay jsonb;
  pm app.payment_methods;
  paid numeric := 0;
  all_cash boolean := true;
  rounded numeric;
  v_amount numeric;
  v_tendered numeric;
  shift uuid;
  actor uuid;
  cost numeric;
  dev app.devices;
  series text;
begin
  select * into o from app.orders where id = p_order for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  -- Authorise first: even the idempotent answer below must not leak to outsiders.
  perform app.assert_permission(o.tenant_id, 'pos.pay', o.branch_id);
  if o.status = 'paid' then
    -- Idempotent retry from a flaky connection.
    return jsonb_build_object('id', o.id, 'status', o.status, 'receipt_no', o.receipt_no, 'total', o.total,
                              'change', (select coalesce(sum(change_given), 0) from app.payments where order_id = o.id));
  end if;
  if o.status <> 'open' then perform app.raise_error('ORDER_NOT_OPEN'); end if;
  if not exists (select 1 from app.order_items where order_id = o.id and status <> 'voided') then
    perform app.raise_error('ORDER_EMPTY');
  end if;
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) = 0 then perform app.raise_error('PAYMENT_REQUIRED'); end if;

  select * into t from app.tenants where id = o.tenant_id;
  select * into b from app.branches where id = o.branch_id;
  actor := app.actor_membership_id(o.tenant_id);
  select s.id into shift from app.shifts s where s.branch_id = o.branch_id and s.status = 'open' order by s.opened_at desc limit 1;

  for pay in select * from jsonb_array_elements(p_payments) loop
    select * into pm from app.payment_methods where id = (pay->>'method_id')::uuid and tenant_id = o.tenant_id and is_active;
    if not found then perform app.raise_error('PAYMENT_METHOD_NOT_FOUND'); end if;
    if pm.kind <> 'cash' then all_cash := false; end if;
    if pm.kind = 'cash' and shift is null then perform app.raise_error('SHIFT_REQUIRED'); end if;
    if pm.requires_reference and coalesce(pay->>'reference', '') = '' then
      perform app.raise_error('PAYMENT_REFERENCE_REQUIRED', jsonb_build_object('method', pm.name));
    end if;
  end loop;

  -- Cash rounding only when the whole bill is settled in cash.
  if all_cash and t.cash_rounding <> 'none' then
    rounded := round(o.total / t.cash_rounding::numeric) * t.cash_rounding::numeric;
    if rounded <> o.total then
      update app.orders set rounding = rounded - (total - rounding), total = rounded where id = o.id returning * into o;
    end if;
  end if;

  for pay in select * from jsonb_array_elements(p_payments) loop
    select * into pm from app.payment_methods where id = (pay->>'method_id')::uuid;
    v_amount := round((pay->>'amount')::numeric, 2);
    v_tendered := nullif(pay->>'tendered', '')::numeric;
    if v_amount is null or v_amount <= 0 then perform app.raise_error('INVALID_AMOUNT'); end if;
    if v_tendered is not null and (pm.kind <> 'cash' or v_tendered < v_amount) then
      perform app.raise_error('INVALID_TENDERED');
    end if;
    insert into app.payments (tenant_id, branch_id, order_id, shift_id, method_id, amount, tendered, change_given,
                              fee_amount, reference, business_date, created_by)
    values (o.tenant_id, o.branch_id, o.id, shift, pm.id, v_amount, v_tendered, coalesce(v_tendered - v_amount, 0),
            round(v_amount * pm.fee_rate + pm.fee_fixed, 2), nullif(pay->>'reference', ''), o.business_date, actor);
    paid := paid + v_amount;
  end loop;

  if paid <> o.total then
    perform app.raise_error('PAYMENT_TOTAL_MISMATCH', jsonb_build_object('total', o.total, 'paid', paid));
  end if;

  cost := app.consume_order_stock(o.id);

  -- Numbers run per till. A registered till (its staff token carries its id in the `did` claim, set by the API and
  -- signed, never sent by a client) has a series of its own — HQ-T1-2609-00001 — so every machine's slips are
  -- continuous by themselves. Anyone else (the account on a browser) shares the branch series, HQ-2609-00001.
  select * into dev from app.devices d
   where d.id = nullif(app.jwt_claim('did'), '')::uuid and d.tenant_id = o.tenant_id and d.branch_id = o.branch_id
     and d.is_active and d.revoked_at is null
   for update;
  if found and dev.receipt_code is null then
    -- Codes are handed out on a till's first sale (T1, T2, ...) and never reused, even after it is revoked.
    dev.receipt_code := 'T' || app.next_doc_no(o.branch_id, 'device_code', '-');
    update app.devices set receipt_code = dev.receipt_code where id = dev.id;
  end if;
  series := coalesce(dev.receipt_code, '');

  update app.orders
     set status = 'paid', paid_by = actor, paid_at = now(), shift_id = coalesce(shift_id, shift), cost_total = cost,
         receipt_no = b.code || '-' || case when series = '' then '' else series || '-' end || to_char(o.business_date, 'YYMM') || '-' ||
                      lpad(app.next_doc_no(o.branch_id, case when series = '' then 'receipt' else 'receipt:' || series end, to_char(o.business_date, 'YYYYMM'))::text, 5, '0')
   where id = o.id
  returning * into o;

  -- Takeaway/delivery tickets still in the kitchen stay visible; dine-in keeps flowing.
  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.paid',
    jsonb_build_object('receipt_no', o.receipt_no, 'total', o.total, 'channel_id', o.channel_id, 'cost_total', cost), actor);

  return jsonb_build_object('id', o.id, 'status', o.status, 'receipt_no', o.receipt_no, 'total', o.total,
                            'change', (select coalesce(sum(change_given), 0) from app.payments where order_id = o.id));
end;
$$;


-- -----------------------------------------------------------------------------
-- The document
-- -----------------------------------------------------------------------------
create table app.tax_invoices (
  id                  uuid primary key default app.uuid_v7(),
  tenant_id           uuid not null,
  branch_id           uuid not null,
  order_id            uuid not null,
  invoice_no          text not null,
  -- The abbreviated slip this one accompanies.
  receipt_no          text,
  issued_at           timestamptz not null default now(),
  issued_by           uuid,
  -- Seller, as it was on the day.
  seller_name         text not null,
  seller_tax_id       text not null check (seller_tax_id ~ '^[0-9]{13}$'),
  seller_branch_no    text not null check (seller_branch_no ~ '^[0-9]{5}$'),
  seller_address      text not null,
  -- Buyer.
  buyer_name          text not null check (length(trim(buyer_name)) between 1 and 200),
  buyer_tax_id        text not null check (buyer_tax_id ~ '^[0-9]{13}$'),
  buyer_branch_no     text not null default '00000' check (buyer_branch_no ~ '^[0-9]{5}$'),
  buyer_address       text not null check (length(trim(buyer_address)) between 1 and 400),
  -- What was sold and what it came to, as on the bill when it was paid.
  lines               jsonb not null,
  items_total         numeric(14,2) not null,
  discount_total      numeric(14,2) not null,
  discount_reason     text,
  service_charge      numeric(14,2) not null,
  amount_before_vat   numeric(14,2) not null,
  vat_rate            numeric(5,4) not null,
  vat_amount          numeric(14,2) not null,
  rounding            numeric(14,2) not null,
  total               numeric(14,2) not null,
  prices_include_vat  boolean not null,
  unique (tenant_id, id),
  unique (order_id),
  unique (branch_id, invoice_no),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, order_id) references app.orders(tenant_id, id),
  foreign key (tenant_id, issued_by) references app.memberships(tenant_id, id)
);
create index tax_invoices_branch on app.tax_invoices (branch_id, issued_at);
create trigger tax_invoices_immutable before update or delete on app.tax_invoices
  for each row execute function app.forbid_mutation();
create trigger audit_capture after insert or update or delete on app.tax_invoices
  for each row execute function audit.capture();
-- Read for anyone who can see the branch's bills; nobody writes but the command below.
call app.apply_tenant_rls('app.tax_invoices', null, null, 'branch_id');

create or replace function app.issue_tax_invoice(
  p_order uuid,
  p_buyer_name text,
  p_buyer_tax_id text,
  p_buyer_address text,
  p_buyer_branch_no text default '00000'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o app.orders;
  t app.tenants;
  b app.branches;
  inv app.tax_invoices;
  actor uuid;
  v_lines jsonb;
  v_before numeric;
  v_branch_no text := coalesce(nullif(trim(p_buyer_branch_no), ''), '00000');
begin
  select * into o from app.orders where id = p_order for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  -- Issuing is part of completing a sale at the till: the same right as taking the money.
  perform app.assert_permission(o.tenant_id, 'pos.pay', o.branch_id);

  select * into inv from app.tax_invoices where order_id = o.id;
  if found then perform app.raise_error('TAX_INVOICE_EXISTS', jsonb_build_object('invoice_no', inv.invoice_no)); end if;

  select * into t from app.tenants where id = o.tenant_id;
  select * into b from app.branches where id = o.branch_id;
  if not t.vat_registered or t.tax_id is null or not app.is_valid_thai_tax_id(t.tax_id) or coalesce(trim(b.address), '') = '' then
    perform app.raise_error('TAX_INVOICE_NOT_AVAILABLE');
  end if;
  if o.status <> 'paid' or o.receipt_no is null then perform app.raise_error('TAX_INVOICE_ORDER_NOT_PAID'); end if;

  if coalesce(trim(p_buyer_name), '') = '' or length(trim(p_buyer_name)) > 200 then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'buyerName')); end if;
  if not app.is_valid_thai_tax_id(p_buyer_tax_id) then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'buyerTaxId')); end if;
  if coalesce(trim(p_buyer_address), '') = '' or length(trim(p_buyer_address)) > 400 then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'buyerAddress')); end if;
  if v_branch_no !~ '^[0-9]{5}$' then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'buyerBranchNo')); end if;

  actor := app.actor_membership_id(o.tenant_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', oi.name, 'qty', oi.qty, 'unit_price', oi.unit_price, 'modifiers_total', oi.modifiers_total, 'line_total', oi.line_total,
           'modifiers', coalesce((select jsonb_agg(m.name order by m.id) from app.order_item_modifiers m where m.order_item_id = oi.id), '[]'::jsonb))
           order by oi.created_at), '[]'::jsonb)
    into v_lines
    from app.order_items oi where oi.order_id = o.id and oi.status <> 'voided';

  -- Same as amountBeforeVat in @sabai/domain.
  v_before := round(o.items_total - o.discount_total + o.service_charge - case when o.prices_include_vat then o.vat_amount else 0 end, 2);

  insert into app.tax_invoices (
    tenant_id, branch_id, order_id, invoice_no, receipt_no, issued_by,
    seller_name, seller_tax_id, seller_branch_no, seller_address,
    buyer_name, buyer_tax_id, buyer_branch_no, buyer_address,
    lines, items_total, discount_total, discount_reason, service_charge, amount_before_vat, vat_rate, vat_amount, rounding, total, prices_include_vat)
  values (
    o.tenant_id, o.branch_id, o.id,
    b.code || '-TI-' || to_char(o.business_date, 'YYMM') || '-' || lpad(app.next_doc_no(o.branch_id, 'tax_invoice', to_char(o.business_date, 'YYYYMM'))::text, 5, '0'),
    o.receipt_no, actor,
    coalesce(nullif(trim(t.legal_name), ''), t.name), t.tax_id, b.tax_branch_no, trim(b.address),
    trim(p_buyer_name), p_buyer_tax_id, v_branch_no, trim(p_buyer_address),
    v_lines, o.items_total, o.discount_total, o.discount_reason, o.service_charge, v_before, o.vat_rate, o.vat_amount, o.rounding, o.total, o.prices_include_vat)
  returning * into inv;

  perform app.emit_event(o.tenant_id, o.branch_id, 'order', o.id, 'order.tax_invoiced',
    jsonb_build_object('invoice_no', inv.invoice_no, 'receipt_no', o.receipt_no, 'total', o.total), actor);

  return to_jsonb(inv);
end;
$$;

grant execute on function app.issue_tax_invoice(uuid, text, text, text, text) to authenticated;
