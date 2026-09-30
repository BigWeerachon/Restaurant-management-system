-- =============================================================================
-- Sabai — Finance: chart of accounts, double-entry GL, AP (bills), expenses,
-- day close (sub-ledger → GL), bank/platform reconciliation.
--
-- Posting model ("reliable for finance")
--   * Operational ledgers (payments, stock_movements, shifts) are the sub-ledgers.
--   * Goods receipts, bills, expenses post to the GL immediately (per document).
--   * Sales, COGS, waste, count variance, cash over/short are summarised per
--     branch per business day by app.close_business_day() — one clean entry set
--     per day instead of thousands of micro-entries, exactly how accountants work.
--   * Every journal entry must balance (deferred constraint) and is immutable;
--     mistakes are fixed by reversal entries.
--   * Money that "should arrive" (card batches, PromptPay, platform payouts) is
--     tracked as expected receipts and matched against bank statement lines, so
--     the owner sees what is missing and why (GP/fees differ, promo deductions…).
-- =============================================================================

create table app.accounts (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references app.tenants(id) on delete cascade,
  code        text not null check (code ~ '^[0-9]{4,6}$'),
  name        text not null,
  name_en     text,
  type        text not null check (type in ('asset','liability','equity','revenue','expense')),
  system_key  text,
  parent_id   uuid,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, parent_id) references app.accounts(tenant_id, id)
);
create unique index accounts_system_key on app.accounts (tenant_id, system_key) where system_key is not null;

create table app.bank_accounts (
  account_id      uuid primary key,
  tenant_id       uuid not null,
  bank_name       text not null,
  account_name    text,
  account_no_last4 text check (account_no_last4 is null or account_no_last4 ~ '^[0-9]{4}$'),
  foreign key (tenant_id, account_id) references app.accounts(tenant_id, id) on delete cascade
);

alter table app.payment_methods
  add column ledger_account_id uuid,
  add foreign key (tenant_id, ledger_account_id) references app.accounts(tenant_id, id),
  add foreign key (tenant_id, settlement_account_id) references app.accounts(tenant_id, id);
alter table app.sales_channels
  add foreign key (tenant_id, receivable_account_id) references app.accounts(tenant_id, id);

create or replace function app.account_id(p_tenant uuid, p_system_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from app.accounts where tenant_id = p_tenant and system_key = p_system_key;
  if v is null then
    perform app.raise_error('ACCOUNT_NOT_CONFIGURED', jsonb_build_object('key', p_system_key));
  end if;
  return v;
end;
$$;

-- Tenant-wide document counters (journal entries, bills).
create table app.tenant_sequences (
  tenant_id   uuid not null references app.tenants(id) on delete cascade,
  doc_type    text not null,
  period      text not null,
  last_value  bigint not null default 0,
  primary key (tenant_id, doc_type, period)
);

create or replace function app.next_tenant_doc_no(p_tenant uuid, p_doc_type text, p_period text)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.tenant_sequences as s (tenant_id, doc_type, period, last_value)
  values (p_tenant, p_doc_type, p_period, 1)
  on conflict (tenant_id, doc_type, period) do update set last_value = s.last_value + 1
  returning last_value
$$;

create table app.journal_entries (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null,
  branch_id    uuid,
  entry_no     text not null,
  entry_date   date not null,
  source_type  text not null,
  source_id    uuid,
  memo         text,
  status       text not null default 'posted' check (status in ('posted','reversed')),
  reversal_of  uuid,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, entry_no),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id)
);
create index journal_entries_date on app.journal_entries (tenant_id, entry_date);
create index journal_entries_source on app.journal_entries (source_type, source_id);

create table app.journal_lines (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  entry_id    uuid not null,
  account_id  uuid not null,
  branch_id   uuid,
  debit       numeric(16,2) not null default 0 check (debit >= 0),
  credit      numeric(16,2) not null default 0 check (credit >= 0),
  memo        text,
  check ((debit = 0) <> (credit = 0)),
  foreign key (tenant_id, entry_id) references app.journal_entries(tenant_id, id),
  foreign key (tenant_id, account_id) references app.accounts(tenant_id, id)
);
create index journal_lines_entry on app.journal_lines (entry_id);
create index journal_lines_account on app.journal_lines (account_id, branch_id);

create or replace function app.check_entry_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d numeric;
  c numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from app.journal_lines where entry_id = new.entry_id;
  if d <> c then
    perform app.raise_error('JOURNAL_UNBALANCED', jsonb_build_object('entry_id', new.entry_id, 'debit', d, 'credit', c));
  end if;
  return null;
end;
$$;
create constraint trigger journal_lines_balanced after insert on app.journal_lines
  deferrable initially deferred for each row execute function app.check_entry_balanced();
create trigger journal_lines_immutable before update or delete on app.journal_lines
  for each row execute function app.forbid_mutation();

-- Internal poster used by commands (no permission check — callers check).
-- p_lines: [{"account": "<system_key>" | "account_id": "<uuid>", "amount": <signed; + = debit, − = credit>, "branch_id"?, "memo"?}]
create or replace function app.post_journal(
  p_tenant uuid, p_branch uuid, p_date date, p_source_type text, p_source_id uuid, p_memo text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  ln jsonb;
  amt numeric;
  acc uuid;
  n int := 0;
begin
  if not exists (select 1 from jsonb_array_elements(p_lines) x where round(coalesce((x->>'amount')::numeric, 0), 2) <> 0) then
    return null;
  end if;
  insert into app.journal_entries (tenant_id, branch_id, entry_no, entry_date, source_type, source_id, memo, created_by)
  values (p_tenant, p_branch,
          'JE' || to_char(p_date, 'YYMM') || '-' || lpad(app.next_tenant_doc_no(p_tenant, 'je', to_char(p_date, 'YYYYMM'))::text, 5, '0'),
          p_date, p_source_type, p_source_id, p_memo, app.actor_membership_id(p_tenant))
  returning id into eid;

  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    continue when amt = 0;
    acc := coalesce(nullif(ln->>'account_id', '')::uuid, app.account_id(p_tenant, ln->>'account'));
    insert into app.journal_lines (tenant_id, entry_id, account_id, branch_id, debit, credit, memo)
    values (p_tenant, eid, acc, coalesce(nullif(ln->>'branch_id', '')::uuid, p_branch),
            greatest(amt, 0), greatest(-amt, 0), ln->>'memo');
    n := n + 1;
  end loop;
  return eid;
end;
$$;

create or replace function app.reverse_journal(p_entry uuid, p_date date, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  je app.journal_entries;
  rid uuid;
begin
  select * into je from app.journal_entries where id = p_entry for update;
  if je.status = 'reversed' then return null; end if;
  insert into app.journal_entries (tenant_id, branch_id, entry_no, entry_date, source_type, source_id, memo, reversal_of, created_by)
  values (je.tenant_id, je.branch_id,
          'JE' || to_char(p_date, 'YYMM') || '-' || lpad(app.next_tenant_doc_no(je.tenant_id, 'je', to_char(p_date, 'YYYYMM'))::text, 5, '0'),
          p_date, je.source_type, je.source_id, p_memo, je.id, app.actor_membership_id(je.tenant_id))
  returning id into rid;
  insert into app.journal_lines (tenant_id, entry_id, account_id, branch_id, debit, credit, memo)
  select tenant_id, rid, account_id, branch_id, credit, debit, memo from app.journal_lines where entry_id = je.id;
  update app.journal_entries set status = 'reversed' where id = je.id;
  return rid;
end;
$$;

-- =============================================================================
-- Payables & expenses
-- =============================================================================
create table app.bills (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  branch_id       uuid,
  supplier_id     uuid,
  internal_no     text not null,
  bill_no         text,
  bill_date       date not null,
  due_date        date not null,
  source_type     text not null default 'manual' check (source_type in ('goods_receipt','expense','manual')),
  source_id       uuid,
  subtotal        numeric(14,2) not null default 0,
  vat_amount      numeric(14,2) not null default 0,
  wht_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null,
  amount_paid     numeric(14,2) not null default 0,
  status          text not null default 'open' check (status in ('open','partially_paid','paid','void')),
  attachment_url  text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, internal_no),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id)
);
create index bills_open on app.bills (tenant_id, due_date) where status in ('open','partially_paid');

create table app.bill_payments (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null,
  bill_id     uuid not null,
  paid_on     date not null,
  amount      numeric(14,2) not null check (amount > 0),
  account_id  uuid not null,
  reference   text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, bill_id) references app.bills(tenant_id, id),
  foreign key (tenant_id, account_id) references app.accounts(tenant_id, id)
);

create table app.expenses (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null,
  branch_id       uuid,
  expense_date    date not null,
  -- Service period (e.g. September rent). Reports spread the amount evenly over
  -- these days so a monthly bill never makes one week look like a loss.
  period_start    date,
  period_end      date,
  account_id      uuid not null,
  description     text not null,
  amount          numeric(14,2) not null check (amount > 0),
  vat_amount      numeric(14,2) not null default 0 check (vat_amount >= 0),
  wht_amount      numeric(14,2) not null default 0 check (wht_amount >= 0),
  paid_from       text not null check (paid_from in ('cash_on_hand','bank','credit')),
  supplier_id     uuid,
  bill_id         uuid,
  journal_entry_id uuid,
  attachment_url  text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  check ((period_start is null) = (period_end is null)),
  check (period_end >= period_start and period_end - period_start <= 366),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, account_id) references app.accounts(tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id)
);
create index expenses_date on app.expenses (tenant_id, expense_date);

-- Called by receive_goods: inventory (+ direct cost for untracked items) against AP/cash/bank.
create or replace function app.post_goods_receipt(p_gr uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  gr app.goods_receipts;
  stocked numeric;
  direct numeric;
  credit_key text;
  bill uuid;
  terms int;
begin
  select * into gr from app.goods_receipts where id = p_gr;
  select coalesce(sum(l.line_total) filter (where i.track_stock), 0),
         coalesce(sum(l.line_total) filter (where not i.track_stock), 0)
    into stocked, direct
    from app.goods_receipt_lines l join app.ingredients i on i.id = l.ingredient_id
   where l.gr_id = gr.id;

  if gr.payment_mode = 'credit' then
    if gr.supplier_id is null then perform app.raise_error('SUPPLIER_REQUIRED_FOR_CREDIT'); end if;
    select payment_terms_days into terms from app.suppliers where id = gr.supplier_id;
    insert into app.bills (tenant_id, branch_id, supplier_id, internal_no, bill_no, bill_date, due_date, source_type, source_id,
                           subtotal, vat_amount, total, attachment_url, created_by)
    values (gr.tenant_id, gr.branch_id, gr.supplier_id,
            'BILL' || to_char(gr.business_date, 'YYMM') || '-' || lpad(app.next_tenant_doc_no(gr.tenant_id, 'bill', to_char(gr.business_date, 'YYYYMM'))::text, 4, '0'),
            gr.invoice_no, coalesce(gr.invoice_date, gr.business_date),
            coalesce(gr.invoice_date, gr.business_date) + coalesce(terms, 0),
            'goods_receipt', gr.id, gr.subtotal, gr.vat_amount, gr.total, gr.attachment_url, gr.received_by)
    returning id into bill;
    credit_key := 'accounts_payable';
  elsif gr.payment_mode = 'cash_paid' then
    credit_key := 'cash_on_hand';
  else
    credit_key := 'bank';
  end if;

  return app.post_journal(gr.tenant_id, gr.branch_id, gr.business_date, 'goods_receipt', gr.id,
    'รับของ ' || gr.gr_no,
    jsonb_build_array(
      jsonb_build_object('account', 'inventory', 'amount', stocked),
      jsonb_build_object('account', 'cogs', 'amount', direct),
      jsonb_build_object('account', 'vat_input', 'amount', gr.vat_amount),
      jsonb_build_object('account', credit_key, 'amount', -gr.total)));
end;
$$;

-- p: {branch_id?, expense_date?, account_id, description, amount, vat_amount?, wht_amount?, paid_from, supplier_id?, attachment_url?}
create or replace function app.record_expense(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc app.accounts;
  v_tenant uuid;
  v_branch uuid := nullif(p->>'branch_id', '')::uuid;
  v_date date;
  v_amount numeric := (p->>'amount')::numeric;
  v_vat numeric := coalesce(nullif(p->>'vat_amount', '')::numeric, 0);
  v_wht numeric := coalesce(nullif(p->>'wht_amount', '')::numeric, 0);
  v_paid text := p->>'paid_from';
  v_from date := nullif(p->>'period_start', '')::date;
  v_to date := nullif(p->>'period_end', '')::date;
  eid uuid;
  exp_id uuid;
  bill uuid;
begin
  select * into acc from app.accounts where id = (p->>'account_id')::uuid;
  if not found or acc.type <> 'expense' then perform app.raise_error('INVALID_EXPENSE_ACCOUNT'); end if;
  v_tenant := acc.tenant_id;
  perform app.assert_permission(v_tenant, 'finance.manage', v_branch);
  if v_amount is null or v_amount <= 0 then perform app.raise_error('INVALID_AMOUNT'); end if;
  v_date := coalesce(nullif(p->>'expense_date', '')::date, case when v_branch is not null then app.business_date(v_branch) else current_date end);
  if v_branch is not null then perform app.assert_period_open(v_branch, v_date); end if;
  if (v_from is null) <> (v_to is null) or v_to < v_from or v_to - v_from > 366 then
    perform app.raise_error('INVALID_PERIOD');
  end if;

  if v_paid = 'credit' then
    if nullif(p->>'supplier_id', '') is null then perform app.raise_error('SUPPLIER_REQUIRED_FOR_CREDIT'); end if;
    insert into app.bills (tenant_id, branch_id, supplier_id, internal_no, bill_date, due_date, source_type,
                           subtotal, vat_amount, wht_amount, total, attachment_url, created_by)
    values (v_tenant, v_branch, (p->>'supplier_id')::uuid,
            'BILL' || to_char(v_date, 'YYMM') || '-' || lpad(app.next_tenant_doc_no(v_tenant, 'bill', to_char(v_date, 'YYYYMM'))::text, 4, '0'),
            v_date, v_date + 30, 'expense', v_amount, v_vat, v_wht, v_amount + v_vat, nullif(p->>'attachment_url', ''),
            app.actor_membership_id(v_tenant))
    returning id into bill;
  end if;

  eid := app.post_journal(v_tenant, v_branch, v_date, 'expense', null, p->>'description',
    jsonb_build_array(
      jsonb_build_object('account_id', acc.id, 'amount', v_amount),
      jsonb_build_object('account', 'vat_input', 'amount', v_vat),
      jsonb_build_object('account', case v_paid when 'credit' then 'accounts_payable' else v_paid end, 'amount', -(v_amount + v_vat - case when v_paid = 'credit' then 0 else v_wht end)),
      jsonb_build_object('account', 'wht_payable', 'amount', -(case when v_paid = 'credit' then 0 else v_wht end))));

  insert into app.expenses (tenant_id, branch_id, expense_date, period_start, period_end, account_id, description, amount, vat_amount, wht_amount,
                            paid_from, supplier_id, bill_id, journal_entry_id, attachment_url, created_by)
  values (v_tenant, v_branch, v_date, v_from, v_to, acc.id, p->>'description', v_amount, v_vat, v_wht, v_paid,
          nullif(p->>'supplier_id', '')::uuid, bill, eid, nullif(p->>'attachment_url', ''), app.actor_membership_id(v_tenant))
  returning id into exp_id;
  update app.bills set source_id = exp_id where id = bill;
  return exp_id;
end;
$$;

create or replace function app.pay_bill(p_bill uuid, p_amount numeric, p_from text default 'bank', p_reference text default null, p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b app.bills;
  v_date date;
  wht_part numeric;
begin
  select * into b from app.bills where id = p_bill for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(b.tenant_id, 'finance.manage');
  if b.status in ('paid','void') then perform app.raise_error('BILL_NOT_PAYABLE', jsonb_build_object('status', b.status)); end if;
  if p_amount is null or p_amount <= 0 or p_amount > b.total - b.amount_paid then
    perform app.raise_error('INVALID_AMOUNT', jsonb_build_object('outstanding', b.total - b.amount_paid));
  end if;
  if p_from not in ('bank','cash_on_hand') then perform app.raise_error('INVALID_ACCOUNT'); end if;
  v_date := coalesce(p_date, current_date);
  -- Withholding tax is deducted proportionally from what we transfer.
  wht_part := round(b.wht_amount * p_amount / b.total, 2);

  insert into app.bill_payments (tenant_id, bill_id, paid_on, amount, account_id, reference, created_by)
  values (b.tenant_id, b.id, v_date, p_amount, app.account_id(b.tenant_id, p_from), p_reference, app.actor_membership_id(b.tenant_id));
  perform app.post_journal(b.tenant_id, b.branch_id, v_date, 'bill_payment', b.id, 'จ่ายบิล ' || b.internal_no,
    jsonb_build_array(
      jsonb_build_object('account', 'accounts_payable', 'amount', p_amount),
      jsonb_build_object('account', p_from, 'amount', -(p_amount - wht_part)),
      jsonb_build_object('account', 'wht_payable', 'amount', -wht_part)));
  update app.bills
     set amount_paid = amount_paid + p_amount,
         status = case when amount_paid + p_amount >= total then 'paid' else 'partially_paid' end
   where id = b.id;
end;
$$;

-- =============================================================================
-- Reconciliation
-- =============================================================================
create table app.expected_receipts (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null,
  branch_id            uuid not null,
  business_date        date not null,
  source_type          text not null check (source_type in ('card_batch','payment','platform_payout','cash_deposit','other')),
  source_id            uuid,
  label                text not null,
  clearing_account_id  uuid not null,
  bank_account_id      uuid,
  expected_date        date not null,
  expected_amount      numeric(14,2) not null,
  matched_amount       numeric(14,2) not null default 0,
  status               text not null default 'open' check (status in ('open','matched','partial','written_off')),
  created_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches(tenant_id, id),
  foreign key (tenant_id, clearing_account_id) references app.accounts(tenant_id, id),
  foreign key (tenant_id, bank_account_id) references app.accounts(tenant_id, id)
);
create index expected_receipts_open on app.expected_receipts (tenant_id, expected_date) where status in ('open','partial');

create table app.statement_imports (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null,
  bank_account_id  uuid not null,
  source           text not null default 'bank_csv' check (source in ('bank_csv','manual','api')),
  file_name        text,
  line_count       int not null default 0,
  imported_by      uuid,
  imported_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, bank_account_id) references app.accounts(tenant_id, id)
);

create table app.statement_lines (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null,
  import_id        uuid not null,
  bank_account_id  uuid not null,
  txn_date         date not null,
  description      text,
  amount           numeric(14,2) not null check (amount <> 0),
  reference        text,
  fingerprint      text not null,
  status           text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  note             text,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, fingerprint),
  foreign key (tenant_id, import_id) references app.statement_imports(tenant_id, id),
  foreign key (tenant_id, bank_account_id) references app.accounts(tenant_id, id)
);
create index statement_lines_unmatched on app.statement_lines (tenant_id, txn_date) where status = 'unmatched';

create table app.reconciliation_matches (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null,
  statement_line_id    uuid not null,
  expected_receipt_id  uuid,
  amount               numeric(14,2) not null,
  journal_entry_id     uuid,
  note                 text,
  matched_by           uuid,
  created_at           timestamptz not null default now(),
  foreign key (tenant_id, statement_line_id) references app.statement_lines(tenant_id, id),
  foreign key (tenant_id, expected_receipt_id) references app.expected_receipts(tenant_id, id)
);

-- p_lines: [{txn_date, amount, description?, reference?}]
create or replace function app.import_statement_lines(p_bank_account uuid, p_lines jsonb, p_file_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc app.accounts;
  imp uuid;
  inserted int;
begin
  select * into acc from app.accounts where id = p_bank_account and type = 'asset';
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(acc.tenant_id, 'finance.reconcile');
  insert into app.statement_imports (tenant_id, bank_account_id, file_name, imported_by)
  values (acc.tenant_id, acc.id, p_file_name, app.actor_membership_id(acc.tenant_id)) returning id into imp;

  insert into app.statement_lines (tenant_id, import_id, bank_account_id, txn_date, description, amount, reference, fingerprint)
  select acc.tenant_id, imp, acc.id, (x->>'txn_date')::date, x->>'description', (x->>'amount')::numeric, x->>'reference',
         md5(acc.id::text || '|' || (x->>'txn_date') || '|' || (x->>'amount') || '|' || coalesce(x->>'reference', '') || '|' || coalesce(x->>'description', ''))
    from jsonb_array_elements(p_lines) x
   where (x->>'amount')::numeric <> 0
  on conflict (tenant_id, fingerprint) do nothing;
  get diagnostics inserted = row_count;
  update app.statement_imports set line_count = inserted where id = imp;
  return jsonb_build_object('import_id', imp, 'inserted', inserted, 'duplicates', jsonb_array_length(p_lines) - inserted);
end;
$$;

-- Match one bank line to one or more expected receipts; the difference is booked
-- to a variance account the user picks from a short, plain-language list.
create or replace function app.match_statement_line(p_line uuid, p_expected uuid[], p_variance_account text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sl app.statement_lines;
  expected_sum numeric;
  variance numeric;
  lines jsonb := '[]'::jsonb;
  er record;
  eid uuid;
begin
  select * into sl from app.statement_lines where id = p_line for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(sl.tenant_id, 'finance.reconcile');
  if sl.status <> 'unmatched' then perform app.raise_error('LINE_ALREADY_MATCHED'); end if;

  select coalesce(sum(expected_amount - matched_amount), 0) into expected_sum
    from app.expected_receipts where id = any(p_expected) and tenant_id = sl.tenant_id and status in ('open','partial');
  variance := sl.amount - expected_sum;
  if variance <> 0 and p_variance_account is null then
    perform app.raise_error('VARIANCE_ACCOUNT_REQUIRED', jsonb_build_object('variance', variance));
  end if;

  lines := lines || jsonb_build_object('account_id', sl.bank_account_id, 'amount', sl.amount);
  for er in select * from app.expected_receipts where id = any(p_expected) and tenant_id = sl.tenant_id and status in ('open','partial') loop
    lines := lines || jsonb_build_object('account_id', er.clearing_account_id, 'amount', -(er.expected_amount - er.matched_amount), 'branch_id', er.branch_id);
    insert into app.reconciliation_matches (tenant_id, statement_line_id, expected_receipt_id, amount, note, matched_by)
    values (sl.tenant_id, sl.id, er.id, er.expected_amount - er.matched_amount, p_note, app.actor_membership_id(sl.tenant_id));
  end loop;
  if variance <> 0 then
    lines := lines || jsonb_build_object('account', p_variance_account, 'amount', -variance);
  end if;

  eid := app.post_journal(sl.tenant_id, null, sl.txn_date, 'reconciliation', sl.id, coalesce(p_note, 'กระทบยอด ' || coalesce(sl.description, '')), lines);
  update app.reconciliation_matches set journal_entry_id = eid where statement_line_id = sl.id and journal_entry_id is null;
  update app.expected_receipts set matched_amount = expected_amount, status = 'matched' where id = any(p_expected) and tenant_id = sl.tenant_id;
  update app.statement_lines set status = 'matched', note = p_note where id = sl.id;
  return jsonb_build_object('line_id', sl.id, 'variance', variance, 'journal_entry_id', eid);
end;
$$;

create or replace function app.ignore_statement_line(p_line uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sl app.statement_lines;
begin
  select * into sl from app.statement_lines where id = p_line for update;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(sl.tenant_id, 'finance.reconcile');
  if coalesce(trim(p_note), '') = '' then perform app.raise_error('REASON_REQUIRED'); end if;
  update app.statement_lines set status = 'ignored', note = p_note where id = sl.id;
end;
$$;

-- =============================================================================
-- Day close
-- =============================================================================
create or replace function app.close_business_day(p_branch uuid, p_date date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b app.branches;
  existing app.day_closes;
  open_orders int;
  open_shifts int;
  summary jsonb;
  sales_lines jsonb := '[]'::jsonb;
  inv_lines jsonb := '[]'::jsonb;
  cash_lines jsonb := '[]'::jsonb;
  r record;
  bank uuid;
begin
  select * into b from app.branches where id = p_branch;
  if not found then perform app.raise_error('NOT_FOUND'); end if;
  perform app.assert_permission(b.tenant_id, 'finance.close_day', b.id);

  select * into existing from app.day_closes where branch_id = b.id and business_date = p_date;
  if found and existing.status = 'closed' then
    return existing.summary;
  end if;

  select count(*) into open_orders from app.orders where branch_id = b.id and business_date = p_date and status = 'open';
  if open_orders > 0 then perform app.raise_error('OPEN_ORDERS_EXIST', jsonb_build_object('count', open_orders)); end if;
  select count(*) into open_shifts from app.shifts where branch_id = b.id and business_date = p_date and status = 'open';
  if open_shifts > 0 then perform app.raise_error('OPEN_SHIFTS_EXIST', jsonb_build_object('count', open_shifts)); end if;

  -- ---- Sales -----------------------------------------------------------------
  select jsonb_build_object(
           'orders', count(*),
           'gross_sales', coalesce(sum(items_total), 0),
           'discounts', coalesce(sum(discount_total), 0),
           'service_charge', coalesce(sum(service_charge), 0),
           'vat', coalesce(sum(vat_amount), 0),
           'rounding', coalesce(sum(rounding), 0),
           'total', coalesce(sum(total), 0),
           'commission', coalesce(sum(commission_amount + commission_vat_amount), 0),
           'cost', coalesce(sum(cost_total), 0))
    into summary
    from app.orders where branch_id = b.id and business_date = p_date and status in ('paid','refunded');

  -- Revenue split (VAT-exclusive), service charge, VAT, rounding.
  for r in
    select coalesce(sum(o.total - o.rounding - o.vat_amount
             - case when o.prices_include_vat and o.vat_rate > 0 then round(o.service_charge / (1 + o.vat_rate), 2) else o.service_charge end), 0) as revenue,
           coalesce(sum(case when o.prices_include_vat and o.vat_rate > 0 then round(o.service_charge / (1 + o.vat_rate), 2) else o.service_charge end), 0) as sc,
           coalesce(sum(o.vat_amount), 0) as vat,
           coalesce(sum(o.rounding), 0) as rounding
      from app.orders o where o.branch_id = b.id and o.business_date = p_date and o.status in ('paid','refunded')
  loop
    sales_lines := sales_lines
      || jsonb_build_object('account', 'sales_revenue', 'amount', -r.revenue)
      || jsonb_build_object('account', 'service_charge_revenue', 'amount', -r.sc)
      || jsonb_build_object('account', 'vat_output', 'amount', -r.vat)
      || jsonb_build_object('account', 'other_income', 'amount', -r.rounding);
  end loop;

  -- Money in, per ledger account (platform payments land on the channel's receivable).
  for r in
    select coalesce(case when pm.kind = 'platform' then ch.receivable_account_id end, pm.ledger_account_id) as account_id,
           sum(case when p.kind = 'payment' then p.amount else 0 end) as received,
           sum(case when p.kind = 'refund' then p.amount else 0 end) as refunded,
           sum(p.fee_amount) as fees
      from app.payments p
      join app.payment_methods pm on pm.id = p.method_id
      join app.orders o on o.id = p.order_id
      join app.sales_channels ch on ch.id = o.channel_id
     where p.branch_id = b.id and p.business_date = p_date
     group by 1
  loop
    sales_lines := sales_lines
      || jsonb_build_object('account_id', r.account_id, 'amount', r.received - r.refunded - r.fees)
      || jsonb_build_object('account', 'sales_refunds', 'amount', r.refunded)
      || jsonb_build_object('account', 'payment_fee_expense', 'amount', r.fees);
  end loop;

  -- Delivery GP accrued against the platform receivable.
  for r in
    select coalesce(ch.receivable_account_id, app.account_id(b.tenant_id, 'platform_receivable')) as account_id,
           sum(o.commission_amount) as commission, sum(o.commission_vat_amount) as commission_vat
      from app.orders o join app.sales_channels ch on ch.id = o.channel_id
     where o.branch_id = b.id and o.business_date = p_date and o.status in ('paid','refunded') and o.commission_amount > 0
     group by 1
  loop
    sales_lines := sales_lines
      || jsonb_build_object('account', 'commission_expense', 'amount', r.commission)
      || jsonb_build_object('account', 'vat_input', 'amount', r.commission_vat)
      || jsonb_build_object('account_id', r.account_id, 'amount', -(r.commission + r.commission_vat));
  end loop;

  perform app.post_journal(b.tenant_id, b.id, p_date, 'day_close', b.id, 'ยอดขายประจำวัน ' || to_char(p_date, 'DD/MM/YYYY'), sales_lines);

  -- ---- Inventory sub-ledger --------------------------------------------------
  for r in
    select reason, coalesce(sum(total_cost), 0) as value
      from app.stock_movements
     where branch_id = b.id and business_date = p_date and reason <> 'purchase'
     group by reason
  loop
    inv_lines := inv_lines || jsonb_build_object('account', 'inventory', 'amount', r.value)
                 || jsonb_build_object('account',
                   case r.reason
                     when 'sale' then 'cogs'
                     when 'sale_void' then 'cogs'
                     when 'waste' then 'waste_expense'
                     when 'transfer_out' then 'inventory_in_transit'
                     when 'transfer_in' then 'inventory_in_transit'
                     when 'opening' then 'owner_equity'
                     else 'inventory_variance' end,
                   'amount', -r.value);
  end loop;
  perform app.post_journal(b.tenant_id, b.id, p_date, 'day_close', b.id, 'ต้นทุนและสต็อกประจำวัน ' || to_char(p_date, 'DD/MM/YYYY'), inv_lines);

  -- ---- Cash drawer -----------------------------------------------------------
  for r in
    select coalesce(sum(cash_variance), 0) as variance from app.shifts
     where branch_id = b.id and business_date = p_date and status = 'closed'
  loop
    cash_lines := cash_lines
      || jsonb_build_object('account', 'cash_on_hand', 'amount', r.variance)
      || jsonb_build_object('account', 'cash_over_short', 'amount', -r.variance);
  end loop;
  for r in
    select coalesce(sum(case when c.kind = 'pay_in' then c.amount else -c.amount end), 0) as net
      from app.cash_movements c join app.shifts s on s.id = c.shift_id
     where s.branch_id = b.id and s.business_date = p_date
  loop
    cash_lines := cash_lines
      || jsonb_build_object('account', 'cash_on_hand', 'amount', r.net)
      || jsonb_build_object('account', 'petty_cash_clearing', 'amount', -r.net);
  end loop;
  perform app.post_journal(b.tenant_id, b.id, p_date, 'day_close', b.id, 'เงินสดประจำวัน ' || to_char(p_date, 'DD/MM/YYYY'), cash_lines);

  -- ---- Money we expect to land in the bank -------------------------------------
  bank := (select id from app.accounts where tenant_id = b.tenant_id and system_key = 'bank');
  insert into app.expected_receipts (tenant_id, branch_id, business_date, source_type, source_id, label, clearing_account_id, bank_account_id, expected_date, expected_amount)
  select b.tenant_id, b.id, p_date, 'card_batch', pm.id, pm.name || ' ' || to_char(p_date, 'DD/MM'),
         pm.ledger_account_id, coalesce(pm.settlement_account_id, bank), p_date + pm.settlement_days,
         sum(case when p.kind = 'payment' then p.amount else -p.amount end) - sum(p.fee_amount)
    from app.payments p join app.payment_methods pm on pm.id = p.method_id
   where p.branch_id = b.id and p.business_date = p_date and pm.kind = 'card'
   group by pm.id, pm.name, pm.ledger_account_id, pm.settlement_account_id, pm.settlement_days
  having sum(case when p.kind = 'payment' then p.amount else -p.amount end) - sum(p.fee_amount) <> 0;

  insert into app.expected_receipts (tenant_id, branch_id, business_date, source_type, source_id, label, clearing_account_id, bank_account_id, expected_date, expected_amount)
  select b.tenant_id, b.id, p_date, 'payment', p.id, pm.name || ' บิล ' || coalesce(o.receipt_no, o.order_no),
         pm.ledger_account_id, coalesce(pm.settlement_account_id, bank), p_date + pm.settlement_days, p.amount - p.fee_amount
    from app.payments p join app.payment_methods pm on pm.id = p.method_id join app.orders o on o.id = p.order_id
   where p.branch_id = b.id and p.business_date = p_date and p.kind = 'payment'
     and pm.kind in ('promptpay','ewallet','bank_transfer') and pm.ledger_account_id is distinct from coalesce(pm.settlement_account_id, bank);

  insert into app.expected_receipts (tenant_id, branch_id, business_date, source_type, source_id, label, clearing_account_id, bank_account_id, expected_date, expected_amount)
  select b.tenant_id, b.id, p_date, 'platform_payout', ch.id, ch.name || ' ' || to_char(p_date, 'DD/MM'),
         coalesce(ch.receivable_account_id, app.account_id(b.tenant_id, 'platform_receivable')), bank,
         p_date + ch.settlement_days,
         sum(o.total - o.commission_amount - o.commission_vat_amount)
    from app.orders o join app.sales_channels ch on ch.id = o.channel_id
   where o.branch_id = b.id and o.business_date = p_date and o.status = 'paid' and ch.kind = 'delivery_platform'
   group by ch.id, ch.name, ch.receivable_account_id, ch.settlement_days
  having sum(o.total - o.commission_amount - o.commission_vat_amount) <> 0;

  if existing.id is not null then
    update app.day_closes set status = 'closed', summary = summary, closed_by = app.actor_membership_id(b.tenant_id),
           closed_at = now(), note = p_note where id = existing.id;
  else
    insert into app.day_closes (tenant_id, branch_id, business_date, summary, closed_by, note)
    values (b.tenant_id, b.id, p_date, summary, app.actor_membership_id(b.tenant_id), p_note);
  end if;

  perform app.emit_event(b.tenant_id, b.id, 'day_close', b.id, 'finance.day_closed',
    summary || jsonb_build_object('business_date', p_date));
  return summary;
end;
$$;

-- Reopen a closed day: reverse its GL entries and drop unmatched expectations.
create or replace function app.reopen_business_day(p_branch uuid, p_date date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dc app.day_closes;
  je record;
begin
  select * into dc from app.day_closes where branch_id = p_branch and business_date = p_date for update;
  if not found or dc.status <> 'closed' then perform app.raise_error('DAY_NOT_CLOSED'); end if;
  perform app.assert_permission(dc.tenant_id, 'finance.manage', p_branch);
  if coalesce(trim(p_reason), '') = '' then perform app.raise_error('REASON_REQUIRED'); end if;
  if exists (select 1 from app.expected_receipts where branch_id = p_branch and business_date = p_date and status <> 'open') then
    perform app.raise_error('DAY_ALREADY_RECONCILED');
  end if;

  for je in select id from app.journal_entries
             where branch_id = p_branch and entry_date = p_date and source_type = 'day_close' and status = 'posted' and reversal_of is null
  loop
    perform app.reverse_journal(je.id, p_date, 'ยกเลิกปิดยอด: ' || p_reason);
  end loop;
  delete from app.expected_receipts where branch_id = p_branch and business_date = p_date and status = 'open';
  update app.day_closes set status = 'reopened', reopened_by = app.actor_membership_id(dc.tenant_id), reopened_at = now(),
         note = coalesce(note || E'\n', '') || 'เปิดใหม่: ' || p_reason
   where id = dc.id;
  perform app.emit_event(dc.tenant_id, p_branch, 'day_close', p_branch, 'finance.day_reopened',
    jsonb_build_object('business_date', p_date, 'reason', p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
call app.apply_tenant_rls('app.accounts', 'finance.view', 'finance.manage');
call app.apply_tenant_rls('app.bank_accounts', 'finance.view', 'finance.manage');
call app.apply_tenant_rls('app.tenant_sequences', 'settings.manage');
call app.apply_tenant_rls('app.journal_entries', 'finance.view');
call app.apply_tenant_rls('app.journal_lines', 'finance.view');
call app.apply_tenant_rls('app.bills', 'finance.view');
call app.apply_tenant_rls('app.bill_payments', 'finance.view');
call app.apply_tenant_rls('app.expenses', 'finance.view');
call app.apply_tenant_rls('app.expected_receipts', 'finance.view');
call app.apply_tenant_rls('app.statement_imports', 'finance.reconcile');
call app.apply_tenant_rls('app.statement_lines', 'finance.reconcile');
call app.apply_tenant_rls('app.reconciliation_matches', 'finance.reconcile');
