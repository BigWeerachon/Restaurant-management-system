-- =============================================================================
-- Sabai — Bootstrap: permission catalog, role templates, chart of accounts,
-- tenant/branch creation with smart defaults, privilege hardening.
--
-- The permission catalog mirrors packages/domain/src/permissions.ts; an API
-- integration test fails if the two drift apart.
-- =============================================================================

insert into app.permissions (key, module, name_th, name_en, risk, sort) values
  ('pos.order',          'pos',        'รับออเดอร์',                     'Take orders',                 'low',    10),
  ('pos.pay',            'pos',        'รับชำระเงินและเปิด-ปิดกะ',          'Take payments & run shifts',  'medium', 11),
  ('pos.discount',       'pos',        'ให้ส่วนลด',                       'Give discounts',              'medium', 12),
  ('pos.void',           'pos',        'ยกเลิกรายการที่ส่งครัวแล้ว',          'Void items sent to kitchen',  'high',   13),
  ('pos.refund',         'pos',        'คืนเงินลูกค้า',                    'Refund customers',            'high',   14),
  ('pos.manage_shift',   'pos',        'นำเงินเข้า-ออกลิ้นชัก',              'Cash in / cash out',          'medium', 15),
  ('kds.view',           'kds',        'ดูจอครัว',                        'View kitchen display',        'low',    20),
  ('kds.bump',           'kds',        'อัปเดตสถานะอาหาร',                 'Bump kitchen tickets',        'low',    21),
  ('menu.manage',        'menu',       'แก้ไขเมนูและราคา',                 'Manage menu & prices',        'medium', 30),
  ('menu.availability',  'menu',       'ปิด-เปิดเมนูที่ของหมด',             'Mark items sold out',         'low',    31),
  ('recipes.view',       'recipes',    'ดูสูตรอาหาร',                     'View recipes',                'low',    40),
  ('recipes.manage',     'recipes',    'แก้ไขสูตรอาหาร',                  'Manage recipes',              'medium', 41),
  ('costs.view',         'recipes',    'ดูต้นทุนและกำไรต่อจาน',             'View costs & margins',        'medium', 42),
  ('inventory.view',     'inventory',  'ดูสต็อก',                         'View stock',                  'low',    50),
  ('inventory.manage',   'inventory',  'เพิ่ม-แก้ไขรายการวัตถุดิบ',           'Manage ingredients',          'medium', 51),
  ('inventory.receive',  'inventory',  'รับของเข้า',                       'Receive goods',               'low',    52),
  ('inventory.count',    'inventory',  'นับสต็อก',                        'Count stock',                 'low',    53),
  ('inventory.adjust',   'inventory',  'อนุมัติปรับยอดสต็อก',                'Approve stock adjustments',   'high',   54),
  ('inventory.waste',    'inventory',  'บันทึกของเสีย',                    'Record waste',                'low',    55),
  ('inventory.transfer', 'inventory',  'โอนย้ายสต็อกระหว่างสาขา',            'Transfer stock',              'medium', 56),
  ('inventory.produce',  'inventory',  'ผลิตของเตรียม',                     'Produce prep batches',        'low',    57),
  ('purchasing.view',    'purchasing', 'ดูใบสั่งซื้อและผู้ขาย',               'View purchasing',             'low',    60),
  ('purchasing.manage',  'purchasing', 'สร้างใบสั่งซื้อและจัดการผู้ขาย',        'Manage POs & suppliers',      'medium', 61),
  ('purchasing.approve', 'purchasing', 'อนุมัติใบสั่งซื้อ',                  'Approve purchase orders',     'high',   62),
  ('finance.view',       'finance',    'ดูข้อมูลการเงิน',                   'View finance',                'medium', 70),
  ('finance.manage',     'finance',    'บันทึกค่าใช้จ่ายและจ่ายบิล',           'Expenses & bill payments',    'high',   71),
  ('finance.reconcile',  'finance',    'กระทบยอดธนาคารและแพลตฟอร์ม',        'Reconcile bank & platforms',  'high',   72),
  ('finance.close_day',  'finance',    'ปิดยอดประจำวัน',                   'Close the business day',      'medium', 73),
  ('reports.sales',      'reports',    'ดูรายงานยอดขาย',                   'View sales reports',          'low',    80),
  ('reports.profit',     'reports',    'ดูรายงานกำไรและเงินเหลือจริง',        'View profit reports',         'medium', 81),
  ('staff.manage',       'admin',      'จัดการพนักงานและสิทธิ์',              'Manage staff & roles',        'high',   90),
  ('settings.manage',    'admin',      'ตั้งค่าร้านและสาขา',                 'Manage settings',             'high',   91),
  ('billing.manage',     'admin',      'จัดการแพ็กเกจและค่าบริการ',           'Manage subscription',         'high',   92),
  ('audit.view',         'admin',      'ดูประวัติการใช้งาน',                 'View activity log',           'medium', 93);

-- -----------------------------------------------------------------------------
-- Role templates — every role lands on the one screen it works in.
-- -----------------------------------------------------------------------------
create or replace function app.install_default_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.roles (tenant_id, key, name, description, grants_all, is_system, home, color, sort) values
    (p_tenant, 'owner',      'เจ้าของร้าน',     'เห็นและทำได้ทุกอย่าง',                         true,  true, 'today',     'violet',  1),
    (p_tenant, 'manager',    'ผู้จัดการร้าน',    'ดูแลหน้าร้าน สต็อก ทีม และปิดยอด',               false, true, 'today',     'indigo',  2),
    (p_tenant, 'cashier',    'แคชเชียร์',       'รับออเดอร์ รับเงิน เปิด-ปิดกะ',                  false, true, 'pos',       'emerald', 3),
    (p_tenant, 'waiter',     'พนักงานเสิร์ฟ',    'รับออเดอร์และส่งเข้าครัว',                       false, true, 'pos',       'sky',     4),
    (p_tenant, 'kitchen',    'ครัว',           'ดูออเดอร์ อัปเดตสถานะ บันทึกของเสีย',             false, true, 'kds',       'orange',  5),
    (p_tenant, 'stock',      'สต็อก/จัดซื้อ',    'รับของ นับสต็อก สั่งซื้อ',                        false, true, 'inventory', 'amber',   6),
    (p_tenant, 'accountant', 'บัญชี',           'ค่าใช้จ่าย จ่ายบิล กระทบยอด รายงาน',             false, true, 'finance',   'rose',    7);

  insert into app.role_permissions (tenant_id, role_id, permission_key)
  select p_tenant, r.id, x.perm
    from app.roles r
    join (values
      ('manager','pos.order'),('manager','pos.pay'),('manager','pos.discount'),('manager','pos.void'),('manager','pos.refund'),
      ('manager','pos.manage_shift'),('manager','kds.view'),('manager','kds.bump'),('manager','menu.manage'),
      ('manager','menu.availability'),('manager','recipes.view'),('manager','recipes.manage'),('manager','costs.view'),
      ('manager','inventory.view'),('manager','inventory.manage'),('manager','inventory.receive'),('manager','inventory.count'),
      ('manager','inventory.adjust'),('manager','inventory.waste'),('manager','inventory.transfer'),('manager','inventory.produce'),
      ('manager','purchasing.view'),('manager','purchasing.manage'),('manager','purchasing.approve'),
      ('manager','finance.close_day'),('manager','reports.sales'),('manager','reports.profit'),('manager','staff.manage'),
      ('manager','audit.view'),
      ('cashier','pos.order'),('cashier','pos.pay'),('cashier','pos.discount'),('cashier','pos.manage_shift'),
      ('cashier','kds.view'),('cashier','menu.availability'),
      ('waiter','pos.order'),('waiter','kds.view'),
      ('kitchen','kds.view'),('kitchen','kds.bump'),('kitchen','menu.availability'),('kitchen','recipes.view'),
      ('kitchen','inventory.view'),('kitchen','inventory.waste'),('kitchen','inventory.produce'),
      ('stock','inventory.view'),('stock','inventory.manage'),('stock','inventory.receive'),('stock','inventory.count'),
      ('stock','inventory.waste'),('stock','inventory.transfer'),('stock','inventory.produce'),('stock','recipes.view'),
      ('stock','purchasing.view'),('stock','purchasing.manage'),
      ('accountant','finance.view'),('accountant','finance.manage'),('accountant','finance.reconcile'),
      ('accountant','finance.close_day'),('accountant','reports.sales'),('accountant','reports.profit'),
      ('accountant','costs.view'),('accountant','inventory.view'),('accountant','purchasing.view'),('accountant','audit.view')
    ) as x(role_key, perm) on x.role_key = r.key
   where r.tenant_id = p_tenant;
end;
$$;

-- -----------------------------------------------------------------------------
-- Chart of accounts (Thai SME, simplified; accountants can extend it).
-- -----------------------------------------------------------------------------
create or replace function app.install_chart_of_accounts(p_tenant uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.accounts (tenant_id, code, name, name_en, type, system_key) values
    (p_tenant, '1010', 'เงินสดในลิ้นชัก',              'Cash on hand',                 'asset',     'cash_on_hand'),
    (p_tenant, '1020', 'เงินฝากธนาคาร',               'Bank',                         'asset',     'bank'),
    (p_tenant, '1030', 'พักรับชำระบัตร',               'Card clearing',                'asset',     'card_clearing'),
    (p_tenant, '1040', 'พักรับชำระพร้อมเพย์/QR',        'QR clearing',                  'asset',     'qr_clearing'),
    (p_tenant, '1050', 'พักรับชำระ e-Wallet',          'E-wallet clearing',            'asset',     'ewallet_clearing'),
    (p_tenant, '1110', 'ลูกหนี้แพลตฟอร์มเดลิเวอรี',        'Delivery platform receivable', 'asset',     'platform_receivable'),
    (p_tenant, '1120', 'ลูกหนี้การค้า',                 'Accounts receivable',          'asset',     'accounts_receivable'),
    (p_tenant, '1150', 'ภาษีซื้อ',                     'Input VAT',                    'asset',     'vat_input'),
    (p_tenant, '1200', 'สินค้าและวัตถุดิบคงเหลือ',         'Inventory',                    'asset',     'inventory'),
    (p_tenant, '1210', 'สินค้าระหว่างโอน',               'Inventory in transit',         'asset',     'inventory_in_transit'),
    (p_tenant, '1300', 'พักเงินสดย่อย',                'Petty cash clearing',          'asset',     'petty_cash_clearing'),
    (p_tenant, '2010', 'เจ้าหนี้การค้า',                 'Accounts payable',             'liability', 'accounts_payable'),
    (p_tenant, '2020', 'ภาษีขาย',                     'Output VAT',                   'liability', 'vat_output'),
    (p_tenant, '2030', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',        'Withholding tax payable',      'liability', 'wht_payable'),
    (p_tenant, '2050', 'เงินรับล่วงหน้า/บัตรกำนัล',        'Customer deposits & vouchers', 'liability', 'customer_deposits'),
    (p_tenant, '3010', 'ทุนเจ้าของ',                   'Owner equity',                 'equity',    'owner_equity'),
    (p_tenant, '3020', 'กำไรสะสม',                    'Retained earnings',            'equity',    'retained_earnings'),
    (p_tenant, '4010', 'รายได้จากการขาย',              'Sales revenue',                'revenue',   'sales_revenue'),
    (p_tenant, '4020', 'รายได้ค่าบริการ',               'Service charge revenue',       'revenue',   'service_charge_revenue'),
    (p_tenant, '4090', 'รับคืน/คืนเงินลูกค้า',            'Sales refunds',                'revenue',   'sales_refunds'),
    (p_tenant, '4900', 'รายได้อื่น',                    'Other income',                 'revenue',   'other_income'),
    (p_tenant, '5010', 'ต้นทุนขาย (วัตถุดิบ)',            'Cost of goods sold',           'expense',   'cogs'),
    (p_tenant, '5020', 'ของเสีย',                     'Waste',                        'expense',   'waste_expense'),
    (p_tenant, '5030', 'ผลต่างสต็อก',                  'Inventory variance',           'expense',   'inventory_variance'),
    (p_tenant, '6010', 'ค่า GP แพลตฟอร์ม',             'Platform commission',          'expense',   'commission_expense'),
    (p_tenant, '6020', 'ค่าธรรมเนียมรับชำระเงิน',          'Payment fees',                 'expense',   'payment_fee_expense'),
    (p_tenant, '6030', 'เงินสดขาด/เกิน',               'Cash over/short',              'expense',   'cash_over_short'),
    (p_tenant, '6100', 'เงินเดือนและค่าแรง',             'Salaries & wages',             'expense',   'salaries'),
    (p_tenant, '6110', 'ค่าเช่า',                      'Rent',                         'expense',   'rent'),
    (p_tenant, '6120', 'ค่าน้ำ ค่าไฟ ค่าแก๊ส',           'Utilities',                    'expense',   'utilities'),
    (p_tenant, '6130', 'การตลาดและโฆษณา',             'Marketing',                    'expense',   'marketing'),
    (p_tenant, '6140', 'วัสดุสิ้นเปลือง',                'Supplies',                     'expense',   'supplies'),
    (p_tenant, '6150', 'ซ่อมแซมและบำรุงรักษา',           'Repairs & maintenance',        'expense',   'repairs'),
    (p_tenant, '6190', 'ค่าใช้จ่ายอื่น',                 'Other expenses',               'expense',   'other_expense')
$$;

-- -----------------------------------------------------------------------------
-- Branch setup with smart defaults (stock location + kitchen stations).
-- -----------------------------------------------------------------------------
create or replace function app.setup_branch_defaults(p_tenant uuid, p_branch uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.stock_locations (tenant_id, branch_id, name, kind, is_default)
  values (p_tenant, p_branch, 'คลังหลัก', 'store', true);
  insert into app.kitchen_stations (tenant_id, branch_id, name, route_key, color, warn_after_sec, late_after_sec, sort) values
    (p_tenant, p_branch, 'ครัว', 'kitchen', 'orange', 480, 900, 1),
    (p_tenant, p_branch, 'บาร์เครื่องดื่ม', 'bar', 'sky', 240, 480, 2);
$$;

-- Self-serve signup. Called by the signed-in owner (or by the API with service
-- role and an explicit owner_user_id). Returns everything the UI needs to
-- continue straight into the onboarding checklist.
-- p: {name, business_type?, branch_name?, owner_name, owner_user_id?, vat_registered?, prices_include_vat?}
create or replace function app.create_tenant(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_user uuid := coalesce(app.current_user_id(), nullif(p->>'owner_user_id', '')::uuid);
  t app.tenants;
  br uuid;
  owner_role uuid;
  mem uuid;
begin
  if owner_user is null then perform app.raise_error('AUTH_REQUIRED'); end if;
  if coalesce(trim(p->>'name'), '') = '' then perform app.raise_error('VALIDATION', jsonb_build_object('field', 'name')); end if;

  insert into app.tenants (name, business_type, vat_registered, prices_include_vat)
  values (trim(p->>'name'), coalesce(nullif(p->>'business_type', ''), 'restaurant'),
          coalesce((p->>'vat_registered')::boolean, false), coalesce((p->>'prices_include_vat')::boolean, true))
  returning * into t;

  insert into app.subscriptions (tenant_id, plan_code, status, trial_ends_at, current_period_start, current_period_end)
  values (t.id, 'pro', 'trialing', now() + interval '14 days', now(), now() + interval '14 days');

  insert into app.brands (tenant_id, name, is_default) values (t.id, t.name, true);
  perform app.install_default_roles(t.id);
  perform app.install_chart_of_accounts(t.id);

  insert into app.profiles (id, display_name)
  values (owner_user, coalesce(nullif(p->>'owner_name', ''), 'เจ้าของร้าน'))
  on conflict (id) do nothing;

  select id into owner_role from app.roles where tenant_id = t.id and key = 'owner';
  insert into app.memberships (tenant_id, user_id, display_name, role_id, status, joined_at)
  values (t.id, owner_user, coalesce(nullif(p->>'owner_name', ''), 'เจ้าของร้าน'), owner_role, 'active', now())
  returning id into mem;

  insert into app.branches (tenant_id, code, name)
  values (t.id, 'HQ', coalesce(nullif(p->>'branch_name', ''), 'สาขาหลัก'))
  returning id into br;
  perform app.setup_branch_defaults(t.id, br);

  -- Money in: cash works on day one; the others are pre-filled and switched on in the wizard.
  insert into app.payment_methods (tenant_id, kind, name, icon, fee_rate, opens_drawer, requires_reference, ledger_account_id, settlement_account_id, settlement_days, is_active, sort)
  select t.id, x.kind, x.name, x.icon, x.fee_rate, x.opens_drawer, x.requires_ref,
         (select id from app.accounts where tenant_id = t.id and system_key = x.ledger),
         (select id from app.accounts where tenant_id = t.id and system_key = 'bank'),
         x.settle_days, x.active, x.sort
    from (values
      ('cash',      'เงินสด',            'banknote',   0,      true,  false, 'cash_on_hand',        0, true,  1),
      ('promptpay', 'พร้อมเพย์ (QR)',     'qr-code',    0,      false, false, 'qr_clearing',         0, false, 2),
      ('card',      'บัตรเครดิต/เดบิต',   'credit-card', 0.02,  false, true,  'card_clearing',       2, false, 3),
      ('ewallet',   'TrueMoney Wallet',  'wallet',     0.015,  false, false, 'ewallet_clearing',    1, false, 4),
      ('platform',  'ชำระผ่านแพลตฟอร์ม',   'bike',       0,      false, false, 'platform_receivable', 7, true,  5)
    ) as x(kind, name, icon, fee_rate, opens_drawer, requires_ref, ledger, settle_days, active, sort);

  insert into app.sales_channels (tenant_id, key, kind, name, color, icon, applies_service_charge, commission_rate, settlement_days, is_active, sort)
  values
    (t.id, 'dine_in',    'dine_in',           'ทานที่ร้าน',  'emerald', 'utensils',     true,  0,    0, true,  1),
    (t.id, 'takeaway',   'takeaway',          'กลับบ้าน',   'sky',     'shopping-bag', false, 0,    0, true,  2),
    (t.id, 'grabfood',   'delivery_platform', 'GrabFood',  'green',   'bike',         false, 0.30, 7, false, 3),
    (t.id, 'lineman',    'delivery_platform', 'LINE MAN',  'lime',    'bike',         false, 0.30, 7, false, 4),
    (t.id, 'shopeefood', 'delivery_platform', 'ShopeeFood', 'orange', 'bike',         false, 0.30, 7, false, 5),
    (t.id, 'robinhood',  'delivery_platform', 'Robinhood', 'violet',  'bike',         false, 0,    3, false, 6);

  insert into app.ingredient_categories (tenant_id, name, sort) values
    (t.id, 'เนื้อสัตว์', 1), (t.id, 'ผักและผลไม้', 2), (t.id, 'ของแห้งและเครื่องปรุง', 3),
    (t.id, 'นมและเครื่องดื่ม', 4), (t.id, 'บรรจุภัณฑ์', 5);

  perform app.emit_event(t.id, br, 'tenant', t.id, 'tenant.created', jsonb_build_object('name', t.name), mem);
  return jsonb_build_object('tenant_id', t.id, 'branch_id', br, 'membership_id', mem);
end;
$$;

-- p: {code, name, kind?, address?, phone?, day_cutoff?, service_charge_rate?}
create or replace function app.add_branch(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid := (p->>'tenant_id')::uuid;
  br uuid;
begin
  perform app.assert_permission(t, 'settings.manage');
  if (select count(*) from app.branches where tenant_id = t and archived_at is null) >= 1
     and not app.has_feature(t, 'multi_branch') then
    perform app.raise_error('FEATURE_NOT_IN_PLAN', jsonb_build_object('feature', 'multi_branch'));
  end if;
  insert into app.branches (tenant_id, code, name, kind, address, phone, day_cutoff, service_charge_rate)
  values (t, upper(p->>'code'), p->>'name', coalesce(nullif(p->>'kind', ''), 'outlet'), nullif(p->>'address', ''),
          nullif(p->>'phone', ''), coalesce(nullif(p->>'day_cutoff', '')::time, '05:00'),
          coalesce(nullif(p->>'service_charge_rate', '')::numeric, 0))
  returning id into br;
  perform app.setup_branch_defaults(t, br);
  perform app.emit_event(t, br, 'branch', br, 'branch.created', jsonb_build_object('name', p->>'name'));
  return br;
end;
$$;

-- =============================================================================
-- Privilege hardening
--   * Nothing in `app` is callable by PUBLIC/anon.
--   * Signed-in users may call commands and the helpers RLS policies need.
--   * Internal building blocks (posting, numbering, stock consumption, …) are
--     only reachable through the commands that authorise them.
-- =============================================================================
revoke all on all functions in schema app from public;
revoke all on all procedures in schema app from public;
alter default privileges in schema app revoke execute on functions from public;
grant execute on all functions in schema app to authenticated;

revoke execute on function
  app.post_journal(uuid, uuid, date, text, uuid, text, jsonb),
  app.reverse_journal(uuid, date, text),
  app.post_goods_receipt(uuid),
  app.fire_order(uuid),
  app.recalc_order(uuid),
  app.consume_order_stock(uuid, int, text),
  app.consume_approval(uuid, text, uuid, uuid),
  app.next_doc_no(uuid, text, text),
  app.next_tenant_doc_no(uuid, text, text),
  app.emit_event(uuid, uuid, text, uuid, text, jsonb, uuid),
  app.install_default_roles(uuid),
  app.install_chart_of_accounts(uuid),
  app.setup_branch_defaults(uuid, uuid),
  app.apply_stock_movement(),
  app.enforce_plan_limits(),
  app.check_entry_balanced()
from authenticated;
revoke all on procedure app.apply_tenant_rls(regclass, text, text, text) from authenticated;

revoke all on function audit.capture() from public;
