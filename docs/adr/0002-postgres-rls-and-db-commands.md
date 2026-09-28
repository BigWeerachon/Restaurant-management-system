# ADR-0002: Postgres RLS + คำสั่งเขียนเป็น database functions

- สถานะ: ยอมรับ · วันที่: 2026-09-27

## บริบท
SaaS หลายร้านบนฐานข้อมูลเดียว: ข้อมูลรั่วข้ามร้านคือความเสียหายสูงสุด
และกฎธุรกิจ (สต็อก, บัญชีคู่, เลขเอกสาร) ต้องถูกต้องไม่ว่าเรียกจากช่องทางใด

## การตัดสินใจ
- RLS ทุกตาราง ผ่าน procedure มาตรฐาน `app.apply_tenant_rls` (policy ใช้ `(select …)` ให้ optimizer cache)
- คำสั่งเขียนเป็น `security definer` function: `assert_permission` → ตรวจกฎ → เขียน → emit event ใน transaction เดียว
- API ตั้ง `set local role authenticated` + JWT claims ต่อ request; ไม่มี query ที่ข้าม RLS ใน request path
- composite FK `(tenant_id, id)` ทุกความสัมพันธ์

## ผลที่ตามมา
- ✅ บั๊กใน API ไม่ทำให้ข้อมูลข้ามร้าน (มีเทสต์แยกร้านใน SQL และ API)
- ✅ พร้อม shard ด้วย Citus ตาม `tenant_id`
- ⚠️ ตรรกะบางส่วนอยู่ใน PL/pgSQL → มี SQL e2e test และสูตรคำนวณที่ซ้ำกับ `domain` มี parity test
