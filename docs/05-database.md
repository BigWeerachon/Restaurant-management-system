# ฐานข้อมูล (Database)

Postgres 16, เข้ากันได้กับ Supabase — **72 ตาราง, 85 functions/commands, 7 views** ใน 12 migrations
([`supabase/migrations`](../supabase/migrations)) และ SQL end-to-end test ที่ [`packages/db/tests`](../packages/db/tests)

## 1. โครงสร้างตามโมดูล

| Migration | ตาราง | หน้าที่ |
|---|---|---|
| `0100_foundation` | `domain_events` | UUIDv7, `touch_row`, `forbid_mutation`, `raise_error(code)`, `emit_event` (outbox) |
| `0200_tenancy_identity` | tenants, brands, branches, profiles, permissions, roles, role_permissions, memberships, membership_branches, devices | ร้าน/สาขา (เวลาตัดวัน, service charge, เลขสาขาภาษี), สิทธิ์, สมาชิก (PIN-only ได้), helper สำหรับ RLS, กันลบเจ้าของคนสุดท้าย |
| `0300_catalog` | units, sales_channels, channel_commission_rates, payment_methods, kitchen_stations, menu_categories, menu_items, menu_item_prices, menu_item_availability, modifier_groups/options, menu_item_modifier_groups, dining_areas/tables | เมนู ราคาแยกช่องทาง/สาขา, GP มีวันเริ่ม-สิ้นสุด, สถานีครัว, โต๊ะ |
| `0400_inventory_recipes` | stock_locations, ingredient_categories, ingredients, recipes, recipe_lines, stock_movements, stock_balances, stock_counts/lines, stock_transfers/lines, production_batches | สูตรหลายชั้น (กันวนซ้ำ), ledger สต็อกห้ามแก้ + ต้นทุนเฉลี่ยเคลื่อนที่, นับแบบ blind, โอน, ผลิตของเตรียม |
| `0500_pos_kitchen` | day_closes, doc_sequences, approvals, shifts, cash_movements, orders, order_items, order_item_modifiers, payments, kitchen_tickets/items | วันทำการ, เลขเอกสารไม่ข้าม, อนุมัติด้วย PIN, กะ/ลิ้นชัก, บิล (snapshot ราคา), ชำระเงิน (ห้ามแก้), ตั๋วครัว |
| `0600_purchasing_inventory_ops` | suppliers, supplier_items, purchase_orders/lines, goods_receipts/lines | ผู้ขาย แพ็กที่ซื้อ, PO, รับของ (แจ้งราคาขึ้น > 5%), ของเสีย, นับ, โอน |
| `0700_finance` | accounts, bank_accounts, tenant_sequences, journal_entries/lines, bills, bill_payments, expenses, expected_receipts, statement_imports/lines, reconciliation_matches | บัญชีคู่ (ตรวจงบดุล), เจ้าหนี้ + WHT, ค่าใช้จ่ายมีงวดบริการ, ปิดยอด/เปิดใหม่, เงินที่ต้องเข้า, กระทบยอด |
| `0800_saas_billing` | plans, subscriptions, subscription_invoices, usage_counters | แพ็กเกจ/ขีดจำกัด บังคับด้วย trigger |
| `0900_audit` | audit.log | trigger บันทึกทุกการเปลี่ยนแปลงสำคัญ (ตัด `pin_hash`), ห้ามแก้ |
| `1000_reporting` | *(views)* | `v_stock_status`, `v_daily_sales`, `v_item_sales`, `v_menu_costing`, `v_reorder_suggestions`, `v_branch_daily_pnl`, `v_onboarding_facts` (ทั้งหมด `security_invoker`) |
| `1100_bootstrap` | — | สิทธิ์ 34 รายการ, ตำแหน่งเริ่มต้น 7 แบบ, ผังบัญชี SME ไทย, `create_tenant` (พร้อมขายทันที), `add_branch`, ปิดสิทธิ์ `public` |
| `1200_api_support` | api_idempotency | เก็บผลลัพธ์ต่อ Idempotency-Key, trigger → `pg_notify` |

## 2. Invariants (กฎที่ฐานข้อมูลบังคับเอง)

| กฎ | กลไก | เทสต์ |
|---|---|---|
| ข้อมูลไม่ข้ามร้าน | RLS ทุกตาราง + composite FK `(tenant_id, id)` | `B cannot read A orders`, `B cannot update A menu prices` |
| Ledger ห้ามแก้/ลบ | `forbid_mutation` บน stock_movements, payments, journal_lines, audit.log | `LEDGER_IMMUTABLE` |
| งบดุลเสมอ | deferred constraint trigger `check_entry_balanced` | `GL balanced`, `GL balanced after reopen` |
| สต็อกถูกต้องตามสูตร | `consume_order_stock` ใช้ `explode_recipe` (ของเตรียมหลายชั้น, ของที่ไม่ติดตามสต็อกคิดเป็นต้นทุนตรง) | e2e: ตัดนม/กาแฟ/น้ำเชื่อมตามสูตร |
| เลขใบเสร็จไม่ข้าม | `doc_sequences` ต่อสาขา/ประเภท/งวด (row lock) | e2e |
| วันที่ปิดแล้วแก้ไม่ได้ | `assert_period_open`; `business_date()` เลื่อนไปวันถัดไปอัตโนมัติ | `business date rolls forward after close` |
| ราคาไม่เชื่อ client | `submit_order` คำนวณจากเมนูใน DB (`resolve_menu_price` + modifier) | API parity test |
| ส่วนลดเกินวงเงินต้องอนุมัติ | `discount_cap` + `consume_approval` (ใช้ครั้งเดียว) | e2e: PIN cashier |
| ส่งซ้ำไม่ซ้ำ | order id สร้างบนเครื่อง (UUIDv7) + `pay_order` คืนผลเดิมถ้าจ่ายแล้ว + API idempotency store | `submit is idempotent` |
| มีเจ้าของร้านเสมอ | trigger `protect_last_owner` | `LAST_OWNER` |
| แพ็กเกจ | `enforce_plan_limits` (จำกัดการเพิ่ม ไม่ล็อกการขาย) | `PLAN_LIMIT_REACHED` (สาขาที่ 4 บนแพ็กเกจโปร) |

## 3. RLS pattern

```sql
-- สร้าง policy มาตรฐานให้ทุกตารางด้วยคำสั่งเดียว
call app.apply_tenant_rls('app.orders', 'pos.order', 'pos.order', 'branch_id');

-- policy ที่ได้ (ย่อ): ฟังก์ชันห่อด้วย (select …) → optimizer ทำ initPlan ครั้งเดียวต่อ query
using (
  tenant_id in (select app.tenants_with_permission('pos.order'))
  and branch_id in (select app.user_branch_ids())
)
```

- helper ทั้งหมดเป็น `security definer stable` + `set search_path = ''`
- ทุกคอลัมน์ที่ policy ใช้มี index (`tenant_id`, `branch_id`)
- API ทำ `set local role authenticated` + `set_config('request.jwt.claims', …, true)` ต่อ transaction → ใช้กับ PgBouncer transaction mode ได้

## 4. เงิน ภาษี และตัวเลข

- `numeric(14,2)` สำหรับเงิน, `numeric(14,4)` สำหรับปริมาณ/ต้นทุนต่อหน่วย
- VAT แยกออกจากราคารวม (`prices_include_vat`) ตามสูตรเดียวกับ `pricing.ts`: ราคา 145 → VAT 9.49
- Service charge คิดก่อน VAT และเฉพาะช่องทางที่กำหนด
- ค่าธรรมเนียมบัตร/อีวอลเล็ต เก็บต่อ payment (`fee_amount`) → เงินที่ต้องเข้าหักให้แล้ว
- GP: `commission_amount` + `commission_vat_amount` เก็บในบิล ณ อัตราวันที่ขาย

## 5. การรายงาน

- `v_branch_daily_pnl` = แหล่งตัวเลข "เหลือเงินจริง" ต่อสาขาต่อวัน
  (ยอดขายสุทธิ − ต้นทุนขาย − ของเสีย − ของหาย − GP − ค่าธรรมเนียม − ค่าใช้จ่ายที่ **กระจายตามงวดบริการ**)
- GL (journal) คือ book of record; views คือ operating read model ที่อ่านง่ายและเร็ว
- เมื่อข้อมูลโต: materialize view เป็นตาราง rollup รายวัน refresh ตอนปิดยอด (ดู [04-architecture.md](04-architecture.md#6-เส้นทางการเติบโต-growth-path))

## 6. การทดสอบ

```bash
pg_ctlcluster 16 main start          # หรือ Postgres 16 ใดก็ได้
pnpm db:test                         # สร้าง sabai_test ใหม่ทั้งหมด → รันทุก migration → รัน tests/*.sql
```

`001_end_to_end.sql` เล่าเรื่องร้าน 2 ร้านตั้งแต่สมัคร → ตั้งเมนู/สูตร → รับของ → เปิดกะ → ขาย/VAT/เงินทอน → ตัดสต็อก →
KDS เรียกคืน → แคชเชียร์ PIN + อนุมัติ → ของเสีย → นับแบบ blind → ปิดกะ (ขาด 5 บาท) → ปิดยอด → งบดุล → เปิดวันใหม่ →
ค่าใช้จ่ายกระจายตามงวด → กันลบเจ้าของคนสุดท้าย → แยกข้อมูลข้ามร้าน → audit → ขีดจำกัดแพ็กเกจ
