# ADR-0001: Modular monolith (ไม่ใช่ microservices ตั้งแต่วันแรก)

- สถานะ: ยอมรับ · วันที่: 2026-09-27

## บริบท
ทีมเล็ก ต้องส่งมอบ POS + ครัว + สต็อก + การเงิน ที่ข้อมูลเชื่อมกันแน่น (ขาย 1 บิล กระทบ 6 โมดูลใน transaction เดียว)
microservices จะทำให้ต้องทำ distributed transaction/saga ตั้งแต่วันแรก และ debug ยาก

## การตัดสินใจ
- Deploy เดียว (API + Postgres) แต่แบ่งโมดูลชัด: route file ต่อโมดูล, SQL migration ต่อโมดูล, package `domain` ต่อแนวคิด
- โมดูลคุยกันผ่าน **domain events (outbox)** ไม่ใช่เรียกตารางของกันและกันจากภายนอก
- กฎ import: `domain` ไม่พึ่งใคร, app พึ่ง `domain` + `contracts`

## ผลที่ตามมา
- ✅ ความถูกต้องของเงิน/สต็อกอยู่ใน transaction เดียว
- ✅ แยก service ภายหลังได้ตามรอยต่อ events (reporting → integrations → notifications)
- ⚠️ ต้องรักษาวินัยเรื่องขอบเขตโมดูลด้วย code review
