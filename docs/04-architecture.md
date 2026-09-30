# สถาปัตยกรรมระบบ (Architecture)

## 1. ภาพรวม

**Modular monolith บน Postgres** — deploy ชิ้นเดียว แต่แบ่งโมดูลชัดเจนทั้งในโค้ดและฐานข้อมูล
เพื่อให้ทีมเล็กส่งงานได้เร็ววันนี้ และแยกเป็น service ได้เมื่อจำเป็นโดยไม่ต้องรื้อ ([ADR-0001](adr/0001-modular-monolith.md))

```
┌──────────────────────────── Clients ─────────────────────────────┐
│  Web app (Next.js 16, React 19)                                  │
│  • Back office: วันนี้ / รายงาน / เมนู / สต็อก / การเงิน / ทีม / ตั้งค่า │
│  • Work surfaces: POS (แท็บเล็ต), KDS (จอครัว) — เต็มจอ, local-first │
│  • ขายต่อได้ตอนเน็ตหลุด: คิว IndexedDB + service worker + เครื่องพิมพ์ ESC/POS │
└───────────────┬──────────────────────────────────▲───────────────┘
                │ HTTPS JSON (+ Idempotency-Key)    │ SSE /v1/events
┌───────────────▼──────────────────────────────────┴───────────────┐
│  API (Hono, Node 22)  — ชั้นบาง: auth → validate (zod) → call SQL  │
│  identity · devices · catalog · pos · kitchen · inventory · finance │
│  reports · settings · billing (ค่าบริการของร้านเอง)                  │
│  error envelope ภาษาคน · request id · rate limit · OpenAPI อัตโนมัติ │
│  OpenTelemetry (trace/metric) · log มีโครงสร้าง · error tracking    │
└───────────────┬──────────────────────────────────▲───────────────┘
                │ set local role authenticated      │ LISTEN sabai_events
                │ + request.jwt.claims              │
┌───────────────▼──────────────────────────────────┴───────────────┐
│  Postgres 16 (Supabase-compatible)                                │
│  schema app: ตาราง + RLS ทุกตาราง + commands (security definer)   │
│  schema audit: audit.log (ห้ามแก้)                                  │
│  app.domain_events (outbox) → trigger → pg_notify                  │
└──────────────────────────────────────────────────────────────────┘
```

### Monorepo

| Package | หน้าที่ | ขึ้นกับ |
|---|---|---|
| `packages/domain` | Business logic บริสุทธิ์ (TS ไม่มี I/O): เงิน, ราคา/VAT, สูตร/ต้นทุน, สต็อก, สิทธิ์, onboarding, error, กระทบยอด, analytics, KDS, PromptPay, แพ็กเกจ | — |
| `packages/contracts` | zod schemas ของ request/response — แหล่งเดียวของ validation + OpenAPI | zod |
| `packages/observability` | ดูแลตัวเองโดยไม่ทำข้อมูลรั่ว: redaction (ตัดค่าใต้คีย์อ่อนไหว ปิดบังข้อความที่เหมือนความลับ), ตัวรายงานข้อผิดพลาดแบบ Sentry-compatible (DSN ผ่าน env) — ไม่มี dependency ใช้ร่วมกันทั้ง API และเว็บ | — |
| `packages/db` | SQL test runner + scripts | Postgres |
| `supabase/migrations` | Schema, RLS, commands, views, seed | — |
| `apps/api` | HTTP API | domain, contracts, observability |
| `apps/web` | UI (`e2e/` = ชุดทดสอบเบราว์เซอร์ Playwright ทั้งโหมด demo และ API) | domain, contracts, observability |
| `tools/qa` | Lighthouse ที่ล้มเหลวเมื่อเกินงบ + axe แบบเดี่ยว (นอก workspace) | — |
| `tools/load` | ตัวยิงโหลด (`probe.mjs`) ที่ใช้เขียน SLO ([10-slo](10-slo.md)) | — |

**กฎการพึ่งพา:** `domain` ไม่ import อะไรจาก app ใดๆ; UI และ API ใช้ `domain` ชุดเดียวกัน
→ POS ที่ออฟไลน์คำนวณราคาได้ **ตรงกับเซิร์ฟเวอร์ทุกสตางค์** (มี parity test: `prices exactly like the domain library`)

## 2. ทำไมตรรกะหลักอยู่ในฐานข้อมูล

คำสั่งเขียนทุกคำสั่ง (`app.submit_order`, `app.pay_order`, `app.receive_goods`, `app.close_business_day` …) เป็น
**Postgres function หนึ่งตัว = transaction เดียว** ([ADR-0002](adr/0002-postgres-rls-and-db-commands.md))

- ความถูกต้องทางบัญชี/สต็อกบังคับที่จุดเดียว ไม่ว่าจะเรียกจาก API, job, หรือเครื่องมือในอนาคต
- RLS + `assert_permission()` ภายใน function → ต่อให้ API มีบั๊ก ก็ไม่ข้ามร้าน/ข้ามสิทธิ์
- ledger append-only (`forbid_mutation` trigger) + ตรวจงบดุลแบบ deferred constraint

ส่วนที่ต้อง "คำนวณเร็วบนเครื่อง" (ราคา, ต้นทุนสูตร, จับคู่กระทบยอด, analytics) อยู่ใน `domain`
และ SQL มีสูตรเดียวกัน (มีเทสต์ยืนยันว่าผลตรงกัน)

## 3. เส้นทางข้อมูล: ขาย 1 บิล

1. **POS** เพิ่มรายการในตะกร้า (local, < 100ms) → กด "ชำระเงิน"
2. `POST /v1/orders` พร้อม `Idempotency-Key` → `app.submit_order` **คำนวณราคาใหม่จากเมนูในฐานข้อมูล** (ไม่เชื่อราคาจากเครื่อง) → ตั๋วครัวแยกตามสถานี
3. `pg_notify` → API → **SSE** → KDS แสดงตั๋วใหม่ทันที
4. `POST /v1/orders/{id}/pay` → `app.pay_order`: ตรวจกะ, บันทึก payment (ห้ามแก้), เงินทอน, **ตัดสต็อกตามสูตร** (explode ของเตรียมหลายชั้น, ต้นทุนเฉลี่ย ณ เวลานั้น), เลขใบเสร็จไม่ข้ามเลข
5. ปลายวัน `app.close_business_day`: สรุปยอด → **ลงบัญชีคู่** (ขาย/VAT/ต้นทุน/ของเสีย/เงินสดขาดเกิน) → สร้าง **เงินที่ต้องเข้า** (บัตร, PromptPay, แพลตฟอร์มหัก GP) → ล็อกวัน
6. นำเข้า statement → `suggestMatches` (exact / รวมหลายวันของผู้จ่ายเดียวกัน / ใกล้เคียงพร้อมคำอธิบาย) → ยืนยัน 1 แตะ

## 4. Multi-tenancy และความปลอดภัย

| ชั้น | กลไก |
|---|---|
| Identity | JWT (Supabase-compatible `sub`), พนักงาน PIN ได้ token อายุสั้นพร้อม `mid` (membership) |
| Row level | RLS ทุกตาราง ผ่าน `app.apply_tenant_rls(table, read_perm, write_perm, branch_col)` — policy ใช้ `(select app.user_tenant_ids())` (initPlan cache ต่อ query) |
| Branch | ตารางที่มี `branch_id` จำกัดด้วย `app.user_branch_ids()` |
| Commands | `security definer` + `set search_path = ''` + `assert_permission` + revoke จาก `public` |
| Secrets | PIN เป็น bcrypt, column-level grant ไม่ให้เลือก `pin_hash`, audit ตัดทิ้งก่อนบันทึก |
| HTTP | secure headers, CORS allowlist, rate limit, request id ในทุก log/error |
| Audit | `audit.log` จาก trigger บนตารางสำคัญ ห้ามแก้ไข อ่านได้เฉพาะ `audit.view` |

## 5. Realtime และ offline

- **Realtime**: domain event → outbox table → `pg_notify('sabai_events')` → `EventHub` (LISTEN) → SSE ต่อร้าน/สาขา (`GET /v1/events`, ส่งเฉพาะ id) เว็บอ่านสตรีมเอง (`fetch` ไม่ใช่ `EventSource` เพราะต้องส่ง `Authorization`/`X-Tenant-Id`) จับคู่ event → ส่วนของข้อมูลที่ล้าสมัย และ **อ่านซ้ำเฉพาะส่วนที่หน้าจอที่เปิดอยู่แสดงจริง** (event รัวใน 250 ms รวมเป็นการอ่านครั้งเดียว; ต่อใหม่เองด้วย back-off; หลุดแล้วกลับมาจะอ่านทุกอย่างที่แสดงอยู่ใหม่)
- **Offline**: "ส่งออเดอร์เข้าครัว" และ "รับเงิน" ที่ส่งไม่ถึงเซิร์ฟเวอร์จะ **ทำในเครื่องก่อนด้วย engine ที่ใช้กฎเดียวกับฐานข้อมูล** แล้วเก็บในคิว IndexedDB พร้อม `Idempotency-Key` ตัวเดียวกับที่ลองส่งครั้งแรก และส่งซ้ำเมื่อกลับมาออนไลน์ (ถ้าครั้งแรกถึงเซิร์ฟเวอร์แล้วแต่คำตอบหาย เซิร์ฟเวอร์ตอบผลเดิม ไม่รับเงินซ้ำ); **service worker** เก็บเฉพาะหน้า HTML และไฟล์ static ของแอป (allow-list — ไม่แตะ API หรือข้อมูลของคนที่ล็อกอิน) จึงเปิดแอปได้แม้ไม่มีอินเทอร์เน็ต; ราคาถูกคำนวณใหม่ที่เซิร์ฟเวอร์เสมอ ไม่เชื่อราคาจากเครื่อง
- **ขอบเขตที่ตั้งใจ**: ออฟไลน์ครอบคลุมสองคำสั่งที่พนักงานทำต่อหน้าลูกค้าเท่านั้น (ไม่ใช่ทุกหน้า); หลายเครื่องขายออฟไลน์พร้อมกันแล้วชนกันที่สต็อกยังไม่ได้ทดลองกับร้านจริง

## 5b. เอกสารและอุปกรณ์หน้าร้าน

- **เลขใบเสร็จ** แยกต่อเครื่อง POS ที่ลงทะเบียน (`HQ-T1-YYMM-00001`) เครื่องที่ไม่ได้ลงทะเบียนใช้ชุดของสาขา; **ใบกำกับภาษีเต็มรูป** ออกตามที่ลูกค้าขอ (`app.tax_invoices` ห้ามแก้/ลบ เก็บภาพถ่ายของผู้ขาย/ผู้ซื้อ/รายการ ณ วันนั้น บิลละหนึ่งใบ) พิมพ์ A4 ต้นฉบับ+สำเนา
- **เครื่องพิมพ์ความร้อน** ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ (58/80 mm) หรือพิมพ์ตรงด้วย ESC/POS ผ่าน WebUSB / Web Serial / Web Bluetooth (ข้อความไทยพิมพ์ได้สองแบบ — เป็นข้อความ CP874 หรือเป็นภาพที่วาดด้วยฟอนต์ IBM Plex Sans Thai — เลือกได้ต่อเครื่อง) พร้อมเปิดลิ้นชักเงินสด; ถ้าเครื่องพิมพ์ใช้ไม่ได้ ตกกลับไปหน้าต่างพิมพ์ของเบราว์เซอร์

## 5c. ค่าบริการของร้านเอง (Billing)

กฎที่ไม่ยืดหยุ่น: **ค่าบริการไม่เคยหยุดการขาย** สถานะ (`trial → ok → past_due → restricted`) คำนวณจากเวลา (`billingStage` ใน `domain` = `app.billing_stage` ใน SQL ใช้เวกเตอร์ทดสอบชุดเดียวกัน) เลยช่วงผ่อนผัน 14 วันหยุดได้เฉพาะ *เพิ่ม* สาขา/พนักงาน/เครื่อง; ใบแจ้งหนี้ ผู้ให้บริการชำระเงินเป็น interface เดียวกันทุกเจ้า (เหตุการณ์ที่ลงลายมือชื่อ ประมวลผลครั้งเดียวด้วย `(provider, event_id)`); มีแต่ `manual` (โอน/พร้อมเพย์ + ทีมงานยืนยัน) จนกว่าจะมี key ของผู้ให้บริการบัตร — รายละเอียดใน [06-api](06-api.md) และ [05-database](05-database.md)

## 5d. การดูแลระบบ

OpenTelemetry (trace + metric ผ่าน OTLP), log JSON ที่ตัดความลับให้อัตโนมัติ, รายงานข้อผิดพลาดที่ไม่คาดคิด, หน้าจอเมื่อหน้าพัง (ภาษาไทย + รหัสอ้างอิงที่ตรงกับรายงาน) — ปิดเป็นค่าเริ่มต้นทั้งหมด: [09-observability](09-observability.md); เป้าหมายความน่าเชื่อถือและตัวเลขที่วัดจริง: [10-slo](10-slo.md)

## 5e. หน้าจอแรกบนมือถือ (ประสิทธิภาพที่วัดแล้วและกฎที่ต้องรักษา)

หน้าเว็บวาดจากข้อมูลในเครื่อง ดังนั้น "หน้าจอแรก" = ดาวน์โหลดสคริปต์ → ประกอบ store → วาดทั้งหน้า → จัดวางตัวอักษรไทยครั้งแรก ตัวเลขที่ต้องรู้ (Lighthouse mobile จำลอง 4G + CPU 4×): งานหลักที่นับเป็น blocking time มีเพียง 2 ก้อน คือการวาดหน้า และ layout ครั้งแรก ทุกมิลลิวินาทีจริงของก้อนที่เกิน 12.5 ms นับเป็น 4 ms ในคะแนน กฎที่ทำตามเพื่อไม่ให้หน้าแรกช้าลงเมื่อเพิ่มฟีเจอร์:

| กฎ | ทำไม | ที่ไหน |
|---|---|---|
| โค้ดที่ใช้เฉพาะโหมด API (HTTP adapter, สตรีมสด, คิวออฟไลน์, แผงเข้าสู่ระบบ/สมัคร/เครื่องร้าน) เป็นดาวน์โหลดแยก ไม่อยู่ใน bundle แรกของโหมดเดโม | เดโมไม่เคยคุยกับเซิร์ฟเวอร์ แต่เคยแบกโค้ดทั้งหมด (+154 KB หลังย่อ) | `lib/data-source/index.ts` (stand-in ที่โหลด adapter ตอนเรียกครั้งแรก), `components/app/api-bridges.tsx`, `next/dynamic` ในหน้า `/`, `/signup`, `/reset-password`, ตั้งค่า |
| โค้ดพิมพ์ (encoder ESC/POS, ใบเสร็จ, ใบกำกับภาษี) โหลดตอนมีงานพิมพ์ และโหลดล่วงหน้าไว้หลังเปิดหน้า 3 วินาที | ร้านที่ไม่ต่อเครื่องพิมพ์ไม่ควรแบกมัน แต่เมื่อเน็ตหลุดต้องพิมพ์ได้ (service worker เก็บทุกไฟล์ที่หน้าเคยดึง) | `print-root.tsx` → `print-job.tsx`, `loadPrinterSend()` |
| วาดหน้าแรกใน transition (เป็นชิ้นเล็กๆ) ไม่ใช่ render แบบ synchronous ก้อนเดียว | store ที่อ่านด้วย `useSyncExternalStore` ทำให้ React วาดใหม่ทั้งต้นไม้แบบขัดจังหวะไม่ได้ทันทีที่ hydrate เสร็จ (งานก้อนเดียว ~100 ms) | `useAfterHydration` ใน `Gate` และหน้า `/` |
| ห้ามสร้าง `Intl.*Format` ต่อการเรียก | ใช้ ~0.1 ms ต่อครั้ง และหน้าแรกเรียกเป็นร้อยครั้ง | `packages/domain/src/business-date.ts` (แคชต่อ time zone) |
| ห้ามอ่านขนาด (`clientWidth`, `getBoundingClientRect`) ใน layout effect ตอนหน้าเพิ่งขึ้น | บังคับให้เบราว์เซอร์จัดวางทั้งหน้าในงานเดียวกับ commit; ใช้ `ResizeObserver` และจองความสูงกล่องไว้ | `components/charts/chart-kit.tsx` |
| รูปโลโก้ระบุ `width`/`height` เท่าที่วาดจริง | `next/image` เลือกขนาดไฟล์จากค่านี้ ไม่ใช่จาก CSS (เคยโหลด 80 KB เพื่อวาด 130 px) | `Logo` ใน `app-shell.tsx` |
| ส่วนล่างๆ ของหน้ายาวใช้ `.offscreen-lazy` (`content-visibility: auto`) | ไม่จัดวาง/ไม่วาดสิ่งที่ยังมองไม่เห็นจนกว่าจะเลื่อนใกล้ (ตัวสแกน axe ในเทสต์เปิดมันทั้งหมดก่อนสแกน) | `globals.css`, `/reports`, `/today` |

สิ่งที่ยังเหลือและเป็นต้นทุนจริง: การจัดวางข้อความไทยครั้งแรก (shaping ประมาณ 30–50 ms บนเครื่องที่ไม่ถูกหน่วง) — V1 จ่ายก้อนนี้ก่อนหน้าจอแรกเพราะโลโก้เป็นข้อความ ตอนนี้โลโก้เป็นรูป จึงไปจ่ายหลังหน้าจอแรก วิธีตรวจ/วัดซ้ำ: [`tools/qa/README.md`](../tools/qa/README.md)

## 6. เส้นทางการเติบโต (Growth path)

ออกแบบให้ "ไม่ต้องรื้อ" เมื่อโต — แต่ละขั้นเปลี่ยนเฉพาะ infrastructure

| ขนาด | ลักษณะโหลด | สิ่งที่ทำ | สิ่งที่ **ไม่ต้อง** เปลี่ยน |
|---|---|---|---|
| **0–1,000 ร้าน** | Postgres เครื่องเดียว + API 2 instance | ปัจจุบัน; PgBouncer (transaction mode — ใช้ `set local` จึงปลอดภัย) | — |
| **1k–10k ร้าน** | รายงานหนักขึ้น | read replica สำหรับ `/reports`; **rollup รายวัน** (materialized จาก `v_branch_daily_pnl`) refresh ตอนปิดยอด; partition `stock_movements`, `journal_lines`, `audit.log` ตามเดือน | schema, API contract, UI |
| **10k–100k ร้าน** | เขียนพร้อมกันมาก | **Citus**: distribute ทุกตารางด้วย `tenant_id` (FK แบบ composite `(tenant_id, id)` เตรียมไว้แล้ว), reference tables = plans/permissions; outbox → message queue (Kafka/NATS) แทน `pg_notify` | business logic ใน SQL, domain |
| **เครือใหญ่/ต่างประเทศ** | data residency, SSO | cell-based deployment ต่อภูมิภาค, SSO (SAML/OIDC), tenant ใหญ่แยก cell เฉพาะ | โค้ดเดียวกันทุก cell |

แยก service เมื่อ **มีเหตุผลเชิงทีม/โหลด** เท่านั้น ลำดับที่คาดไว้: (1) reporting/analytics read model (2) integrations (เดลิเวอรี, e-Tax, ธนาคาร) (3) notifications
— ทำได้ง่ายเพราะโมดูลสื่อสารกันผ่าน domain events อยู่แล้ว

### จุดที่เตรียมไว้แล้วสำหรับการโต

- UUIDv7 (insert เรียงตามเวลา index ไม่บวม) · composite FK พร้อม shard · `version` column สำหรับ optimistic locking
- GP มีวันเริ่ม-สิ้นสุด (`channel_commission_rates.valid_from/valid_to`) · ราคาแยกช่องทาง/สาขา (`menu_item_prices`) · บิลเก็บ **snapshot ราคา/VAT/GP ณ เวลาขาย** — แก้ราคาวันนี้ รายงานย้อนหลังไม่เพี้ยน
- ค่าใช้จ่ายมีงวดบริการ (`period_start/end`) — รายงานแบบ accrual ถูกต้องทุกช่วงเวลา
- plan limits บังคับที่ DB (`enforce_plan_limits`) — เพิ่มแพ็กเกจไม่ต้องแก้แอป
- permission catalog เป็นข้อมูล — เพิ่มสิทธิ์ใหม่ owner ได้อัตโนมัติ (`grants_all`)

## 7. สถานะปัจจุบันของการเชื่อมต่อ (ตรงไปตรงมา)

| ส่วน | สถานะ | หลักฐาน |
|---|---|---|
| Database + commands + RLS | ✅ 75 ตาราง (+ `audit.log`) ทุกตารางมี RLS, 103 functions, 7 views ใน 23 migrations | SQL e2e 233 assertions (`pnpm db:test`) |
| API | ✅ 88 endpoints + SSE + OpenAPI; billing, เครื่องร้าน, ใบกำกับภาษี, observability | integration test 101 เคส กับ Postgres จริง — รวมเทสต์ที่บังคับให้ [06-api](06-api.md) ตรงกับ route ที่ลงทะเบียนจริงทุกตัว |
| Web UI ทุกหน้า | ✅ สองโหมดจากโค้ดเดียว: **demo** (engine ในเบราว์เซอร์ ไม่ต้องมีเซิร์ฟเวอร์ — สิ่งที่ deploy บน Vercel) และ **API** (`NEXT_PUBLIC_DATA_SOURCE=api`) | unit 392 · browser tests (Playwright + axe) 72 ในโหมดเดโม / 68 ในโหมด API รันใน CI ทุกครั้ง |
| Web ↔ API | ✅ ทำแล้ว (V1.1, [ADR-0009](adr/0009-datasource.md)): ทุกหน้าเรียกผ่าน `DataSource` เดียว, สตรีมสด, คิวออฟไลน์, service worker, เข้าสู่ระบบ/สมัคร/เครื่องร้าน, พิมพ์ใบเสร็จ/ตั๋วครัว/ใบกำกับภาษี, ค่าบริการ | ดู [checklist](v1.1-checklist.md) |
| ต่อบริการภายนอกจริง | ⏭ ยังไม่ได้ทำ (ต้องมีข้อมูลจากเจ้าของโปรเจกต์): Supabase Auth (URL/anon key — ตอนนี้ใช้ `AUTH_MODE=local`), ผู้ให้บริการรับบัตร/พร้อมเพย์ (ตอนนี้ `BILLING_PROVIDER=manual`), LINE Login | [checklist 6.4, 8.2](v1.1-checklist.md) |
| Deploy ของ API | ⏭ ยังไม่ได้ deploy (เว็บโหมดเดโมอยู่บน Vercel) — ต้องเลือกที่รัน API + Postgres ที่มีมาตรฐานสำรองข้อมูล | [10-slo](10-slo.md) มีตัวเลขที่วัดบนเครื่องเดียว |

ADR ที่เกี่ยวข้อง: [adr/](adr/)
