import { createHmac } from "node:crypto";
import { expectAccessible } from "./support/a11y";
import { sql } from "./support/db";
import { API_URL, BILLING_JOB_SECRET, BILLING_WEBHOOK_SECRET } from "./support/env";
import { openPos, sellAndPay } from "./support/pos";
import { signIn } from "./support/session";
import { expect, test } from "./support/test";

/** What a payment provider (or the person confirming a transfer) sends: signed, or refused. */
async function webhook(id: string, type: string, data: Record<string, unknown>): Promise<{ outcome: string }> {
  const raw = JSON.stringify({ id, type, data });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac("sha256", BILLING_WEBHOOK_SECRET).update(`${t}.${raw}`).digest("hex")}`;
  const res = await fetch(`${API_URL}/v1/billing/webhook/manual`, { method: "POST", headers: { "content-type": "application/json", "x-sabai-signature": signature }, body: raw });
  expect(res.status, `webhook ${type}`).toBe(200);
  return (await res.json()) as { outcome: string };
}

/** The nightly job, run now. */
async function runJob(): Promise<Record<string, number>> {
  const res = await fetch(`${API_URL}/v1/billing/run`, { method: "POST", headers: { "content-type": "application/json", "x-job-secret": BILLING_JOB_SECRET }, body: "{}" });
  expect(res.status, "the job route").toBe(200);
  return (await res.json()) as Record<string, number>;
}

// The shop's own bill for using Sabai, end to end on the real API: a trial, an invoice, a signed payment, a missed
// renewal, the grace period, and — the rule that never bends — a till that keeps selling throughout.
for (const theme of ["light", "dark"] as const) {
  test.describe(`billing, ${theme}`, () => {
    test.use({ colorScheme: theme });

    test("trial → invoice → paid → overdue → restricted (the till keeps selling) → paid again", async ({ page, watch }) => {
      test.setTimeout(300_000);
      // Refusing a new branch to a shop that owes money is the point of the test, not a failure.
      watch.allow(/HTTP 402 POST \/v1\/branches/);
      // Start from a known bill: on a trial with 5 days left, nothing invoiced, no provider event seen.
      sql(`update app.subscriptions set plan_code='pro', status='trialing', billing_cycle='monthly', trial_ends_at=now()+interval '5 days', current_period_start=null, current_period_end=null, past_due_since=null, cancel_at_period_end=false, provider=null, provider_customer_id=null, provider_subscription_id=null; delete from app.subscription_invoices; delete from app.billing_events`);

      await signIn(page, "owner");

      await test.step("the last week of a trial: a quiet banner, and the details in Settings", async () => {
        await expect(page.getByText("ทดลองใช้ฟรีเหลือ 5 วัน").first()).toBeVisible();
        await expectAccessible(page, `home with the trial banner (${theme})`);
        await page.goto("/settings?tab=plan");
        await expect(page.getByText(/แพ็กเกจปัจจุบัน/)).toBeVisible();
        await expect(page.getByText("ไม่ว่าเกิดอะไรขึ้นกับการชำระค่าบริการ ระบบจะไม่หยุดการขายหน้าร้านของคุณ")).toHaveCount(1);
        await expect(page.getByText(/ราคารวม VAT/).first()).toBeVisible();
        await expectAccessible(page, `plan tab on a trial (${theme})`);
      });

      let invoiceNo = "";
      await test.step("a dearer plan, yearly, is an invoice to pay first — with the VAT split out and how to pay", async () => {
        await page.getByRole("radio", { name: /รายปี/ }).click();
        await page.getByRole("button", { name: "เปลี่ยนเป็นบิสิเนส" }).click();
        const confirm = page.getByRole("dialog", { name: /เปลี่ยนเป็นแพ็กเกจบิสิเนส/ });
        await expect(confirm.getByText(/ไม่คิดตามสัดส่วนวัน และไม่คืนเงิน/)).toBeVisible();
        await expectAccessible(page, `confirm plan (${theme})`);
        await confirm.getByRole("button", { name: "ยืนยัน" }).click();
        const pay = page.getByRole("dialog", { name: /ชำระใบแจ้งหนี้ INV-/ });
        await expect(pay).toBeVisible();
        invoiceNo = ((await pay.getByText(/INV-\d{4}-\d{5}/).first().textContent()) ?? "").match(/INV-\d{4}-\d{5}/)![0];
        await expect(pay).toContainText("฿34,900.00");
        await expect(pay).toContainText("รวม VAT ฿2,283.18");
        await expect(pay.getByRole("img", { name: /QR พร้อมเพย์ ยอด 34900\.00 บาท/ }), "a PromptPay QR with the amount locked").toHaveCount(1);
        await expect(pay).toContainText("123-4-56789-0");
        expect(sql("select invoice_no||' | '||status||' | '||kind||' | '||plan_code||' | '||billing_cycle||' | '||total from app.subscription_invoices where status='open'")).toBe(`${invoiceNo} | open | plan_change | business | yearly | 34900.00`);
        await expectAccessible(page, `how to pay (${theme})`);
        await pay.getByRole("button", { name: "ปิด", exact: true }).last().click();
        await expect(page.getByRole("button", { name: "ไม่เปลี่ยนแพ็กเกจแล้ว" })).toBeVisible();
        expect(sql("select status from app.subscriptions"), "nothing is applied until the money arrives").toBe("trialing");
        await expectAccessible(page, `the open invoice (${theme})`);
      });

      await test.step("changing their mind withdraws the invoice; asking again makes a new one", async () => {
        await page.getByRole("button", { name: "ไม่เปลี่ยนแพ็กเกจแล้ว" }).click();
        await expect(page.getByText("ยกเลิกใบแจ้งหนี้แล้ว").first()).toBeVisible();
        await expect(page.getByRole("button", { name: "ไม่เปลี่ยนแพ็กเกจแล้ว" })).toHaveCount(0);
        await page.getByRole("button", { name: "เปลี่ยนเป็นบิสิเนส" }).click();
        await page.getByRole("dialog", { name: /เปลี่ยนเป็นแพ็กเกจบิสิเนส/ }).getByRole("button", { name: "ยืนยัน" }).click();
        const pay = page.getByRole("dialog", { name: /ชำระใบแจ้งหนี้ INV-/ });
        await expect(pay).toBeVisible();
        const again = ((await pay.getByText(/INV-\d{4}-\d{5}/).first().textContent()) ?? "").match(/INV-\d{4}-\d{5}/)![0];
        expect(again).not.toBe(invoiceNo);
        invoiceNo = again;
        await pay.getByRole("button", { name: "ปิด", exact: true }).last().click();
      });

      await test.step("a payment counts only when it is signed and for the right amount — and the open page updates by itself", async () => {
        expect((await webhook("e2e-short", "invoice.paid", { invoiceNo, amount: "1.00" })).outcome).toBe("amount_mismatch");
        expect(sql("select status from app.subscriptions")).toBe("trialing");
        expect((await webhook("e2e-paid", "invoice.paid", { invoiceNo, amount: "34900.00", customerId: "cus_e2e", subscriptionId: "sub_e2e" })).outcome).toBe("paid");
        expect((await webhook("e2e-paid", "invoice.paid", { invoiceNo, amount: "34900.00" })).outcome, "the same event twice").toBe("duplicate");
        await expect(page.getByText("ใช้งานปกติ").first()).toBeVisible();
        await expect(page.getByRole("button", { name: "ไม่เปลี่ยนแพ็กเกจแล้ว" })).toHaveCount(0);
        expect(sql("select plan_code||' '||status||' '||billing_cycle from app.subscriptions")).toBe("business active yearly");
        await expectAccessible(page, `plan tab, paid (${theme})`);
      });

      await test.step("a year on, an unpaid renewal is overdue, with a banner and a grace period", async () => {
        sql("update app.subscription_invoices set period_start = period_start - 365, period_end = period_end - 365; update app.subscriptions set current_period_start = now() - interval '365 days 1 hour', current_period_end = now() - interval '1 hour'");
        const job = await runJob();
        expect(job.invoiced, "the renewal was invoiced").toBeGreaterThanOrEqual(1);
        expect(job.past_due, "and is overdue").toBeGreaterThanOrEqual(1);
        await page.goto("/today");
        await expect(page.getByText(/ค่าบริการถึงกำหนดแล้ว ยังไม่ได้ชำระ · เหลือช่วงผ่อนผัน 14 วัน/)).toBeVisible();
        await expectAccessible(page, `home with the overdue banner (${theme})`);
        await page.goto("/settings?tab=plan");
        await expect(page.getByText(/ค้างชำระ · ผ่อนผันอีก 14 วัน/).first()).toBeVisible();
        await expectAccessible(page, `plan tab, overdue (${theme})`);
      });

      await test.step("past the grace period the shop cannot grow — but it keeps selling", async () => {
        sql("update app.subscriptions set past_due_since = now() - interval '20 days'");
        expect((await runJob()).restricted).toBeGreaterThanOrEqual(1);
        await page.goto("/today");
        await expect(page.getByText(/ค้างชำระเกินช่วงผ่อนผัน — เพิ่มสาขา พนักงาน หรือเครื่องใหม่ไม่ได้ชั่วคราว/)).toBeVisible();
        await expectAccessible(page, `home with the restricted banner (${theme})`);

        await openPos(page);
        const receipt = await sellAndPay(page, /ข้าวไข่เจียว/);
        expect(receipt, "the till took cash and gave a receipt").not.toBe("");

        await page.goto("/settings?tab=branches");
        await page.getByRole("button", { name: /เพิ่มสาขา/ }).first().click();
        const add = page.getByRole("dialog");
        await add.getByLabel(/^ชื่อสาขา/).fill("สาขาที่ไม่ควรเพิ่มได้");
        await add.getByRole("button", { name: /^(เพิ่มสาขา|บันทึก)/ }).last().click();
        await expect(page.getByText("ค่าบริการค้างชำระ", { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/ตอนนี้เพิ่มสาขาใหม่ไม่ได้/).first()).toBeVisible();
        expect(sql("select count(*) from app.branches where name='สาขาที่ไม่ควรเพิ่มได้'"), "the branch was not created").toBe("0");
      });

      await test.step("paying the renewal puts everything back, on the open page", async () => {
        const renewal = sql("select invoice_no from app.subscription_invoices where status='open'");
        expect((await webhook("e2e-renew", "invoice.paid", { invoiceNo: renewal, amount: "34900.00" })).outcome).toBe("paid");
        await page.goto("/today");
        await expect(page.getByText(/ค้างชำระ/)).toHaveCount(0);
        expect(sql("select status from app.subscriptions")).toBe("active");
      });

      await test.step("on a phone, an overdue banner and the plan tab fit the screen", async () => {
        sql("update app.subscriptions set status='past_due', past_due_since=now() - interval '3 days'");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/settings?tab=plan");
        await expect(page.getByText(/ค้างชำระ · ผ่อนผันอีก 11 วัน/).first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no sideways scrolling").toBe(false);
        await expectAccessible(page, `plan tab on a phone (${theme})`);
        await page.goto("/today");
        await expect(page.getByText(/ค่าบริการถึงกำหนดแล้ว/)).toBeVisible();
        await expectAccessible(page, `home on a phone with the banner (${theme})`);
      });

      sql("update app.subscriptions set status='active', past_due_since=null");
    });
  });
}
