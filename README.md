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

## คุณภาพที่วัดได้

| | ผล |
|---|---|
| Lighthouse desktop (10 หน้า ล็อกอินแล้ว) | **100 / 100 / 100 / 100** ทุกหน้า |
| Lighthouse mobile (4G + CPU 4×) | Performance 93–100, Accessibility/Best practices/SEO **100** |
| axe-core WCAG 2.2 AA | **0 violations** — 21 หน้า × สว่าง/มืด + 12 สถานะ dialog/มือถือ |
| Tests | SQL e2e 83 assertions · domain 69 · API 25 · web 6 — ผ่านทั้งหมด |
| คะแนนประเมิน | ฟังก์ชัน **95** · หน้าตา **96** · animation **95** · รวมทั้งโปรเจกต์ 94.2 ([scorecard](docs/08-scorecard.md)) |

## เริ่มใช้งาน

```bash
# ต้องมี Node 22+, pnpm 10, Postgres 16
pnpm install

# 1) ทดลองหน้าเว็บทันที (ร้านตัวอย่าง + ข้อมูล 30 วัน ไม่ต้องมีเซิร์ฟเวอร์)
pnpm --filter @sabai/web dev            # http://localhost:3000

# 2) ฐานข้อมูล + API
pnpm db:test                            # สร้าง DB ทดสอบ รันทุก migration และ SQL e2e
pnpm db:reset                           # ติดตั้ง migrations ลง sabai_dev
cp apps/api/.env.example apps/api/.env
pnpm --filter @sabai/api dev            # http://localhost:8787 · OpenAPI: /v1/openapi.json

# ตรวจทั้งหมด
pnpm typecheck && pnpm test && pnpm build
```

ร้านตัวอย่าง: เลือกบทบาทที่หน้าแรกได้เลย หรือสลับผู้ใช้ด้วย PIN —
เจ้าของ `1234` · ผู้จัดการ `2222` · แคชเชียร์ `3333` · เสิร์ฟ `4444` · ครัว `5555` · สต็อก `6666` · บัญชี `7777`

## โครงสร้าง

```
apps/
  web/        Next.js 16 + React 19 + Tailwind 4 + Motion — UI ทุกบทบาท (ทำงานบน demo adapter)
  api/        Hono + postgres.js — 53 endpoints + SSE, OpenAPI จาก zod
packages/
  domain/     ตรรกะธุรกิจบริสุทธิ์ (เงิน/VAT, สูตร, สต็อก, สิทธิ์, กระทบยอด, analytics, PromptPay)
  contracts/  zod schemas (validation + OpenAPI)
  db/         SQL test runner
supabase/migrations/   Postgres: 72 ตาราง, RLS ทุกตาราง, 85 functions, 7 views
tools/qa/     axe + Lighthouse (รันซ้ำได้)
docs/         เอกสารทั้งหมด (ด้านล่าง)
```

## เอกสาร

| | |
|---|---|
| [00 Master Development Prompt](docs/00-master-dev-prompt.md) | ข้อกำหนดที่ตรวจสอบได้ + quality gates + definition of done |
| [01 Product Vision](docs/01-product-vision.md) | ปัญหา กลุ่มลูกค้า ตัวชี้วัด ตำแหน่งในตลาด |
| [02 UX Principles](docs/02-ux-principles.md) | หลักการ 8 ข้อ, design tokens, contrast ที่วัดได้, motion, dataviz |
| [03 Roles & Permissions](docs/03-roles-permissions.md) | ตารางสิทธิ์ 34 × 7 ตำแหน่ง, การอนุมัติด้วย PIN |
| [04 Architecture](docs/04-architecture.md) | modular monolith, เส้นทางข้อมูล, ความปลอดภัย, **เส้นทางการเติบโต** |
| [05 Database](docs/05-database.md) | โมดูล, invariants ที่ DB บังคับ, RLS pattern |
| [06 API](docs/06-api.md) | หลักการ, error ภาษาคน, รายการ endpoints |
| [07 Roadmap](docs/07-roadmap.md) | V1 → V1.1 → V2 → ปีที่ 2 |
| [08 Scorecard](docs/08-scorecard.md) | คะแนน + หลักฐาน + เทียบคู่แข่ง + ข้อจำกัด |
| [ADR](docs/adr/) | บันทึกการตัดสินใจเชิงสถาปัตยกรรม 8 ฉบับ |
| [Research](docs/research/market-ux-research.md) | ตลาดไทย, GP, VAT, PromptPay, KDS, WCAG, RLS |

## สถานะ

V1 ครบทุกโมดูลทั้งฐานข้อมูล, API และ UI — หน้าเว็บยังใช้ **demo adapter** ในเบราว์เซอร์ (จำลองคำสั่ง DB ชุดเดียวกัน)
งานถัดไปคือเชื่อม UI กับ API ผ่าน `DataSource` adapter, auth, พิมพ์ใบเสร็จ และ CI ([roadmap V1.1](docs/07-roadmap.md#v11--ใช้งานจริงในร้าน-03-เดือน))
