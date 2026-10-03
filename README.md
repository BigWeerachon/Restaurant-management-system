# Sabai — ระบบบริหารร้านอาหารและคาเฟ่ (SaaS)

> **"พนักงานไม่จำเป็นต้องเข้าใจระบบ แต่ระบบต้องเข้าใจวิธีทำงานของพนักงาน"**

POS · จอครัว · สูตรและต้นทุน · สต็อกหลายคลัง · จัดซื้อ · การเงิน/กระทบยอด · หลายสาขา · รายงาน
บน **ข้อมูลชุดเดียว** เพื่อตอบคำถามของเจ้าของร้าน:
**อะไรขายดี · ขายที่ไหน · ผ่านช่องทางไหน · สุดท้ายเหลือเงินจริงเท่าไร**

![รายงานเหลือเงินจริง](docs/screenshots/03-reports.jpg)

| | |
|---|---|
| ![หน้าวันนี้](docs/screenshots/02-today-owner.jpg) | ![POS PromptPay](docs/screenshots/11-pos-promptpay.jpg) |
| ![จอครัว](docs/screenshots/12-kds.jpg) | ![สูตรและต้นทุน](docs/screenshots/04-menu-recipe-costing.jpg) |
| ![กระทบยอด](docs/screenshots/07-finance-reconcile.jpg) | ![สิทธิ์ตามตำแหน่ง](docs/screenshots/08-team-roles.jpg) |

**ใหม่ใน V1.1** — ต่อ API จริง · ค่าบริการที่ไม่หยุดการขาย · เครื่องในร้าน · ใบกำกับภาษี · ขายต่อได้เมื่อเน็ตหลุด

| | |
|---|---|
| ![เชื่อมต่อร้านจริง](docs/screenshots/17-connect-real-shop.jpg) | ![เลือกแพ็กเกจ](docs/screenshots/18-billing-plans-trial.jpg) |
| ![ชำระใบแจ้งหนี้ด้วยพร้อมเพย์](docs/screenshots/19-billing-pay-promptpay.jpg) | ![ค้างชำระ แต่ขายต่อได้](docs/screenshots/20-billing-restricted-keeps-selling.jpg) |
| ![เครื่องในร้าน](docs/screenshots/21-settings-devices.jpg) | ![ใบเสร็จและเครื่องพิมพ์](docs/screenshots/22-settings-receipt-printer.jpg) |
| ![ออกใบกำกับภาษีเต็มรูป](docs/screenshots/23-tax-invoice-issued.jpg) | ![ใบกำกับภาษี A4](docs/screenshots/24-tax-invoice-paper.jpg) |
| ![คิวที่รอส่งเมื่อเน็ตหลุด](docs/screenshots/25-offline-queue.jpg) | ![บนมือถือ](docs/screenshots/26-phone-offline-queue.jpg) |

โหมด API บน Postgres จริงกับประวัติขาย 30 วัน (`pnpm db:seed:history`) — รายงาน "เหลือเงินจริงเท่าไร":

![รายงานในโหมด API กับประวัติขาย 30 วัน](docs/screenshots/27-api-reports-history.jpg)

## คุณภาพที่วัดได้

| | ผล |
|---|---|
| Lighthouse desktop (10 หน้า ล็อกอินแล้ว) | Performance **99–100** · Accessibility / Best practices / SEO **100** ทุกหน้า · LCP ≤ 0.44 s |
| Lighthouse mobile (จำลอง 4G + CPU 4×) | Performance **85–94** (กลาง ~90) · Accessibility / Best practices / SEO **100** · LCP 1.1–1.5 s · TBT 0.3–0.6 s — ต่ำกว่า V1 (93–100) เพราะฟีเจอร์ V1.1 ([ที่มา](docs/04-architecture.md#5e-หน้าจอแรกบนมือถือ-ประสิทธิภาพที่วัดแล้วและกฎที่ต้องรักษา)) |
| Lighthouse โหมด API (ต่อ API + Postgres จริง) | Desktop Performance **96–100** · Mobile Performance **71–85** (ทุกหน้ารอข้อมูลจาก API บนเครือข่ายจำลอง 4G; ยังไม่ได้วัดบนมือถือจริง) · Accessibility / Best practices / SEO **100**, CLS ≤ 0.015 |
| axe-core WCAG 2.2 AA | **0 violations** — 21 หน้า × สว่าง/มืด, มือถือ, dialog/wizard/ใบเสร็จ อยู่ใน browser tests ที่ **ขวางการ merge** |
| Tests | SQL 341 assertions (231 end-to-end + 44 ประวัติขาย + 58 โอนสต็อก/เปิดวันปิดยอด + 8 index) · domain 119 · API 119 (กับ Postgres จริง) · web 395 · observability 17 · browser tests 73 (โหมดเดโม) + 69 (โหมด API) — ผ่านทั้งหมด |
| CI ทุก push | `check` (typecheck + tests + SQL + build) · `e2e` ทั้งสองโหมด · `lighthouse` (งบประมาณคะแนน) |
| คะแนนประเมิน | ฟังก์ชัน **96** · หน้าตา **96** · animation **95** · รวมทั้งโปรเจกต์ 95.1 ([scorecard](docs/08-scorecard.md) — พร้อมข้อจำกัดที่ยังเหลือ) |

## เริ่มใช้งาน

```bash
# ต้องมี Node 22+, pnpm 10, Postgres 16
pnpm install

# 1) โหมดเดโม — ทดลองหน้าเว็บทันที (ร้านตัวอย่าง + ข้อมูล 30 วัน ข้อมูลอยู่ในเบราว์เซอร์ ไม่ต้องมีเซิร์ฟเวอร์)
pnpm --filter @sabai/web dev            # http://localhost:3000

# 2) โหมด API — ทุกหน้าอ่าน/เขียนผ่าน API บน Postgres จริง (reset DB → seed ร้านตัวอย่าง + ประวัติขาย 30 วัน → API + web พร้อมกัน)
pnpm stack:dev                          # API http://localhost:8787 · web http://localhost:3000 · SEED_HISTORY=0 = เริ่มจากร้านที่ยังไม่เคยขาย

# ฐานข้อมูล + API แยกทีละส่วน (เทียบเท่าข้อ 2 แต่คุมเองได้)
pnpm db:test                            # สร้าง DB ทดสอบ รันทุก migration และ SQL e2e
pnpm db:reset                           # ติดตั้ง migrations ลง sabai_dev
pnpm db:seed                            # ใส่ร้านตัวอย่างเดียวกับเดโม (เมนู/สูตร/พนักงาน/PIN)
pnpm db:seed:history                    # (ไม่บังคับ) เติมประวัติขาย 30 วัน ~7,000 บิล ให้รายงาน/สต็อก/หน้าแรกมีข้อมูล — ทำซ้ำได้ผลเดิม
pnpm --filter @sabai/api dev            # http://localhost:8787 · OpenAPI: /v1/openapi.json

# ตรวจทั้งหมด
pnpm typecheck && pnpm test && pnpm build
pnpm e2e demo                           # browser tests (Playwright + axe) บน production build — โหมดเดโม
pnpm e2e api                            # เหมือนกัน บน API + Postgres ที่ seed ใหม่ (ไม่มีประวัติขาย — เทสต์ต้องการร้านที่ยังไม่เคยขาย)
```

`DATABASE_URL`/`JWT_SECRET` มีค่าเริ่มต้นที่ใช้กับ `sabai_dev` ได้ทันที ไม่ต้องสร้าง `.env`
(ปรับเองได้ด้วย `apps/api/.env.example` และ `apps/web/.env.example`)

ร้านตัวอย่าง: เลือกบทบาทที่หน้าแรกได้เลย หรือสลับผู้ใช้ด้วย PIN —
เจ้าของ `1234` · ผู้จัดการ `2222` · แคชเชียร์ `3333` · เสิร์ฟ `4444` · ครัว `5555` · สต็อก `6666` · บัญชี `7777`
(โหมด API: เชื่อมต่อด้วย `owner@sabai.dev` แล้วเลือกคนและใส่ PIN เหมือนกัน)

## สองโหมด โค้ดเดียว

หน้าเว็บทุกหน้าเรียกผ่าน `DataSource` ตัวเดียว ([ADR-0009](docs/adr/0009-datasource.md)) — สลับด้วยตัวแปรตอน build:

| โหมด | `NEXT_PUBLIC_DATA_SOURCE` | ข้อมูลอยู่ที่ | ใช้เมื่อ |
|---|---|---|---|
| demo (ค่าเริ่มต้น) | `demo` | เบราว์เซอร์ (engine ที่ใช้กฎเดียวกับฐานข้อมูล) | ทดลอง/สาธิต — สิ่งที่ deploy บน Vercel |
| API | `api` (+ `NEXT_PUBLIC_API_URL`) | Postgres ผ่าน API | ร้านจริง: หลายเครื่อง, สตรีมสด, คิวออฟไลน์, เข้าสู่ระบบ/สมัคร, เครื่องร้าน, พิมพ์, ค่าบริการ |

โหมด API ทำได้แม้เน็ตหลุด: ออเดอร์/การรับเงินที่ส่งไม่ถึงเซิร์ฟเวอร์เก็บในเครื่องแล้วส่งซ้ำเองโดยไม่ตัดสต็อก/รับเงินซ้ำ;
ค่าบริการของร้านเองค้างชำระ **ไม่เคยหยุดการขาย** (จำกัดเฉพาะการเพิ่มสาขา/พนักงาน/เครื่อง หลังผ่อนผัน 14 วัน)

## โครงสร้าง

```
apps/
  web/        Next.js 16 + React 19 + Tailwind 4 + Motion — UI ทุกบทบาท, DataSource (demo | HTTP), offline queue,
              service worker, พิมพ์ ESC/POS, ใบกำกับภาษี; browser tests ใน e2e/
  api/        Hono + postgres.js — 88 endpoints + SSE, OpenAPI จาก zod, billing, observability
packages/
  domain/     ตรรกะธุรกิจบริสุทธิ์ (เงิน/VAT, สูตร, สต็อก, สิทธิ์, กระทบยอด, analytics, PromptPay, billing, ภาษี)
  contracts/  zod schemas (validation + OpenAPI)
  observability/  OpenTelemetry + log JSON + รายงานข้อผิดพลาด (ปิดเป็นค่าเริ่มต้น)
  db/         SQL test runner + seed ร้านตัวอย่าง
supabase/migrations/   Postgres: 75 ตาราง (+ audit.log), RLS ทุกตาราง, 103 functions, 7 views ใน 26 migrations
tools/qa/     Lighthouse (งบประมาณ, โหมดเดโม/API) · tools/load/ load probe ของ API
scripts/      e2e.sh (เหมือน CI) · stack-dev.sh
docs/         เอกสารทั้งหมด (ด้านล่าง)
```

## เอกสาร

| | |
|---|---|
| [00 Master Development Prompt](docs/00-master-dev-prompt.md) | ข้อกำหนดที่ตรวจสอบได้ + quality gates + definition of done |
| [01 Product Vision](docs/01-product-vision.md) | ปัญหา กลุ่มลูกค้า ตัวชี้วัด ตำแหน่งในตลาด |
| [02 UX Principles](docs/02-ux-principles.md) | หลักการ 8 ข้อ, design tokens, contrast ที่วัดได้, motion, dataviz |
| [03 Roles & Permissions](docs/03-roles-permissions.md) | ตารางสิทธิ์ 34 × 7 ตำแหน่ง, การอนุมัติด้วย PIN |
| [04 Architecture](docs/04-architecture.md) | modular monolith, เส้นทางข้อมูล, ออฟไลน์, billing, หน้าจอแรกบนมือถือ, **เส้นทางการเติบโต**, สถานะตรงไปตรงมา |
| [05 Database](docs/05-database.md) | โมดูล, invariants ที่ DB บังคับ, RLS pattern |
| [06 API](docs/06-api.md) | หลักการ, error ภาษาคน, รายการ 88 endpoints (มีเทสต์บังคับให้ตรงกับ route จริง) |
| [07 Roadmap](docs/07-roadmap.md) | V1 → V1.1 → V2 → ปีที่ 2 |
| [08 Scorecard](docs/08-scorecard.md) | คะแนน + หลักฐาน + เทียบคู่แข่ง + ข้อจำกัด |
| [09 Observability](docs/09-observability.md) · [10 SLO](docs/10-slo.md) | trace/metric/log/error tracking · เป้าหมายความน่าเชื่อถือและตัวเลขที่วัดจริง |
| [V1.1 checklist](docs/v1.1-checklist.md) | งาน V1.1 ทีละข้อ พร้อมบันทึกการตรวจและข้อจำกัดของแต่ละข้อ |
| [ADR](docs/adr/) | บันทึกการตัดสินใจเชิงสถาปัตยกรรม 9 ฉบับ |
| [Research](docs/research/market-ux-research.md) | ตลาดไทย, GP, VAT, PromptPay, KDS, WCAG, RLS |

## สถานะ

**V1.1 เสร็จทุกข้อที่ไม่ต้องใช้บัญชีภายนอก** — หน้าเว็บต่อกับ API จริงทุกหน้า ([checklist](docs/v1.1-checklist.md)). ที่ **ยังไม่ได้ทำ**
(ต้องมีข้อมูล/บัญชีจากเจ้าของโปรเจกต์ ไม่ได้แกล้งทำ):

- **Supabase Auth จริง** — โค้ดฝั่งเว็บ/API พร้อมและทดสอบกับ GoTrue จำลอง แต่ยังไม่เคยต่อกับโปรเจกต์ Supabase จริง (ตอนนี้ใช้ `AUTH_MODE=local`)
- **ผู้ให้บริการรับบัตร/พร้อมเพย์** — ค่าบริการรายเดือน/รายปีใช้ใบแจ้งหนี้ + โอนพร้อมเพย์ที่ทีมงานยืนยัน (`BILLING_PROVIDER=manual`)
- **Deploy API + Postgres** — เว็บโหมดเดโมอยู่บน Vercel; API ยังไม่ได้ deploy (และยังไม่มีแผนสำรองข้อมูล)
- ยังไม่ได้ทดสอบ: เครื่องพิมพ์ความร้อนจริง, screen reader จริง, เบราว์เซอร์อื่นนอกจาก Chromium, ผู้ใช้จริงในร้าน

ข้อจำกัดทั้งหมดและเหตุผลอยู่ใน [scorecard ข้อ 5](docs/08-scorecard.md#5-ข้อจำกัดที่ต้องรู้-หมวด-h--88)
