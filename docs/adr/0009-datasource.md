# ADR-0009: DataSource — หน้าเว็บชุดเดียว ทำงานได้ทั้งโหมดเดโมและ API

- สถานะ: ยอมรับ · วันที่: 2026-09-28 · ต่อจาก [ADR-0007](0007-demo-adapter.md)

## บริบท
หน้าเว็บทุกหน้าอ่านข้อมูลจาก store รูปแบบ `DemoState` และเรียกคำสั่งของ engine ตรงๆ
(`exec((draft, ctx) => payOrder(draft, ctx, …))`) — ผูกกับเดโมแน่น แต่ UI ผ่าน QA แล้ว (axe 0, Lighthouse 100)
จึงไม่ควรเขียนหน้าใหม่ทั้งหมด

## การตัดสินใจ

```
             ┌──────────── pages (ไม่รู้ว่าโหมดไหน) ────────────┐
   อ่าน: useSabai(s => s.db)  ·  สั่ง: exec(ds => ds.payOrder(…))  ·  ถาม: useQuery(ds.reportSummary)
             └───────────────┬──────────────────────────────────┘
                     DataSource (interface เดียว)
             ┌───────────────┴───────────────┐
      DemoDataSource                    HttpDataSource
  engine ใน Immer draft          API client → map DTO → เขียนลง store
  (เหมือนเดิมทุกอย่าง)            (idempotency key, error → ERROR_CATALOG)
```

1. **Store เดียว (`ShopState` = รูปแบบ `DemoState` เดิม)** เป็น client cache ที่ทุกหน้าอ่าน — โหมด API เติมข้อมูลด้วย loader
2. **Command registry** — ทุกคำสั่งที่ UI ใช้มีชื่อและชนิดข้อมูลชัดเจนใน `DataSource`
   (`submitOrder`, `payOrder`, `voidItem`, `receiveGoods`, `closeDay`, …) หน้าเว็บเรียกผ่าน `exec(ds => …)` เท่านั้น
3. **Approval token** — `ds.approve(permission, pin)` คืน token ที่ส่งต่อให้คำสั่งได้ทันที
   (เดโม = id ผู้อนุมัติ, API = `approvalId` ที่ใช้ได้ครั้งเดียว) ส่วน dialog และ flow ขออนุมัติใช้ร่วมกัน
4. **Loaders** — `ds.load(slice)` (`bootstrap`, `orders`, `tickets`, `stock`, …): เดโม = ไม่ทำอะไร, API = ดึงแล้ว map ลง store
   หน้าเรียกผ่าน `useLoad([...])`; SSE สั่ง reload เฉพาะ slice ที่มี event
5. **Queries ที่คำนวณหนัก** (รายงาน, สถิติวันนี้) เป็นเมธอดแยก: เดโม = selector เดิมบนข้อมูลย้อนหลัง, API = endpoint ที่คืนโครงสร้างเดียวกัน
6. **เลือกโหมด**: `NEXT_PUBLIC_DATA_SOURCE=demo|api` (+ `NEXT_PUBLIC_API_URL`); ถ้าตั้ง API ไว้ หน้าแรกจะมีทั้ง "ร้านตัวอย่าง" และ "เข้าสู่ระบบร้านจริง"
7. **Mapper อยู่ที่ขอบ** — แปลงหน่วย (สตางค์ ↔ ทศนิยม), ชื่อฟิลด์, ค่าเริ่มต้นของฟิลด์ที่ UI ต้องใช้ (เช่น emoji) มี unit test ครอบ

## ผลที่ตามมา
- ✅ ย้ายทีละหน้าได้ แต่ละหน้าทดสอบได้ทั้งสองโหมดด้วยชุดเทสต์ Playwright ชุดเดียว
- ✅ เดโมยังเปิดได้ทันทีโดยไม่ต้องมีเซิร์ฟเวอร์ (ใช้ขายของและสาธิต)
- ⚠️ store เป็นรูปแบบฝั่ง client — การเปลี่ยน schema ต้องแก้ mapper; ลดความเสี่ยงด้วย contract test ฝั่ง API + mapper test ฝั่งเว็บ
- ⚠️ ข้อมูลโหมด API ใน store เป็น cache: ความถูกต้องมาจากเซิร์ฟเวอร์เสมอ (คำสั่งคืนผลจริงแล้ว reload)
