import {
  PurchaseOrderStatusBody,
  ReceiveGoodsBody,
  RecordCountBody,
  SavePurchaseOrderBody,
  StartCountBody,
  TransferBody,
  WasteBody,
} from "@sabai/contracts";
import { summarizeCount } from "@sabai/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { Tx } from "../db";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { branchTenant, callJson, hasPermission, money, num } from "./support";

const BranchQuery = z.object({ branchId: z.uuid() });

export function registerInventory(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "GET", path: "/v1/stock", tag: "Inventory", summary: "สต็อกคงเหลือพร้อมสถานะ (หมด/ใกล้หมด/ติดลบ)", query: BranchQuery, permission: "inventory.view" }, async ({ query, tx }) =>
    tx(async (t) => {
      const tenantId = await branchTenant(t, query.branchId);
      const showValue = await hasPermission(t, tenantId, "costs.view");
      const rows = await t`
        select s.ingredient_id, s.name, s.base_unit, s.display_unit, s.storage_zone, s.qty_on_hand, s.unit_cost, s.stock_value,
               s.reorder_point, s.par_level, s.status, s.last_movement_at
          from app.v_stock_status s
          join app.stock_locations l on l.id = s.location_id and l.is_default
         where s.branch_id = ${query.branchId}
         order by case s.status when 'negative' then 0 when 'out' then 1 when 'low' then 2 else 3 end, s.name`;
      return rows.map(({ unit_cost, stock_value, ...r }) => ({
        ...r,
        qty_on_hand: num(r.qty_on_hand),
        ...(showValue ? { unit_cost: num(unit_cost), stock_value: money(stock_value) } : {}),
      }));
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/stock-movements", tag: "Inventory", summary: "ความเคลื่อนไหวสต็อกล่าสุด (รับของ ขาย ของเสีย ปรับยอด โอน)", query: BranchQuery.extend({ ingredientId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), permission: "inventory.view" }, async ({ query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select m.id, m.ingredient_id, i.name, i.base_unit, m.qty, m.unit_cost, m.total_cost, m.reason, m.reason_code,
               m.business_date::text, m.occurred_at, m.note
          from app.stock_movements m join app.ingredients i on i.id = m.ingredient_id
         where m.branch_id = ${query.branchId}
           and (${query.ingredientId ?? null}::uuid is null or m.ingredient_id = ${query.ingredientId ?? null})
         order by m.occurred_at desc limit ${query.limit}`;
      return rows.map((r) => ({ ...r, qty: num(r.qty), unit_cost: num(r.unit_cost), total_cost: num(r.total_cost) }));
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/receipts", tag: "Inventory", summary: "รับของเข้า (มีหรือไม่มีใบสั่งซื้อก็ได้)", body: ReceiveGoodsBody, permission: "inventory.receive", status: 201 }, async ({ body, tx }) =>
    tx((t) =>
      callJson(t, "app.receive_goods", {
        branch_id: body.branchId,
        location_id: body.locationId,
        supplier_id: body.supplierId,
        po_id: body.poId,
        invoice_no: body.invoiceNo,
        invoice_date: body.invoiceDate,
        payment_mode: body.paymentMode ?? (body.supplierId || body.poId ? "credit" : "cash_paid"),
        vat_amount: body.vatAmount,
        attachment_url: body.attachmentUrl,
        note: body.note,
        lines: body.lines.map((l) => ({
          ingredient_id: l.ingredientId,
          pack_name: l.packName,
          pack_qty: l.packQty,
          qty_packs: l.qtyPacks,
          unit_price: l.unitPrice,
          po_line_id: l.poLineId,
        })),
      }).then((r) => ({ id: r.id, grNo: r.gr_no, total: money(r.total) })),
    ),
  );

  route(app, deps, { method: "GET", path: "/v1/receipts", tag: "Inventory", summary: "ประวัติการรับของ", query: BranchQuery.extend({ limit: z.coerce.number().int().min(1).max(200).default(50) }), permission: "inventory.view" }, async ({ query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select g.id, g.gr_no, g.business_date::text, g.received_at, g.payment_mode, g.total, g.invoice_no, s.name as supplier, g.po_id
          from app.goods_receipts g left join app.suppliers s on s.id = g.supplier_id
         where g.branch_id = ${query.branchId} order by g.received_at desc limit ${query.limit}`;
      return rows.map((r) => ({ ...r, total: money(r.total) }));
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/waste", tag: "Inventory", summary: "บันทึกของเสีย (ไม่ถึง 10 วินาที)", body: WasteBody, permission: "inventory.waste", status: 201 }, async ({ body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ id: string }[]>`
        select app.record_waste(${body.locationId}, ${body.ingredientId}, ${body.qty}, ${body.reason}, ${body.note ?? null}) as id`;
      return { id: r!.id };
    }),
  );

  // ------------------------------------------------------------------ counts
  const countView = async (t: Tx, id: string) => {
    const [c] = await t<{ id: string; tenant_id: string; count_no: string; status: string; is_blind: boolean; scope: string }[]>`
      select id, tenant_id, count_no, status, is_blind, scope from app.stock_counts where id = ${id}`;
    if (!c) throw new ApiFailure("NOT_FOUND", 404);
    const canSeeExpected = !c.is_blind || c.status !== "in_progress" ? await hasPermission(t, c.tenant_id, "inventory.adjust") : false;
    const lines = await t<Record<string, unknown>[]>`
      select l.ingredient_id, i.name, i.base_unit, i.display_unit, i.storage_zone, l.expected_qty, l.counted_qty, l.unit_cost, l.note
        from app.stock_count_lines l join app.ingredients i on i.id = l.ingredient_id
       where l.count_id = ${id}
       order by i.storage_zone nulls last, i.count_sort, i.name`;
    const mapped = lines.map((l) => ({
      ingredientId: l.ingredient_id,
      name: l.name,
      baseUnit: l.base_unit,
      displayUnit: l.display_unit,
      zone: l.storage_zone,
      counted: l.counted_qty === null ? null : num(l.counted_qty),
      // Blind count: counters never see what the system expects.
      ...(canSeeExpected ? { expected: l.expected_qty === null ? null : num(l.expected_qty) } : {}),
    }));
    const summary = canSeeExpected
      ? summarizeCount(
          lines.map((l) => ({
            ingredientId: String(l.ingredient_id),
            name: String(l.name),
            expected: num(l.expected_qty),
            counted: l.counted_qty === null ? null : num(l.counted_qty),
            unitCost: num(l.unit_cost),
          })),
        )
      : { counted: mapped.filter((l) => l.counted !== null).length, uncounted: mapped.filter((l) => l.counted === null).length };
    return { id: c.id, countNo: c.count_no, status: c.status, blind: c.is_blind, scope: c.scope, lines: mapped, summary };
  };

  route(app, deps, { method: "GET", path: "/v1/stock-counts", tag: "Inventory", summary: "ประวัติการนับสต็อก", query: BranchQuery.extend({ status: z.enum(["in_progress", "submitted", "approved", "cancelled"]).optional() }), permission: "inventory.count" }, async ({ query, tx }) =>
    tx(
      (t) => t`
        select c.id, c.count_no, c.status, c.scope, c.is_blind, c.business_date::text, c.started_at, c.submitted_at, c.approved_at
          from app.stock_counts c
         where c.branch_id = ${query.branchId}
           and (${query.status ?? null}::text is null or c.status = ${query.status ?? null})
         order by c.started_at desc limit 100`,
    ),
  );

  route(app, deps, { method: "POST", path: "/v1/stock-counts", tag: "Inventory", summary: "เริ่มนับสต็อก (โหมดนับแบบไม่เห็นยอดระบบ)", body: StartCountBody, permission: "inventory.count", status: 201 }, async ({ body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ id: string }[]>`
        select app.start_stock_count(${body.locationId}, ${body.scope}, ${body.ingredientIds ?? null}::uuid[], ${body.blind}) as id`;
      return countView(t, r!.id);
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/stock-counts/{id}", tag: "Inventory", summary: "รายการนับสต็อก", permission: "inventory.count" }, async ({ params, tx }) =>
    tx((t) => countView(t, params.id)),
  );

  route(app, deps, { method: "PUT", path: "/v1/stock-counts/{id}/lines", tag: "Inventory", summary: "บันทึกจำนวนที่นับได้ (ทีละรายการ บันทึกอัตโนมัติ)", body: RecordCountBody, permission: "inventory.count" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      await t`select app.record_count(${params.id}, ${body.ingredientId}, ${body.counted}, ${body.note ?? null})`;
      return { ok: true };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/stock-counts/{id}/submit", tag: "Inventory", summary: "ส่งผลการนับ", permission: "inventory.count" }, async ({ params, tx }) =>
    tx(async (t) => {
      await t`select app.submit_stock_count(${params.id})`;
      return countView(t, params.id);
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/stock-counts/{id}/approve", tag: "Inventory", summary: "อนุมัติและปรับยอดสต็อกตามที่นับได้", permission: "inventory.adjust" }, async ({ params, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ r: { adjusted_lines: number } }[]>`select app.approve_stock_count(${params.id}) as r`;
      return { id: params.id, adjustedLines: r!.r.adjusted_lines };
    }),
  );

  // --------------------------------------------------------------- transfers
  route(app, deps, { method: "POST", path: "/v1/transfers", tag: "Inventory", summary: "สร้างใบโอนสต็อก (ครัวกลาง → สาขา)", body: TransferBody, permission: "inventory.transfer", status: 201 }, async ({ body, tx }) =>
    tx(async (t) => {
      const [r] = await t<{ id: string }[]>`
        select app.create_transfer(${t.json({ from_location_id: body.fromLocationId, to_location_id: body.toLocationId, note: body.note ?? null, lines: body.lines.map((l) => ({ ingredient_id: l.ingredientId, qty: l.qty })) })}::jsonb) as id`;
      return { id: r!.id };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/transfers/{id}/send", tag: "Inventory", summary: "ยืนยันส่งของ", permission: "inventory.transfer" }, async ({ params, tx }) =>
    tx(async (t) => {
      await t`select app.send_transfer(${params.id})`;
      return { id: params.id, status: "sent" };
    }),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/transfers/{id}/receive", tag: "Inventory", summary: "รับของที่โอนมา (ของขาด = บันทึกเป็นของเสียให้อัตโนมัติ)", body: z.object({ lines: z.array(z.object({ ingredientId: z.uuid(), qtyReceived: z.number().nonnegative() })).default([]) }), permission: "inventory.receive" },
    async ({ params, body, tx }) =>
      tx(async (t) => {
        await t`select app.receive_transfer(${params.id}, ${t.json(body.lines.map((l) => ({ ingredient_id: l.ingredientId, qty_received: l.qtyReceived })))}::jsonb)`;
        return { id: params.id, status: "received" };
      }),
  );

  // -------------------------------------------------------------- purchasing
  route(app, deps, { method: "GET", path: "/v1/reorder-suggestions", tag: "Purchasing", summary: "ของที่ควรสั่ง พร้อมจำนวนเป็นแพ็ก (คิดของที่สั่งไว้แล้วให้)", query: BranchQuery, permission: "purchasing.view" }, async ({ query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select r.*, s.name as supplier_name from app.v_reorder_suggestions r left join app.suppliers s on s.id = r.supplier_id
         where r.branch_id = ${query.branchId} order by s.name nulls last, r.name`;
      return rows.map((r) => ({ ...r, on_hand: num(r.on_hand), on_order: num(r.on_order), suggested_qty: num(r.suggested_qty), suggested_packs: num(r.suggested_packs), last_price: r.last_price === null ? null : money(r.last_price) }));
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/purchase-orders", tag: "Purchasing", summary: "ใบสั่งซื้อของสาขา", query: BranchQuery.extend({ status: z.enum(["draft", "submitted", "approved", "sent", "partially_received", "received", "cancelled"]).optional() }), permission: "purchasing.view" }, async ({ query, tx }) =>
    tx(async (t) => {
      const rows = await t`
        select po.id, po.po_no, po.status, po.expected_date::text, po.total, po.created_at, s.name as supplier
          from app.purchase_orders po join app.suppliers s on s.id = po.supplier_id
         where po.branch_id = ${query.branchId}
           and (${query.status ?? null}::text is null or po.status = ${query.status ?? null})
         order by po.created_at desc limit 200`;
      return rows.map((r) => ({ ...r, total: money(r.total) }));
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/purchase-orders", tag: "Purchasing", summary: "สร้าง/แก้ไขใบสั่งซื้อฉบับร่าง", body: SavePurchaseOrderBody, permission: "purchasing.manage", status: 201 }, async ({ body, tx }) =>
    tx((t) =>
      callJson(t, "app.save_purchase_order", {
        id: body.id,
        branch_id: body.branchId,
        supplier_id: body.supplierId,
        location_id: body.locationId,
        expected_date: body.expectedDate,
        note: body.note,
        lines: body.lines.map((l) => ({ ingredient_id: l.ingredientId, pack_name: l.packName, pack_qty: l.packQty, qty_packs: l.qtyPacks, unit_price: l.unitPrice })),
      }).then((r) => ({ id: r.id, poNo: r.po_no, status: r.status, total: money(r.total) })),
    ),
  );

  route(app, deps, { method: "POST", path: "/v1/purchase-orders/{id}/status", tag: "Purchasing", summary: "ส่งอนุมัติ / อนุมัติ / ส่งให้ผู้ขาย / ยกเลิก", body: PurchaseOrderStatusBody, permission: "purchasing.manage / purchasing.approve" }, async ({ params, body, tx }) =>
    tx(async (t) => {
      await t`select app.set_purchase_order_status(${params.id}, ${body.status})`;
      return { id: params.id, status: body.status };
    }),
  );
}
