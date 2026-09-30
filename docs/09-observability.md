# Observability — ดูแลระบบให้ทันก่อนลูกค้าโทรมา (ข้อ 9.1)

เป้าหมาย: เมื่อมีอะไรผิดปกติ ทีมงานรู้ก่อน รู้ว่าที่ไหน และตามจากรหัสอ้างอิงบนหน้าจอลูกค้าไปถึงบรรทัดโค้ดได้ — **โดยไม่เอาข้อมูลของร้านหรือของคนไปอยู่ในระบบที่สาม**

ทุกอย่างปิดอยู่เป็นค่าเริ่มต้น (ไม่ตั้งตัวแปร = ไม่ส่งอะไรออกไปเลย, ไม่มีต้นทุน) และเดโมบน Vercel ไม่ส่งอะไร

## เปิดใช้อย่างไร

| ตัวแปร | ที่ | ผล |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | API | เปิด traces + metrics (OTLP/HTTP) ไปยัง collector หรือผู้ให้บริการ (Grafana Cloud, Honeycomb, Datadog OTLP intake, ฯลฯ) |
| `OTEL_EXPORTER_OTLP_HEADERS` | API | key ของผู้ให้บริการ (`k=v,k2=v2`) |
| `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLE_RATIO` | API | ชื่อบริการ (`sabai-api`) และสัดส่วน trace ใหม่ที่เก็บ (ค่าเริ่มต้น 1) — trace ที่ผู้เรียกตัดสินใจเก็บแล้วจะเก็บตามเสมอ |
| `ERROR_TRACKING_DSN` (หรือ `SENTRY_DSN`) | API | ส่งข้อผิดพลาดที่ไม่คาดคิดไปยัง Sentry / GlitchTip |
| `NEXT_PUBLIC_ERROR_TRACKING_DSN` | เว็บ | เหมือนกัน แต่สำหรับข้อผิดพลาดในเบราว์เซอร์ (DSN สาธารณะ) |
| `RELEASE` / `NEXT_PUBLIC_RELEASE` | API / เว็บ | เวอร์ชันบน trace และรายงาน (ถ้าไม่ตั้ง ใช้ `VERCEL_GIT_COMMIT_SHA` / `GIT_SHA`) |

ตัวอย่างในเครื่อง: รัน OpenTelemetry Collector หรือ Jaeger ที่ `:4318` แล้ว `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm --filter @sabai/api dev` — เซิร์ฟเวอร์บอกใน log บรรทัด `listening` ว่า `tracing: true / error_tracking: true`

## สิ่งที่เก็บ

**Trace** — หนึ่ง span ต่อหนึ่งคำขอ ชื่อ `METHOD /route/:pattern` (ไม่ใช่ URL จริง จึงไม่มี id ในชื่อ) + หนึ่ง span `db.transaction` ต่อหนึ่งธุรกรรมฐานข้อมูล (ซ้อนอยู่ในคำขอที่เรียก) รับ `traceparent` จากผู้เรียกแล้วต่อ trace เดิม แอตทริบิวต์: method, route, status, `sabai.request_id`, `sabai.tenant_id`, `sabai.actor_id` (id เท่านั้น) — 4xx ไม่ทำให้ span เป็น error (คนใช้ทำผิด ไม่ใช่ระบบพัง) มีแต่ 5xx และข้อผิดพลาดของฐานข้อมูลที่ไม่ใช่ข้อความทางธุรกิจ

**Metrics** (label ไม่มี id/ร้าน/คน จึงมีจำนวนชุดข้อมูลคงที่):

| Metric | ชนิด | Label | ใช้ทำอะไร |
|---|---|---|---|
| `http.server.request.duration` (วินาที) | histogram (5 ms – 10 s) | method, route, status_class | p50/p95/p99 ต่อ route, อัตรา 5xx — พื้นฐานของ SLO |
| `http.server.active_requests` | up-down counter | method | งานที่ค้าง |
| `sabai.api.errors` | counter | code, route | ข้อผิดพลาดที่ตอบคน แยกตามรหัส (`INTERNAL`, `BILLING_RESTRICTED`, `PLAN_LIMIT_REACHED`, …) |

**Log** — JSON หนึ่งบรรทัดต่อเหตุการณ์ (`level, time, msg, service, …`) มี `trace_id`/`span_id` เมื่ออยู่ใน trace (ค้นจาก trace ไป log และกลับได้) และ `requestId` เดียวกับ header `X-Request-Id` / รหัสอ้างอิงที่ลูกค้าเห็น บรรทัด `request` มี route, status, ms, `actor` และ `tenant` (id)

**รายงานข้อผิดพลาด** — เฉพาะข้อผิดพลาดที่ไม่คาดคิด (`INTERNAL`, unhandled rejection/exception; เบราว์เซอร์: error ที่ไม่มีใครจับ และหน้าที่พัง) ไม่ส่งข้อความที่ระบบตอบคนใช้เอง (แผนเต็ม, PIN ผิด, ต้องเข้าสู่ระบบ) ไม่ส่งการเชื่อมต่อหลุด/ยกเลิกคำขอ/เครื่องพิมพ์ไม่ตอบ; ซ้ำภายใน 60 วินาทีส่งครั้งเดียว และไม่เกิน 20 ครั้งต่อนาที (พายุข้อผิดพลาดเป็นเหตุการณ์เดียว ไม่ใช่พันรายงาน) รหัสบนหน้าจอ "รหัสอ้างอิง 915C-B462" คือรหัสเดียวกับในรายงาน

## สิ่งที่ไม่เคยออกจากระบบ

- **Log และรายงาน:** ค่าใต้คีย์ที่อ่อนไหว (`authorization`, `cookie`, `token`, `pin`, `password`, `secret`, `signature`, `x-device-token`, `api key`, …) ถูกตัดทิ้งไม่ว่าอยู่ลึกแค่ไหน ข้อความที่หน้าตาเหมือนความลับถูกปิดบัง (Bearer token, JWT, รหัสอุปกรณ์ `sbd_…`, อีเมล, เลขยาว 9 หลักขึ้นไป = เบอร์โทร/เลขผู้เสียภาษี/บัตร)
- **ข้อผิดพลาดจากฐานข้อมูล** ส่งเฉพาะ SQLSTATE + ชื่อ constraint + ตาราง — ข้อความและ detail ของ Postgres มีค่าของแถวนั้น (เช่น ชื่อลูกค้า) จึงไม่ส่ง
- **URL** ตัด query string, fragment และ credentials; เส้นทางของหน้าในเบราว์เซอร์ปิดบัง uuid เป็น `:id`
- **ไม่ส่ง** body ของคำขอ, header, cookie, ชื่อ, อีเมล, ข้อความที่พิมพ์ — มี test ยืนยันทั้งสองฝั่ง (`packages/observability`, `apps/api/test/observability.test.ts`, `apps/web/src/lib/observability`)
- path ของไฟล์ในเครื่องนักพัฒนาถูกตัดเหลือ `app:///apps/...`

## เมื่อมีสายโทรเข้า

1. ลูกค้าอ่านรหัสอ้างอิง (`XXXX-XXXX`) จากหน้าจอ
2. เว็บ: ค้นรหัสนั้นใน `extra.digest` ของรายงาน — API: `X-Request-Id` เดียวกันอยู่ใน log (`requestId`) และแท็ก `request_id` ของรายงาน
3. จากรายงาน/`requestId` → ดู trace (`sabai.request_id`) เห็นว่าช้าที่ธุรกรรมฐานข้อมูลหรือที่อื่น → log ที่มี `trace_id` เดียวกัน

## ข้อจำกัดที่รู้อยู่

- ยังไม่มี collector, dashboard หรือ alert จริงบนโฮสต์ใด ๆ (API ยังไม่ได้ deploy) — เอกสารนี้และโค้ดเตรียมไว้ให้ต่อได้ด้วยตัวแปรสองสามตัว; ทดสอบกับ collector/tracker จำลองที่รับ OTLP และ Sentry envelope จริงแล้ว (ไม่ใช่กับ SaaS จริง)
- Trace ครอบคลุมฝั่ง API และฐานข้อมูล ยังไม่มี trace จากเบราว์เซอร์ (ยังไม่มี `traceparent` ออกจากหน้าเว็บ) และไม่มี Web Vitals
- ไม่มี auto-instrumentation ของไลบรารี (เลือกเองเพื่อคุมสิ่งที่ออกไป): เห็น span ของคำขอและธุรกรรม ไม่เห็นแต่ละ query
- Metrics ส่งทุก 30 วินาทีและตอนปิดเซิร์ฟเวอร์ (รอสูงสุด 3 วินาที) — เซิร์ฟเวอร์ที่ถูกฆ่าทันที (SIGKILL) อาจเสียช่วงสุดท้าย
- อัตราส่วนการเก็บข้อผิดพลาดและการลบข้อมูลซ้ำเป็นในหน่วยความจำของแต่ละโปรเซส (หลาย instance = ส่งได้มากกว่าหนึ่งครั้ง)
