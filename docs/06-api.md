# API

HTTP JSON API (Hono บน Node 22) — **88 endpoints + SSE** ครอบคลุมทุกโมดูล
เอกสาร OpenAPI 3.1 สร้างอัตโนมัติจาก zod contracts ที่ `GET /v1/openapi.json` (ไม่มีทางไม่ตรงกับ validation จริง)

## หลักการ

| เรื่อง | ข้อกำหนด |
|---|---|
| **ชั้นบาง** | handler = ตรวจสิทธิ์ → validate (zod) → เรียก SQL command 1 ตัว → คืนผล; ตรรกะธุรกิจอยู่ใน DB/`domain` |
| **Auth** | `Authorization: Bearer <JWT>` (Supabase-compatible); พนักงานบนเครื่องร้านได้ token จาก `POST /v1/auth/pin` |
| **Tenant** | endpoint ระดับร้านต้องส่ง `X-Tenant-Id` (ผู้ใช้หนึ่งคนอยู่ได้หลายร้าน) |
| **RLS ทุก request** | transaction ใหม่ต่อ request → `set local role authenticated` + JWT claims → ข้อมูลที่เห็นถูกกรองโดย Postgres |
| **Idempotency** | คำสั่งที่มีผลกับเงิน/สต็อกรับ `Idempotency-Key`; ส่งซ้ำได้ผลเดิม (เก็บใน `app.api_idempotency`) |
| **ภาษา** | `Accept-Language: th` (ค่าเริ่มต้น) หรือ `en` — ข้อความ error เปลี่ยนตาม |
| **Request id** | ทุก response มี `X-Request-Id`; error มี `reference` สั้นให้ลูกค้าแจ้ง support |
| **Rate limit** | PIN สลับผู้ใช้/อนุมัติ 10 ครั้ง/นาที/ที่อยู่และสาขา (ตั้งได้ด้วย `PIN_ATTEMPTS_PER_MINUTE` — อย่าเพิ่มบน production), PIN บนเครื่องร้านที่ลงทะเบียนแล้ว 10 ครั้ง/นาที/เครื่อง → `RATE_LIMITED` (429) พร้อม `retry_after_s` |
| **เงิน** | ส่ง/รับเป็นสตริงทศนิยม 2 ตำแหน่ง (`"145.00"`) ไม่ใช้ float |
| **วันที่** | ISO `YYYY-MM-DD` = วันทำการ (business date) ไม่ใช่วันตามปฏิทิน |

## Error envelope (ภาษาคน ไม่มีรายละเอียดเทคนิค)

```json
{
  "error": {
    "code": "OPEN_SHIFTS_EXIST",
    "title": "ยังมีกะที่ยังไม่ปิด",
    "message": "ปิดกะและนับเงินสด 1 กะก่อน แล้วค่อยปิดยอดวัน",
    "action": "fix_input",
    "actionLabel": "ไปปิดกะ",
    "severity": "warning",
    "reference": "9F3A-1C2B"
  }
}
```

- `code` มาจาก `ERROR_CATALOG` (ไทย/อังกฤษ) — error จาก Postgres ถูกแปลงด้วย `codeFromDatabaseError`
- validation error คืน `fields` ต่อช่อง เพื่อให้ฟอร์มแสดงข้อความใต้ช่องได้ทันที
- มี test ยืนยันว่า SQL/stack trace/คำว่า postgres ไม่หลุดไปถึงผู้ใช้

## Realtime

`GET /v1/events` (Server-Sent Events) — event จาก outbox (`order.created`, `kitchen.ticket_updated`, `order.paid`, `inventory.price_alert` …)
กรองตามร้าน/สาขาที่ผู้ใช้มีสิทธิ์ ใช้ขับเคลื่อน KDS และหน้า "วันนี้"

## Endpoints

**Finance**

| Method | Path | ทำอะไร |
|---|---|---|
| `POST` | `/v1/days/{date}/close` | ปิดยอดประจำวัน: สรุปยอด ลงบัญชี และสร้างรายการเงินที่ต้องเข้าธนาคาร |
| `POST` | `/v1/days/{date}/reopen` | เปิดวันที่ปิดยอดแล้วเพื่อแก้ไข (กลับรายการบัญชีให้อัตโนมัติ) |
| `POST` | `/v1/expenses` | บันทึกค่าใช้จ่าย (จ่ายแล้วหรือค้างจ่าย) |
| `GET` | `/v1/bills` | บิลค้างจ่าย เรียงตามวันครบกำหนด |
| `POST` | `/v1/bills/{id}/pay` | จ่ายบิล (บางส่วนได้) |
| `POST` | `/v1/bank-statements` | นำเข้ารายการเดินบัญชี (ซ้ำได้ ระบบกันรายการซ้ำให้) |
| `GET` | `/v1/reconciliation` | รายการเงินที่ควรเข้า vs เงินที่เข้าจริง พร้อมคู่ที่ระบบแนะนำ |
| `POST` | `/v1/statement-lines/{id}/match` | ยืนยันการจับคู่ (บันทึกส่วนต่างให้อัตโนมัติ) |
| `POST` | `/v1/statement-lines/{id}/ignore` | ข้ามรายการที่ไม่เกี่ยวกับการขาย (เช่น โอนเงินส่วนตัว) |
| `GET` | `/v1/expenses` | ค่าใช้จ่ายที่บันทึกไว้ (เรียงตามวันที่) (สิทธิ์ `finance.view`) |
| `GET` | `/v1/days` | ประวัติการปิดยอดประจำวัน (สิทธิ์ `finance.view`) |

**Identity**

| Method | Path | ทำอะไร |
|---|---|---|
| `POST` | `/v1/tenants` | สมัครใช้งาน: สร้างร้านพร้อมค่าเริ่มต้นที่พร้อมขาย |
| `GET` | `/v1/me` | ฉันคือใคร อยู่ร้านไหน ทำอะไรได้บ้าง และควรเริ่มที่หน้าไหน |
| `POST` | `/v1/auth/pin` | สลับผู้ใช้บนเครื่องร้านด้วย PIN (ไม่ต้องมีอีเมล) |
| `POST` | `/v1/approvals` | ผู้จัดการอนุมัติด้วย PIN (ใช้ได้ครั้งเดียวภายใน 5 นาที) |
| `POST` | `/v1/auth/device-pin` | เข้าด้วย PIN บนเครื่องร้านที่ลงทะเบียนแล้ว (ไม่ต้องมีบัญชีอีเมลบนเครื่อง) |

**Insights**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/reports/summary` | อะไรขายดี ขายที่ไหน ช่องทางไหน และเหลือเงินจริงเท่าไร |
| `GET` | `/v1/activity` | ใครทำอะไร เมื่อไร (ยกเลิก ส่วนลด คืนเงิน ปรับสต็อก) |
| `GET` | `/v1/reports/today` | ยอดวันนี้ เทียบกับสัปดาห์ก่อนเวลาเดียวกัน พร้อมกราฟ 14 วันย้อนหลัง |

**Inventory**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/ingredients` | รายการวัตถุดิบ |
| `POST` | `/v1/ingredients` | เพิ่มวัตถุดิบ (หน่วยพื้นฐาน กรัม/มล./ชิ้น) |
| `GET` | `/v1/stock` | สต็อกคงเหลือพร้อมสถานะ (หมด/ใกล้หมด/ติดลบ) และยอดที่ขายตัดสต็อกในสัปดาห์ที่ผ่านมา (`usage_7d`) |
| `POST` | `/v1/receipts` | รับของเข้า (มีหรือไม่มีใบสั่งซื้อก็ได้) |
| `POST` | `/v1/waste` | บันทึกของเสีย (ไม่ถึง 10 วินาที) |
| `POST` | `/v1/stock-counts` | เริ่มนับสต็อก (โหมดนับแบบไม่เห็นยอดระบบ) |
| `GET` | `/v1/stock-counts/{id}` | รายการนับสต็อก |
| `PUT` | `/v1/stock-counts/{id}/lines` | บันทึกจำนวนที่นับได้ (ทีละรายการ บันทึกอัตโนมัติ) |
| `POST` | `/v1/stock-counts/{id}/submit` | ส่งผลการนับ |
| `POST` | `/v1/stock-counts/{id}/approve` | อนุมัติและปรับยอดสต็อกตามที่นับได้ |
| `POST` | `/v1/transfers` | สร้างใบโอนสต็อก (ครัวกลาง → สาขา) |
| `POST` | `/v1/transfers/{id}/send` | ยืนยันส่งของ |
| `POST` | `/v1/transfers/{id}/receive` | รับของที่โอนมา (ของขาด = บันทึกเป็นของเสียให้อัตโนมัติ) |
| `GET` | `/v1/stock-movements` | ความเคลื่อนไหวสต็อกล่าสุด (รับของ ขาย ของเสีย ปรับยอด โอน) (สิทธิ์ `inventory.view`) |
| `GET` | `/v1/receipts` | ประวัติการรับของ (สิทธิ์ `inventory.view`) |
| `GET` | `/v1/stock-counts` | ประวัติการนับสต็อก (สิทธิ์ `inventory.count`) |

**Kitchen**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/kds/tickets` | ตั๋วที่ครัวต้องทำ (+ที่เพิ่งเสร็จ เผื่อกดพลาดเรียกคืนได้) |
| `POST` | `/v1/kds/tickets/{id}/status` | เริ่มทำ / เสร็จแล้ว / เรียกคืน |
| `POST` | `/v1/kds/ticket-items/{id}/toggle` | เสร็จ/ยังไม่เสร็จ เฉพาะรายการนี้ในตั๋ว (ไม่กระทบรายการอื่น) (สิทธิ์ `kds.bump`) |

**Menu**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/catalog` | ทุกอย่างที่หน้าขายต้องใช้ในคำขอเดียว (แคชไว้ขายออฟไลน์ได้) |
| `POST` | `/v1/menu-items` | เพิ่มเมนู (พร้อมสูตรในขั้นตอนเดียวได้) |
| `GET` | `/v1/menu-items/{id}/costing` | ต้นทุนต่อจาน สัดส่วนต้นทุน และราคาแนะนำ |
| `POST` | `/v1/menu-items/{id}/availability` | ของหมด / เปิดขายอีกครั้ง (ต่อสาขา) |
| `PATCH` | `/v1/menu-items/{id}` | แก้ไขเมนู (ชื่อ ราคา เส้นทางครัว สถานะ หรือสูตร) (สิทธิ์ `menu.manage`) |

**Onboarding**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/onboarding` | ความคืบหน้าการเริ่มต้นใช้งาน (คำนวณจากข้อมูลจริง) |
| `POST` | `/v1/onboarding/skip` | ข้ามขั้นตอนที่ไม่บังคับ |

**POS**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/shifts/current` | กะที่เปิดอยู่ของสาขา (พร้อมเงินสดที่ควรมีในลิ้นชัก) |
| `POST` | `/v1/shifts` | เปิดกะ |
| `POST` | `/v1/shifts/{id}/close` | ปิดกะและนับเงินสด |
| `POST` | `/v1/shifts/{id}/cash-movements` | นำเงินเข้า/ออกลิ้นชัก |
| `POST` | `/v1/orders` | ส่งออเดอร์ (สร้างใหม่หรือเพิ่มรายการ) — ปลอดภัยต่อการส่งซ้ำ |
| `GET` | `/v1/orders` | บิลของวัน (ค่าเริ่มต้น: วันทำการปัจจุบัน) |
| `GET` | `/v1/orders/{id}` | รายละเอียดบิล |
| `POST` | `/v1/orders/{id}/pay` | รับชำระเงิน (หลายช่องทางในบิลเดียวได้) — ส่งซ้ำได้ปลอดภัย |
| `POST` | `/v1/orders/{id}/discount` | ให้ส่วนลด (เกินวงเงินต้องมีการอนุมัติ) |
| `POST` | `/v1/orders/{id}/void` | ยกเลิกบิลที่ยังไม่ชำระ |
| `POST` | `/v1/order-items/{id}/void` | ยกเลิกรายการ (ถ้าครัวรับไปแล้วต้องอนุมัติ) |
| `POST` | `/v1/orders/{id}/refund` | คืนเงินทั้งบิล (เลือกคืนของเข้าสต็อกได้) |
| `GET` | `/v1/shifts` | ประวัติกะของสาขา |
| `POST` | `/v1/orders/{id}/tax-invoice` | ออกใบกำกับภาษีเต็มรูปตามที่ลูกค้าขอ (บิลละหนึ่งใบ) — ส่งซ้ำได้ปลอดภัย (สิทธิ์ `pos.pay`) |
| `GET` | `/v1/orders/{id}/tax-invoice` | ใบกำกับภาษีเต็มรูปของบิล (ไม่พบ = ยังไม่เคยออก) |

**Purchasing**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/reorder-suggestions` | ของที่ควรสั่ง พร้อมจำนวนเป็นแพ็ก (คิดของที่สั่งไว้แล้วให้) |
| `POST` | `/v1/purchase-orders` | สร้าง/แก้ไขใบสั่งซื้อฉบับร่าง |
| `POST` | `/v1/purchase-orders/{id}/status` | ส่งอนุมัติ / อนุมัติ / ส่งให้ผู้ขาย / ยกเลิก |
| `GET` | `/v1/purchase-orders` | ใบสั่งซื้อของสาขา (detail=full: พร้อมรายการและจำนวนที่รับแล้ว) (สิทธิ์ `purchasing.view`) |
| `POST` | `/v1/purchase-orders/from-suggestions` | สร้างใบสั่งซื้อฉบับร่างจากคำแนะนำ (เลือกผู้ขายรายเดียว) (สิทธิ์ `purchasing.manage`) |

**Team**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/members` | ทีมงานในร้าน |
| `POST` | `/v1/members` | เพิ่มพนักงาน (ใช้ PIN บนเครื่องร้าน ไม่ต้องมีอีเมล) |
| `PATCH` | `/v1/members/{id}` | แก้พนักงาน (ชื่อ ตำแหน่ง สาขา วงเงินส่วนลด) หรือปิด/เปิดใช้งาน (สิทธิ์ `staff.manage`) |
| `POST` | `/v1/members/{id}/pin` | ตั้ง PIN ใหม่ให้พนักงาน (สิทธิ์ `staff.manage`) |
| `PUT` | `/v1/roles/{id}/permissions` | ตั้งสิทธิ์ของตำแหน่ง (แทนที่ชุดเดิมทั้งหมด) (สิทธิ์ `staff.manage`) |

**Devices (เครื่องร้านที่ลงทะเบียนแล้ว — พนักงานเข้าด้วย PIN โดยไม่ต้องมีบัญชีบนเครื่อง)**

| Method | Path | ทำอะไร |
|---|---|---|
| `POST` | `/v1/devices` | ลงทะเบียนเครื่องร้าน (พนักงานเข้าด้วย PIN บนเครื่องนี้ได้ ไม่ต้องมีอีเมล) (สิทธิ์ `settings.manage`) |
| `GET` | `/v1/devices` | เครื่องที่ลงทะเบียนไว้ในร้าน (สิทธิ์ `settings.manage`) |
| `DELETE` | `/v1/devices/{id}` | ยกเลิกเครื่อง (เครื่องหาย/เลิกใช้ — เครื่องนั้นใช้ต่อไม่ได้ทันที) (สิทธิ์ `settings.manage`) |
| `GET` | `/v1/device/roster` | หน้าจอเลือกพนักงานของเครื่องที่ลงทะเบียนแล้ว (ใช้รหัสเครื่องใน X-Device-Token) |

**Settings**

| Method | Path | ทำอะไร |
|---|---|---|
| `PATCH` | `/v1/tenant` | แก้ไขข้อมูลร้าน (ชื่อ ประเภทกิจการ ภาษี การปัดเศษ) (สิทธิ์ `settings.manage`) |
| `POST` | `/v1/branches` | เพิ่มสาขาใหม่ (สิทธิ์ `settings.manage`) |
| `PATCH` | `/v1/branches/{id}` | แก้ไขสาขา (ที่อยู่ เบอร์โทร เวลาตัดรอบวัน ค่าบริการ เปิด-ปิดใช้งาน) (สิทธิ์ `settings.manage`) |
| `PATCH` | `/v1/channels/{id}` | แก้ไขช่องทางขาย (ชื่อ สี เปิด-ปิดใช้งาน ค่าบริการ) (สิทธิ์ `settings.manage`) |
| `POST` | `/v1/channels/{id}/commission-rate` | ตั้งค่า GP ใหม่ พร้อมวันเริ่มมีผล (ของเดิมยังใช้กับยอดขายเก่า) (สิทธิ์ `settings.manage`) |
| `PATCH` | `/v1/payment-methods/{id}` | แก้ไขช่องทางรับเงิน (ชื่อ เปิด-ปิดใช้งาน ค่าธรรมเนียม พร้อมเพย์) (สิทธิ์ `settings.manage`) |
| `POST` | `/v1/settings/payments/confirm-cash-only` | ยืนยันว่าตั้งใจรับเงินสดอย่างเดียว (ข้ามขั้นตอนตั้งพร้อมเพย์) (สิทธิ์ `settings.manage`) |

**Shop (ข้อมูลตั้งต้นทั้งร้านในคำขอเดียว)**

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/shop` | ข้อมูลตั้งต้นทั้งร้านในคำขอเดียว (ตั้งค่า สาขา เมนู ทีมงาน ผู้ขาย แพ็กเกจ) |

**Dev (เฉพาะ development/ทดสอบ — ไม่มีใน production)**

| Method | Path | ทำอะไร |
|---|---|---|
| `POST` | `/v1/dev/login` | เข้าสู่ระบบสำหรับพัฒนา/ทดสอบ (ไม่มีรหัสผ่าน ไม่มีใน production) |

**Billing** (ค่าบริการของร้านเอง — ไม่เกี่ยวกับการขายของร้าน)

| Method | Path | ทำอะไร |
|---|---|---|
| `GET` | `/v1/billing` | แพ็กเกจ สถานะ (`trial`/`ok`/`past_due`/`restricted`/`canceled` พร้อมจำนวนวันผ่อนผันที่เหลือ) ใบแจ้งหนี้ที่รอชำระพร้อมวิธีชำระ และประวัติ 12 ใบล่าสุด — ต้องมี `billing.manage` |
| `POST` | `/v1/settings/plan` | เลือกแพ็กเกจ `{planCode, billingCycle}`: ปิดระบบเก็บเงิน (`mode: off`) → มีผลทันที; เปิดอยู่ → แพ็กเกจที่แพงกว่า (เทียบต่อเดือน) เป็นใบแจ้งหนี้ให้ชำระก่อน (`applied: false`), ถูกกว่า/รอบบิลอื่นของแพ็กเกจเดิมมีผลทันที/รอบถัดไป; แพ็กเกจที่เล็กกว่าที่ร้านมีอยู่ถูกปฏิเสธก่อนออกใบ (`PLAN_LIMIT_REACHED`) |
| `POST` | `/v1/billing/invoices/{id}/void` | ยกเลิกใบแจ้งหนี้การเปลี่ยนแพ็กเกจที่ยังไม่ชำระ (ใบต่ออายุยกเลิกเองไม่ได้ — 422) |
| `POST` | `/v1/billing/webhook/{id}` | (`{id}` คือชื่อผู้ให้บริการ) เหตุการณ์จากผู้ให้บริการชำระเงิน (`invoice.paid`, `invoice.payment_failed`, `subscription.canceled`) รูปแบบเดียวกันทุกผู้ให้บริการ ลงลายมือชื่อด้วย `X-Sabai-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<raw body>")>` (เกิน 5 นาทีถูกปฏิเสธ กัน replay); ตอบ 200 พร้อม `outcome` เสมอเมื่อลายมือชื่อถูก |
| `POST` | `/v1/billing/run` | งานประจำวันสำหรับตัวตั้งเวลาภายนอก (`X-Job-Secret`; ไม่ตั้ง `BILLING_JOB_SECRET` = ไม่มี route นี้) — ปลอดภัยที่จะเรียกกี่ครั้งก็ได้ |

กฎที่ไม่ยืดหยุ่น: **ค่าบริการไม่หยุดการขาย.** ใบต่ออายุออกล่วงหน้า 7 วัน → เลยกำหนด = `past_due` (banner + ผ่อนผัน 14 วันนับจากวันครบกำหนด ไม่ใช่วันที่งานรัน) → เลยผ่อนผัน = `restricted` (เพิ่มสาขา/พนักงาน/เครื่องไม่ได้, `BILLING_RESTRICTED` 402 + ปุ่ม "ไปชำระค่าบริการ") → ชำระเมื่อไรก็กลับมาปกติทันที ตัวเลขทุกตัวมาจากเวลา จึงถูกต้องแม้งานประจำวันยังไม่รัน

## รันและทดสอบ

```bash
cp apps/api/.env.example apps/api/.env      # DATABASE_URL, JWT_SECRET (≥ 32 ตัวอักษร)
pnpm db:reset                                # ติดตั้ง migrations ลง sabai_dev
pnpm --filter @sabai/api dev                 # http://localhost:8787
pnpm --filter @sabai/api test                # integration tests บน Postgres จริง (สร้าง DB ชั่วคราว)
```
