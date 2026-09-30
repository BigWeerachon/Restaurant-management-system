# ADR-0007: Demo adapter ในเบราว์เซอร์ (และแผนเชื่อม API)

- สถานะ: ยอมรับ (ชั่วคราว) · วันที่: 2026-09-27

## บริบท
ต้องให้ผู้มีส่วนได้ส่วนเสียทดลองทุกหน้าได้ทันที (ไม่ต้องตั้งเซิร์ฟเวอร์) และให้ UX ถูกตรวจด้วยข้อมูลที่สมจริง

## การตัดสินใจ
- `apps/web/src/lib/demo`: engine ที่จำลองคำสั่ง DB ชุดเดียวกัน (ชื่อ/กฎ/รหัส error เดียวกัน) ใช้ `domain` ชุดเดียวกับ API
- ทุกคำสั่งรันแบบ atomic ด้วย Immer (ล้มเหลว = ไม่มีอะไรเปลี่ยน) และเก็บใน localStorage
- ข้อมูลย้อนหลัง 30 วันสร้างแบบ deterministic (seeded PRNG) → ภาพหน้าจอและคะแนนทำซ้ำได้

## แผนถัดไป (V1.1)
- สร้าง `DataSource` interface (commands + queries) → `DemoDataSource` และ `HttpDataSource`
- สลับด้วย `NEXT_PUBLIC_DATA_SOURCE=demo|api`; รันชุดเทสต์ UI เดียวกันกับทั้งสอง adapter
