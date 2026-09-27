# งานวิจัยประกอบการออกแบบ (Market & UX Research)

> สรุปข้อค้นพบที่ใช้ตัดสินใจออกแบบ Sabai — อัปเดต 27 ก.ย. 2026
> ตัวเลขราคา/ค่าคอมมิชชันเปลี่ยนบ่อย ระบบจึงออกแบบให้ **ตั้งค่าได้ทั้งหมด** ไม่ hard-code

## 1. ตลาด POS ร้านอาหารในไทย

| ผู้เล่น | จุดแข็งที่สังเกตได้ | ช่องว่างที่ Sabai เข้าไปเติม |
|---|---|---|
| FoodStory / Wongnai POS (กลุ่ม LINE MAN Wongnai) | ฐานลูกค้า 60,000+ ร้าน, ออเดอร์ LINE MAN เข้าครัวอัตโนมัติ, ตั้งราคาต่อช่องทางขายได้, PromptPay QR | ต้นทุน/กำไรจริงหลังหัก GP + ค่าธรรมเนียม + ของเสีย ยังต้องทำเองใน Excel, บัญชีเจ้าหนี้/กระทบยอดธนาคารไม่ครบ |
| Ocha POS | ราคาถูก (~799 บาท/เดือน) เหมาะร้านเล็ก/คาเฟ่ | สต็อกหลายคลัง, ครัวกลาง, การเงินเชิงลึก |
| Loyverse | ฟรีเริ่มต้น, ใช้ง่าย | สูตรอาหาร/ต้นทุนจำกัด, ไม่มี KDS เชิงลึก, ไม่มีบัญชี |
| Toast / Square / Lightspeed (ต่างประเทศ) | KDS มาตรฐานสูง (timer สี, bump bar, expo), ecosystem ใหญ่ | ไม่รองรับบริบทไทย (PromptPay, GP เดลิเวอรีไทย, ภาษาไทย, ใบกำกับภาษีอย่างย่อ) |
| MarketMan / Apicbase (inventory & costing) | Actual vs Theoretical food cost, multi-site, recipe costing | เป็นระบบเสริม ต้องต่อกับ POS อื่น ข้อมูลไม่เป็นหนึ่งเดียว |
| Restaurant365 (บัญชีร้านอาหาร) | บัญชีเต็มรูปแบบ + inventory | ซับซ้อน ต้องมีนักบัญชี ไม่เหมาะร้าน SME ไทย |

**ข้อสรุปเชิงกลยุทธ์:** ตลาดไทยมี POS ที่ "ขายของได้" แล้ว แต่ยังไม่มีระบบเดียวที่ตอบคำถามเจ้าของร้านว่า
**"อะไรขายดี ขายที่ไหน ผ่านช่องทางไหน และสุดท้ายเหลือเงินจริงเท่าไร"** โดยพนักงานไม่ต้องเรียนระบบ
→ Sabai วาง POS + ครัว + สต็อก + สูตร + จัดซื้อ + การเงิน อยู่บน **ข้อมูลชุดเดียว (single ledger)** ตั้งแต่วันแรก

## 2. บริบทเฉพาะของไทยที่ต้องรองรับ

- **ค่า GP เดลิเวอรี** ปกติราว 25–30% ของยอดขาย แต่ผันผวนตามโปรโมชัน/โครงการรัฐ (มีช่วงลดเหลือ 7–9% หรือ 0%)
  → GP ต้องตั้งค่า **ต่อช่องทาง + มีวันเริ่ม/สิ้นสุด (effective dating)** เพื่อให้กำไรย้อนหลังยังถูกต้อง
- **VAT 7%** (อัตราลดหย่อนที่ใช้ต่อเนื่อง) — ร้านส่วนใหญ่ตั้งราคารวม VAT; ร้านบางประเภทคิด **Service charge 10%** ก่อน VAT ("++")
  → รองรับ `prices_include_vat` และ service charge ต่อช่องทาง (มักคิดเฉพาะ dine-in)
- **ใบกำกับภาษีอย่างย่อ** จากเครื่อง POS ที่ขออนุมัติ (ภ.พ.06) และ **e-Tax Invoice & e-Receipt** (ต้องใช้ใบรับรองดิจิทัล)
  → เลขที่เอกสารแยกลำดับต่อสาขา/เครื่อง ห้ามแก้ไขย้อนหลัง; e-Tax อยู่ใน roadmap V2
- **PromptPay QR** เป็นช่องทางหลัก ต้องสร้าง QR ตามยอด (EMVCo) และกระทบยอดกับ statement ธนาคารได้
- **วันทำการ (business date)** ร้านที่ปิดหลังเที่ยงคืนต้องนับยอดเข้า "วันทำการ" เดียวกัน → ตั้งเวลาตัดวันต่อสาขา (เช่น 05:00)
- **ปี พ.ศ.** แสดงผลตาม locale `th-TH` ได้ แต่เก็บข้อมูลเป็น ISO/UTC เสมอ

## 3. แนวปฏิบัติที่ดีด้านการดำเนินงาน (Operations)

- **Actual vs Theoretical food cost**: ต้นทุนทางทฤษฎี (จากสูตร × ยอดขาย) เทียบกับต้นทุนจริง (จากการนับสต็อก) ส่วนต่าง = ของเสีย, ตักเกิน, เน่าเสีย, สูญหาย
  → ต้องมี recipe + stock ledger + stock count + waste log บนข้อมูลเดียวกัน (MarketMan/Apicbase ทำแบบนี้)
- **Blind count**: คนนับไม่ควรเห็นยอดที่ระบบคาดไว้ เพราะจะเกิด anchoring bias นับให้ตรงเป้า
  → โหมดนับสต็อกของพนักงานเป็น blind count โดยค่าเริ่มต้น ผู้จัดการเห็นส่วนต่างหลังส่งผล
- **Shelf-to-sheet**: เรียงลำดับรายการตามตำแหน่งจริงบนชั้น (โซน → ชั้น → ซ้ายไปขวา) → รายการนับเรียงตาม `storage_zone`/`sort_order`
- **รอบนับ**: นับเต็มเดือนละครั้ง + cycle count รายสัปดาห์เฉพาะของมูลค่าสูง

## 4. แนวปฏิบัติ KDS (ครัว)

- Timer สี 3 ระดับ: เขียว (ทันเวลา) → เหลือง (ใกล้เกิน) → แดง (เกินเวลา) ปรับ threshold ตามประเภทร้าน
  (fast-casual ~5/8 นาที, fine dining ~15/22 นาที) → ตั้งค่าต่อสถานีได้
- **Bump**: แตะที่การ์ด/กดปุ่ม bump bar ให้รายการย้ายสถานะ; ครบทุกรายการ → ไปที่ expo/พร้อมเสิร์ฟ
- สีต้องมี **ไอคอน + ข้อความ** ประกอบเสมอ (ไม่ใช้สีอย่างเดียว — ผู้ตาบอดสี, หน้าจอสะท้อนแสง)
- ครัวเป็นระบบเดียวกันทั้งหมด: เมนู, สถานี, modifier, จังหวะเสิร์ฟ, การแจ้งเตือน ต้องตั้งค่าและทดสอบร่วมกัน

## 5. แนวปฏิบัติ UX/Accessibility ที่นำมาใช้เป็นเกณฑ์

| เกณฑ์ | ค่าที่ใช้ใน Sabai |
|---|---|
| WCAG 2.2 SC 2.5.8 (AA) touch target ≥ 24px | **ขั้นต่ำ 44px ทุกปุ่ม**, ปุ่มหลักใน POS/KDS **≥ 56–64px** (Apple HIG 44pt, Material 48dp) |
| Contrast (WCAG AA 4.5:1) | ตรวจทุก token สีทั้ง light/dark, KDS ใช้ dark high-contrast |
| Doherty threshold (< 400ms) | POS ตอบสนองการแตะ < 100ms ด้วย optimistic UI + local-first |
| Hick's law | เมนูนำทางต่อบทบาท ≤ 5–6 รายการ |
| Progressive disclosure | ฟิลด์ขั้นสูงซ่อนใต้ "ตัวเลือกเพิ่มเติม" |
| `prefers-reduced-motion` | ปิด/ลดแอนิเมชันอัตโนมัติ |

## 6. แนวปฏิบัติด้านความปลอดภัยข้อมูล (Multi-tenant RLS)

- ใช้ Postgres Row Level Security ทุกตาราง, `tenant_id` อยู่ในทุกแถว, index ทุกคอลัมน์ที่ policy ใช้
- ห่อฟังก์ชันใน `(select ...)` ให้ optimizer ทำ initPlan (cache ต่อ query แทนที่จะเรียกต่อแถว) — วัดผลได้เร็วขึ้นหลักร้อยเท่า
- เขียนเป็น `tenant_id in (select app.user_tenant_ids())` แทน join ต่อแถว; ใช้ `security definer` function ที่ fix `search_path`

## แหล่งอ้างอิง

- Grab TH — Thais Help Thais Plus 60/40 (GP 9%): https://www.grab.com/th/en/press/others/grabfoodthaishelpsthaisplus/
- Bangkok Post — Food delivery operators cut commissions: https://www.bangkokpost.com/business/2121987/food-delivery-operators-cut-commissions
- Grab commission fees explained: https://thegrabmethod.com/grab-commission-fees-profit-tips/
- FoodStory — เทียบ 5 แบรนด์ POS ไทย: https://foodstory.co/2024/02/16/5-pos-in-thailand/
- Wongnai — Wongnai POS vs Ocha POS: https://www.wongnai.com/pos-articles/wongnaipos-vs-ochapos
- Best Restaurant POS Systems in Thailand (2026): https://emenuthailand.com/blog/tpost/best-restaurant-pos-systems-thailand-2026
- MarketMan — Actual vs Theoretical: https://www.marketman.com/page/actual-vs-theoretical-food-cost-report
- Apicbase — Food cost control multi-site: https://get.apicbase.com/food-cost-control/
- Toast — Shelf-to-sheet counts: https://pos.toasttab.com/blog/on-the-line/shelf-to-sheet-inventory-counts
- Jelly — Advanced stocktake techniques (blind count): https://blog.getjelly.co.uk/advanced-restaurant-stocktake-techniques/
- Toast KDS overview / bump bar: https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html
- Shift4 — KDS ticket timer settings: https://shift4.zendesk.com/hc/en-us/articles/4940115080083-Set-up-the-Kitchen-Display-System-Ticket-Timer-Settings
- KwickOS — KDS guide 2026: https://kwickos.com/blog/best-kitchen-display-system-kds-2026.html
- W3C — Understanding Target Size: https://w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- Thailand.go.th — Types of tax invoices: https://www.thailand.go.th/issue-focus-detail/006_124
- vatcalc — Thailand e-Tax invoice update: https://www.vatcalc.com/thailand/thailand-e-invoicing-e-tax-and-invoice-receipt-update/
- The Finest Thai — Plus-plus pricing (VAT + service charge): https://www.thefinestthai.com/2026/05/31/thailand-plus-plus-pricing-vat-service-charge-guide/
- Supabase — RLS performance & best practices: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
