# ฐานข้อมูล (Database)

Postgres 16, เข้ากันได้กับ Supabase — **75 ตาราง (+ `audit.log`), 103 functions/commands, 7 views** ใน 26 migrations
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
| `20260928000100_kitchen_item_toggle` | — | `toggle_ticket_item`: ติ๊กทีละรายการบนตั๋วครัว (ครั้งแรกเริ่มตั๋วให้ด้วย) ตรงกับ engine ของเว็บ |
| `20260928000200_settings_commands` | — | `change_plan`: เปลี่ยนแพ็กเกจต้องผ่านคำสั่ง (ตาราง `subscriptions` ให้ `authenticated` อ่านอย่างเดียว) |
| `20260929000100_opening_stock` | — | `record_opening_stock`: ของที่มีอยู่แล้วตอนเพิ่มวัตถุดิบ บันทึกเป็น movement ชนิด `opening` เพื่อให้ ledger อธิบายได้ทุกกรัม |
| `20260929000200_emoji` | (คอลัมน์ `emoji` ใน menu_items, ingredients) | รูปที่พนักงานจำเมนู/วัตถุดิบได้ ไม่หายเมื่อโหลดใหม่ |
| `20260929000300_event_actor` | — | `emit_event` ระบุผู้กระทำจาก session ทุกเหตุการณ์ — ฟีดของเจ้าของไม่เขียนว่า "ระบบ" กับสิ่งที่คนทำ |
| `20260929000400_channel_markup` | (คอลัมน์ `price_markup` ใน sales_channels) | ราคาเมนูเดลิเวอรีสูงกว่าร้านได้ (ปัดขึ้นเป็น ฿5 — `resolve_menu_price` ตรงกับ `channelPrice` ใน domain, มีเทสต์ยึดไว้) |
| `20260929000500_change_plan_fits` | — | เปลี่ยนไปแพ็กเกจที่เล็กลงได้ก็ต่อเมื่อสาขา/พนักงานที่มีอยู่ยังอยู่ในขีดจำกัด (เหมือนที่ `enforce_plan_limits` กันตอนเพิ่ม) |
| `20260929000600_device_credentials` | device_credentials | ลงทะเบียนเครื่องร้าน: ความลับแสดงครั้งเดียว เก็บเฉพาะ SHA-256 ในตารางที่ผู้ใช้แอปอ่านไม่ได้; `register_device`/`revoke_device` (เจ้าของ/ผู้จัดการ), `device_roster`/`device_pin_login` (API เรียกแทนเครื่อง ไม่มีผู้ใช้) — เพิกถอนแล้วแท็บเล็ตที่หายใช้ไม่ได้ทันที |
| `20260929000700_receipt_settings` | (คอลัมน์ `receipt_footer` ใน tenants) | บรรทัดท้ายใบเสร็จ (ขอบคุณ, รหัส Wi-Fi, โปรโมชัน) |
| `20260929000800_tax_invoices` | tax_invoices (+ `devices.receipt_code`) | เลขใบเสร็จแยกต่อเครื่อง POS (`HQ-T1-YYMM-00001`); ใบกำกับภาษีเต็มรูปตามที่ลูกค้าขอ บิลละหนึ่งใบ ห้ามแก้/ลบ เก็บภาพถ่ายของผู้ขาย/ผู้ซื้อ ณ วันนั้น เลขเฉพาะ (`HQ-TI-YYMM-00001`) |
| `20260930000100_billing` | billing_events, billing_sequences (+ คอลัมน์ใหม่ใน subscriptions, subscription_invoices) | ใบแจ้งหนี้ค่าบริการ (เลข `INV-YYMM-00001`, เปิดค้างได้ครั้งละ 1 ใบต่อร้าน, แยก VAT 7/107), `billing_stage` (คำนวณจากเวลา ตรงกับ `billingStage` ใน domain), `request_plan_change`, `apply_billing_event` (บันทึกทุกเหตุการณ์จากผู้ให้บริการครั้งเดียว), `billing_run` (งานประจำวัน) |
| `20261001000100_transfer_receive_guard` | — (แก้ `receive_transfer`) | รับของโอนเกินที่ส่งมาไม่ได้ (`TRANSFER_OVER_RECEIVED`) — เดิมพิมพ์จำนวนเกินแล้วสต็อกปลายทางเพิ่มโดยต้นทางไม่ลด; รับน้อยกว่ายังได้ ส่วนต่างเป็นของเสียที่สาขาปลายทาง |
| `20261001000200_close_day_after_reopen` | — (แก้ `close_business_day`) | วันที่เปิดใหม่แล้ว (`reopen_business_day`) ปิดซ้ำได้ — เดิมล้มเสมอเพราะ `summary = summary` กำกวมระหว่างตัวแปรกับคอลัมน์ (ตัวแปรเปลี่ยนชื่อเป็น `v_summary`) |
| `20261001000300_hot_path_indexes` | index 7 ตัว | `kitchen_tickets (branch_id, status, fired_at)`, `kitchen_ticket_items (order_item_id)`, `payments (shift_id)`, `cash_movements (shift_id)`, `stock_balances (ingredient_id)`, `purchase_order_lines (ingredient_id)`, `expected_receipts (branch_id, business_date)` — เฉพาะ lookup ที่หน้าจอทำทั้งวันบนตารางที่โตตามยอดขาย (FK 68 จาก 132 ไม่มี index แต่ส่วนใหญ่ไม่จำเป็น เหตุผลที่เว้นไว้อยู่ในไฟล์ migration) |
| `20261001000400_fk_indexes_and_idempotency_purge` | index ของ foreign key ที่ยังไม่มี (ยกเว้น `stock_movements`, `journal_lines`), `purge_idempotency` | ทุก foreign key มี index นำหน้าด้วยคอลัมน์ของมัน (ไม่นับ `tenant_id`) — เทส `005_foreign_key_indexes.sql` ล้มถ้าตารางใหม่ลืม; `purge_idempotency` ลบแถว `api_idempotency` ที่เก่ากว่า 24 ชม. ทีละชุด (API รันทุก 60 นาที ตั้งด้วย `IDEMPOTENCY_PURGE_INTERVAL_MINUTES`, 0 = ปิด) |

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
| ค่าบริการค้างชำระไม่หยุดการขาย | `billing_stage` → `restricted` หลังช่วงผ่อนผัน 14 วัน หยุดได้เฉพาะ *เพิ่ม* สาขา/พนักงาน/เครื่อง (`enforce_plan_limits`) — `submit_order`/`pay_order`/ปิดยอด/รายงานไม่ตรวจสถานะค่าบริการเลย | `BILLING_RESTRICTED` + ขายและรับเงินได้ตามปกติ (SQL 4c, API e2e) |
| เหตุการณ์จากผู้ให้บริการนับครั้งเดียว | PK `(provider, event_id)` ใน `billing_events`; `paid` ซ้ำ → `duplicate`/`already_paid`, ยอดไม่ตรง → `amount_mismatch` (ไม่เปลี่ยนแพ็กเกจ), ใบที่ถูกแทนที่แล้วมีเงินเข้า → `needs_review` | SQL 4c, API e2e |

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
