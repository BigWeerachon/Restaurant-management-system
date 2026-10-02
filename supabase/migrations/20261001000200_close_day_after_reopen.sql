-- =============================================================================
-- Sabai — a day that was reopened can be closed again.
--
-- `close_business_day` finished a reopened day with `update app.day_closes set ..., summary = summary, ...`: inside the function
-- `summary` is both the variable holding the new day's figures and a column of the table, and PostgreSQL refuses to guess
-- ("column reference \"summary\" is ambiguous"). Closing a day for the first time inserts instead, so it worked; closing it
-- AGAIN after `reopen_business_day` always failed — a reopened day could never be closed, and its sales could not be
-- booked. (Found by the first test of reopening a day, 003_transfers_and_reopen.sql.) The variable is now called `v_summary`.
-- Everything else is as it was in 20260927000700_finance.sql.
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
  v_summary jsonb;
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
    into v_summary
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
    update app.day_closes set status = 'closed', summary = v_summary, closed_by = app.actor_membership_id(b.tenant_id),
           closed_at = now(), note = p_note where id = existing.id;
  else
    insert into app.day_closes (tenant_id, branch_id, business_date, summary, closed_by, note)
    values (b.tenant_id, b.id, p_date, v_summary, app.actor_membership_id(b.tenant_id), p_note);
  end if;

  perform app.emit_event(b.tenant_id, b.id, 'day_close', b.id, 'finance.day_closed',
    v_summary || jsonb_build_object('business_date', p_date));
  return v_summary;
end;
$$;
