# สถาปัตยกรรมระบบ (Architecture)

## 1. ภาพรวม

**Modular monolith บน Postgres** — deploy ชิ้นเดียว แต่แบ่งโมดูลชัดเจนทั้งในโค้ดและฐานข้อมูล
เพื่อให้ทีมเล็กส่งงานได้เร็ววันนี้ และแยกเป็น service ได้เมื่อจำเป็นโดยไม่ต้องรื้อ ([ADR-0001](adr/0001-modular-monolith.md))

```
┌──────────────────────────── Clients ─────────────────────────────┐
│  Web app (Next.js 16, React 19)                                  │
│  • Back office: วันนี้ / รายงาน / เมนู / สต็อก / การเงิน / ทีม / ตั้งค่า │
│  • Work surfaces: POS (แท็บเล็ต), KDS (จอครัว) — เต็มจอ, local-first │
└───────────────┬──────────────────────────────────▲───────────────┘
                │ HTTPS JSON (+ Idempotency-Key)    │ SSE /v1/events
┌───────────────▼──────────────────────────────────┴───────────────┐
│  API (Hono, Node 22)  — ชั้นบาง: auth → validate (zod) → call SQL  │
│  identity · catalog · pos · kitchen · inventory · finance · reports │
│  error envelope ภาษาคน · request id · rate limit · OpenAPI อัตโนมัติ │
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
| `packages/db` | SQL test runner + scripts | Postgres |
| `supabase/migrations` | Schema, RLS, commands, views, seed | — |
| `apps/api` | HTTP API | domain, contracts |
| `apps/web` | UI | domain |
| `tools/qa` | axe + Lighthouse (นอก workspace) | — |

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

- **Realtime**: domain event → outbox table → `pg_notify('sabai_events')` → `EventHub` (LISTEN) → SSE ต่อร้าน/สาขา
- **Offline (V1)**: POS/KDS เป็น local-first (state ในเครื่อง, คำนวณด้วย `domain`) — คำสั่งเขียนทุกตัว idempotent จึงส่งซ้ำได้เมื่อเน็ตกลับมา
- **Offline (V2)**: คิวคำสั่งใน IndexedDB + service worker + conflict policy (เซิร์ฟเวอร์ชนะเรื่องราคา/สต็อก, เครื่องชนะเรื่องลำดับรายการ)

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

| ส่วน | สถานะ |
|---|---|
| Database + commands + RLS | ✅ ครบ มี SQL e2e test |
| API ~50 endpoints + SSE + OpenAPI | ✅ ครบ มี integration test 25 เคส |
| Web UI ทุกหน้า | ✅ ครบ ทำงานบน **demo adapter** (engine ในเบราว์เซอร์ที่จำลองคำสั่ง DB ชุดเดียวกัน + ข้อมูลย้อนหลัง 30 วัน) เพื่อให้ทดลองได้ทันทีโดยไม่ต้องมีเซิร์ฟเวอร์ |
| Web ↔ API | ⏭ งานถัดไป (V1.1): สร้าง `DataSource` interface ให้ UI เรียกผ่าน adapter เดียว แล้วสลับ demo ↔ HTTP ได้ด้วย env |

ADR ที่เกี่ยวข้อง: [adr/](adr/)
