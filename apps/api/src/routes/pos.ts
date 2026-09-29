import {
  CashMovementBody,
  CloseShiftBody,
  DiscountBody,
  OpenShiftBody,
  PayOrderBody,
  RefundBody,
  SubmitOrderBody,
  VoidBody,
} from "@sabai/contracts";
import type { Hono } from "hono";
import { z } from "zod";
import { ApiFailure } from "../errors";
import type { Tx } from "../db";
import { route, type Deps, type Env } from "../http";
import { callJson, money, num } from "./support";

const toOrderResult = (r: Record<string, unknown>) => ({
  id: r.id as string,
  ...(r.order_no ? { orderNo: r.order_no as string } : {}),
  status: (r.status as string) ?? "open",
  version: r.version as number | undefined,
  itemsTotal: r.items_total !== undefined ? money(r.items_total) : undefined,
  discountTotal: r.discount_total !== undefined ? money(r.discount_total) : undefined,
  serviceCharge: r.service_charge !== undefined ? money(r.service_charge) : undefined,
  vatAmount: r.vat_amount !== undefined ? money(r.vat_amount) : undefined,
  total: money(r.total),
  ...(r.receipt_no !== undefined ? { receiptNo: r.receipt_no as string | null } : {}),
  ...(r.change !== undefined ? { change: money(r.change) } : {}),
});

const OrdersQuery = z.object({
  branchId: z.uuid(),
  date: z.iso.date().optional(),
  status: z.enum(["open", "paid", "voided", "refunded"]).optional(),
  /** "full" returns every order in the detail shape of GET /v1/orders/{id}, in one round trip. */
  detail: z.enum(["full"]).optional(),
});

/** Whole orders (items, modifiers, payments, totals, discount, pricing snapshot) in the shape GET /v1/orders/{id} returns. */
async function orderDetails(t: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  const orders = await t`select *, business_date::text as business_date from app.orders where id = any(${ids}::uuid[])`;
  const items = await t`
    select oi.order_id, oi.id, oi.menu_item_id, oi.name, oi.qty, oi.unit_price, oi.modifiers_total, oi.line_total, oi.cost_amount, oi.note, oi.status, oi.void_reason,
           coalesce((select json_agg(json_build_object('id', m.modifier_option_id, 'name', m.name, 'price_delta', m.price_delta))
                       from app.order_item_modifiers m where m.order_item_id = oi.id), '[]') as modifiers
      from app.order_items oi where oi.order_id = any(${ids}::uuid[]) order by oi.created_at`;
  const payments = await t`
    select p.order_id, p.id, p.method_id, p.kind, p.amount, p.tendered, p.change_given, p.fee_amount, p.reference, pm.name as method, pm.kind as method_kind, p.created_at
      from app.payments p join app.payment_methods pm on pm.id = p.method_id where p.order_id = any(${ids}::uuid[]) order by p.created_at`;
  const byId = new Map(orders.map((o) => [o.id as string, o]));
  return ids.flatMap((id) => {
    const o = byId.get(id);
    if (!o) return [];
    const m = (k: string) => money(o[k]);
    return [
      {
        id: o.id, orderNo: o.order_no, receiptNo: o.receipt_no, status: o.status, businessDate: o.business_date, version: o.version,
        branchId: o.branch_id, channelId: o.channel_id, tableId: o.table_id, shiftId: o.shift_id, guestCount: o.guest_count, note: o.note,
        openedBy: o.opened_by, openedAt: o.opened_at, paidAt: o.paid_at,
        discount: o.discount_type ? { type: o.discount_type, value: num(o.discount_value), reason: o.discount_reason } : null,
        commissionRate: num(o.commission_rate), commissionAmount: m("commission_amount"), commissionVat: m("commission_vat_amount"),
        // Cost is a per-recipe figure carried at 4 decimals, so it is a number, not a money string.
        costTotal: o.cost_total === null ? null : num(o.cost_total),
        itemsTotal: m("items_total"), discountTotal: m("discount_total"), serviceCharge: m("service_charge"),
        vatAmount: m("vat_amount"), rounding: m("rounding"), total: m("total"),
        items: items
          .filter((i) => i.order_id === id)
          .map(({ order_id: _o, ...i }) => ({ ...i, unit_price: money(i.unit_price), modifiers_total: money(i.modifiers_total), line_total: money(i.line_total), cost_amount: i.cost_amount === null ? null : num(i.cost_amount) })),
        payments: payments
          .filter((p) => p.order_id === id)
          .map(({ order_id: _o, ...p }) => ({ ...p, amount: money(p.amount), tendered: p.tendered === null ? null : money(p.tendered), change_given: money(p.change_given), fee_amount: money(p.fee_amount) })),
      },
    ];
  });
}

export function registerPos(app: Hono<Env>, deps: Deps) {
  // ---------------------------------------------------------------- shifts
  route(app, deps, { method: "GET", path: "/v1/shifts/current", tag: "POS", summary: "กะที่เปิดอยู่ของสาขา (พร้อมเงินสดที่ควรมีในลิ้นชัก)", query: z.object({ branchId: z.uuid() }) }, async ({ query, tx }) =>
    tx(async (t) => {
      const [s] = await t`
        select s.id, s.opened_at, s.opened_by, s.opening_float, s.business_date::text, m.display_name as opened_by_name,
               app.shift_expected_cash(s.id) as expected_cash
          from app.shifts s left join app.memberships m on m.id = s.opened_by
         where s.branch_id = ${query.branchId} and s.status = 'open'
         order by s.opened_at desc limit 1`;
      const [last] = await t`select counted_cash from app.shifts where branch_id = ${query.branchId} and status = 'closed' order by closed_at desc limit 1`;
      const moves = s
        ? await t`select id, kind, amount, reason, created_at from app.cash_movements where shift_id = ${s.id} order by created_at`
        : [];
      return {
        shift: s
          ? { ...s, opening_float: money(s.opening_float), expected_cash: money(s.expected_cash), cash_movements: moves.map((m) => ({ ...m, amount: money(m.amount) })) }
          : null,
        // Smart default for the next opening float: what was left last time.
        suggestedOpeningFloat: money(last?.counted_cash ?? 1000),
      };
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/shifts", tag: "POS", summary: "ประวัติกะของสาขา", query: z.object({ branchId: z.uuid(), status: z.enum(["open", "closed"]).optional() }) }, async ({ query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select s.id, s.business_date::text, s.status, s.opening_float, s.expected_cash, s.counted_cash, s.cash_variance,
               s.opened_at, s.closed_at, s.opened_by, m.display_name as opened_by_name
          from app.shifts s left join app.memberships m on m.id = s.opened_by
         where s.branch_id = ${query.branchId}
           and (${query.status ?? null}::text is null or s.status = ${query.status ?? null})
         order by s.opened_at desc limit 100`;
      return rows.map((r) => ({
        ...r,
        opening_float: money(r.opening_float),
        expected_cash: r.expected_cash === null ? null : money(r.expected_cash),
        counted_cash: r.counted_cash === null ? null : money(r.counted_cash),
        cash_variance: r.cash_variance === null ? null : money(r.cash_variance),
      }));
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/shifts", tag: "POS", summary: "เปิดกะ", body: OpenShiftBody, permission: "pos.pay", status: 201 }, async ({ body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ id: string }[]>`select app.open_shift(${body.branchId}, ${body.openingFloat}, ${body.deviceId ?? null}::uuid) as id`;
      return { id: r!.id };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/shifts/{id}/close", tag: "POS", summary: "ปิดกะและนับเงินสด", body: CloseShiftBody, permission: "pos.pay" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: Record<string, number> }[]>`
        select app.close_shift(${params.id}, ${body.countedCash}, ${body.denominations ? t.json(body.denominations) : null}::jsonb, ${body.note ?? null}) as r`;
      return { expectedCash: money(r!.r.expected_cash), countedCash: money(r!.r.counted_cash), variance: money(r!.r.variance) };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/shifts/{id}/cash-movements", tag: "POS", summary: "นำเงินเข้า/ออกลิ้นชัก", body: CashMovementBody, permission: "pos.manage_shift", status: 201 }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ id: string }[]>`select app.record_cash_movement(${params.id}, ${body.kind}, ${body.amount}, ${body.reason}) as id`;
      return { id: r!.id };
    }),
  );

  // ---------------------------------------------------------------- orders
  route(app, deps, { method: "POST", path: "/v1/orders", tag: "POS", summary: "ส่งออเดอร์ (สร้างใหม่หรือเพิ่มรายการ) — ปลอดภัยต่อการส่งซ้ำ", body: SubmitOrderBody, permission: "pos.order" }, async ({ body, tx }) =>
    tx(async (t) => {
      let channelId = body.channelId;
      if (!channelId) {
        const [ch] = await t<{ id: string }[]>`
          select c.id from app.sales_channels c join app.branches b on b.tenant_id = c.tenant_id
           where b.id = ${body.branchId} and c.is_active order by (c.kind = 'dine_in') desc, c.sort limit 1`;
        channelId = ch?.id;
      }
      const r = await callJson(t, "app.submit_order", {
        id: body.id,
        branch_id: body.branchId,
        channel_id: channelId,
        table_id: body.tableId,
        device_id: body.deviceId,
        guest_count: body.guestCount,
        customer_name: body.customerName,
        external_ref: body.externalRef,
        note: body.note,
        fire: body.fire,
        ...(body.expectedVersion ? { expected_version: body.expectedVersion } : {}),
        items: body.items.map((i) => ({ id: i.id, menu_item_id: i.menuItemId, qty: i.qty, note: i.note, modifier_option_ids: i.modifierOptionIds })),
      });
      return toOrderResult(r);
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/orders", tag: "POS", summary: "บิลของวัน (ค่าเริ่มต้น: วันทำการปัจจุบัน)", query: OrdersQuery }, async ({ query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select o.id, o.order_no, o.receipt_no, o.status, o.business_date::text, o.total, o.guest_count, o.opened_at, o.paid_at,
               c.name as channel, dt.name as table_name,
               (select count(*) from app.order_items oi where oi.order_id = o.id and oi.status <> 'voided') as items
          from app.orders o
          join app.sales_channels c on c.id = o.channel_id
          left join app.dining_tables dt on dt.id = o.table_id
         where o.branch_id = ${query.branchId}
           and o.business_date = coalesce(${query.date ?? null}::date, app.business_date(${query.branchId}))
           and (${query.status ?? null}::text is null or o.status = ${query.status ?? null})
         order by o.opened_at desc
         limit 500`;
      if (query.detail === "full") return orderDetails(t, rows.map((r) => r.id as string));
      return rows.map((r) => ({ ...r, total: money(r.total) }));
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/orders/{id}", tag: "POS", summary: "รายละเอียดบิล" }, async ({ params, tx }) =>
    tx(async (t) => {
      const [order] = await orderDetails(t, [params.id]);
      if (!order) throw new ApiFailure("NOT_FOUND", 404);
      return order;
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/orders/{id}/pay", tag: "POS", summary: "รับชำระเงิน (หลายช่องทางในบิลเดียวได้) — ส่งซ้ำได้ปลอดภัย", body: PayOrderBody, permission: "pos.pay" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: Record<string, unknown> }[]>`
        select app.pay_order(${params.id}, ${t.json(body.payments.map((p) => ({ method_id: p.methodId, amount: p.amount, tendered: p.tendered, reference: p.reference })))}::jsonb) as r`;
      return toOrderResult(r!.r);
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/orders/{id}/discount", tag: "POS", summary: "ให้ส่วนลด (เกินวงเงินต้องมีการอนุมัติ)", body: DiscountBody, permission: "pos.discount" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: Record<string, unknown> }[]>`
        select app.apply_order_discount(${params.id}, ${body.type}, ${body.value}, ${body.reason}, ${body.approvalId ?? null}::uuid) as r`;
      return toOrderResult({ status: "open", ...r!.r });
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/orders/{id}/void", tag: "POS", summary: "ยกเลิกบิลที่ยังไม่ชำระ", body: VoidBody, permission: "pos.order / pos.void" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      await t`select app.void_order(${params.id}, ${body.reason}, ${body.approvalId ?? null}::uuid)`;
      return { id: params.id, status: "voided" };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/order-items/{id}/void", tag: "POS", summary: "ยกเลิกรายการ (ถ้าครัวรับไปแล้วต้องอนุมัติ)", body: VoidBody, permission: "pos.order / pos.void" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: Record<string, unknown> }[]>`select app.void_order_item(${params.id}, ${body.reason}, ${body.approvalId ?? null}::uuid) as r`;
      return toOrderResult({ status: "open", ...r!.r });
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/orders/{id}/refund", tag: "POS", summary: "คืนเงินทั้งบิล (เลือกคืนของเข้าสต็อกได้)", body: RefundBody, permission: "pos.refund" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: Record<string, unknown> }[]>`
        select app.refund_order(${params.id}, ${body.reason}, ${body.restock}, ${body.approvalId ?? null}::uuid) as r`;
      return { id: r!.r.id, status: r!.r.status };
    }),
  );
}
