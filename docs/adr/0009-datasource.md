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

## ผลจริงเมื่อปิด V1.1 (เพิ่มเมื่อ 30 ก.ย. 2569)

- ✅ ทุกหน้าย้ายมาแล้วและใช้ชุด browser tests เดียวกันทั้งสองโหมด (72 เดโม / 68 API ใน CI) — สมมุติฐาน "ย้ายทีละหน้า ทดสอบทีละโหมด" ใช้ได้จริง
- ✅ Approval token, loaders, `useLoad`, SSE → slice, คิวออฟไลน์ (คำสั่งค้างเก็บใน IndexedDB แล้วส่งด้วย `Idempotency-Key` เดิม) ทำงานผ่าน interface เดียวโดยหน้าเว็บไม่รู้ว่าอยู่โหมดไหน
- ⚠️ **ต้นทุนที่ไม่ได้คาดไว้:** เมื่อ import ทั้งสอง adapter ตรงๆ โหมดเดโมแบกโค้ด API ทั้งหมดไปด้วย (+154 KB หลังย่อบนหน้าแรก) และหน้าแรกบนมือถือช้าลงเห็นได้ (Lighthouse mobile 93–100 → 76–83) แก้แล้วโดยให้ `getDataSource()` ตอบผ่าน stand-in ที่โหลด HTTP adapter ตอนเรียกครั้งแรก และให้ส่วนที่ใช้เฉพาะโหมด API (สตรีมสด, คิวออฟไลน์, แผงเข้าสู่ระบบ) เป็นดาวน์โหลดแยก — **กฎใหม่:** โค้ดที่โหมดหนึ่งไม่ใช้ต้องไม่อยู่ใน bundle แรกของอีกโหมด ([04 §5e](../04-architecture.md)); ผลหลังแก้ 85–94
- ⚠️ Store ยังเป็นรูปแบบฝั่ง client ตามที่คาด — mapper ทุกตัวมี test ของตัวเอง และ API มีเทสต์ที่บังคับให้เอกสารตรงกับ route จริง แต่ schema ที่เปลี่ยนยังต้องแก้ mapper ด้วยมือ

