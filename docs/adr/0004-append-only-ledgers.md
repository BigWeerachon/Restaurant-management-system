# ADR-0004: Ledger ห้ามแก้ + บัญชีคู่อัตโนมัติ

- สถานะ: ยอมรับ · วันที่: 2026-09-27

## การตัดสินใจ
- `stock_movements`, `payments`, `journal_lines`, `audit.log` เป็น append-only (`forbid_mutation` → `LEDGER_IMMUTABLE`)
- แก้ผิดด้วย **รายการกลับ** (reverse) ไม่ใช่ update
- ยอดคงเหลือ (`stock_balances`) เป็นผลรวมที่ trigger ดูแล พร้อมต้นทุนเฉลี่ยเคลื่อนที่
- ปิดยอดประจำวันสร้าง journal สรุป (ขาย/VAT/ต้นทุน/ของเสีย/เงินสด) และตรวจงบดุลด้วย deferred constraint

## ผลที่ตามมา
- ✅ ตรวจสอบย้อนหลังได้ทุกบาททุกกรัม, เปิดวันใหม่ = กลับรายการอัตโนมัติ
- ⚠️ ตารางโตเร็ว → partition รายเดือนเมื่อถึงขนาด (growth path)
