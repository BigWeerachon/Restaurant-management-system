"use client";

import { LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/primitives";
import { useBilling } from "@/hooks/use-data-source";

/**
 * Says where the shop stands with its own bill, to whoever may manage billing, at the top of every back-office page.
 * It only ever informs: a late bill never blocks the till or the kitchen, and this banner says so in plain words.
 * (The till and the kitchen screen sit outside this shell, and never show it.)
 */
export function BillingBanner() {
  const { billing } = useBilling();
  if (!billing) return null;
  const { stage } = billing;
  const pay = (
    <LinkButton href="/settings?tab=plan" size="sm" variant="secondary">
      {billing.openInvoice && billing.mode === "invoice" ? "ดูใบแจ้งหนี้และชำระเงิน" : "ดูแพ็กเกจ"}
    </LinkButton>
  );

  if (stage.kind === "restricted") {
    return (
      <Callout tone="danger" className="mb-4" action={pay} title="ค่าบริการค้างชำระเกินช่วงผ่อนผัน — เพิ่มสาขา พนักงาน หรือเครื่องใหม่ไม่ได้ชั่วคราว">
        การขาย ครัว และรายงานยังใช้ได้ตามปกติ ชำระแล้วทุกอย่างกลับมาใช้ได้ทันที
      </Callout>
    );
  }
  if (stage.kind === "past_due") {
    return (
      <Callout tone="warning" className="mb-4" action={pay} title={`ค่าบริการถึงกำหนดแล้ว ยังไม่ได้ชำระ · เหลือช่วงผ่อนผัน ${stage.daysLeft ?? 0} วัน`}>
        ตอนนี้ทุกอย่างยังใช้ได้ครบ ถ้าเลยช่วงผ่อนผันจะเพิ่มสาขา พนักงาน หรือเครื่องใหม่ไม่ได้ แต่การขายไม่หยุด
      </Callout>
    );
  }
  if (stage.kind === "canceled" && billing.status === "canceled") {
    return (
      <Callout tone="info" className="mb-4" action={pay} title="ช่วงทดลองใช้ฟรีหรือแพ็กเกจเดิมสิ้นสุดแล้ว ตอนนี้ร้านใช้แพ็กเกจฟรี">
        ข้อมูลทั้งหมดอยู่ครบ เลือกแพ็กเกจเมื่อพร้อมเพื่อใช้ฟีเจอร์ที่มากกว่าเดิม
      </Callout>
    );
  }
  if (stage.kind === "trial" && stage.daysLeft !== null && stage.daysLeft <= 7) {
    return (
      <Callout tone="info" className="mb-4" action={pay} title={`ทดลองใช้ฟรีเหลือ ${stage.daysLeft} วัน`}>
        เมื่อครบกำหนด ร้านจะใช้แพ็กเกจฟรีต่อโดยไม่เสียค่าใช้จ่าย เลือกแพ็กเกจได้ทุกเมื่อ
      </Callout>
    );
  }
  return null;
}
