import { TicketStatusBody } from "@sabai/contracts";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { branchTenant } from "./support";

const TicketsQuery = z.object({ branchId: z.uuid(), stationId: z.uuid().optional() });

export function registerKitchen(app: Hono<Env>, deps: Deps) {
  route(
    app,
    deps,
    { method: "GET", path: "/v1/kds/tickets", tag: "Kitchen", summary: "ตั๋วที่ครัวต้องทำ (+ที่เพิ่งเสร็จ เผื่อกดพลาดเรียกคืนได้)", query: TicketsQuery, permission: "kds.view" },
    async ({ query, tx }) =>
      tx(async (t) => {
        const stations = await t`
          select id, name, route_key, color, warn_after_sec, late_after_sec
            from app.kitchen_stations where branch_id = ${query.branchId} and is_active order by sort`;
        const tickets = await t`
          select kt.id, kt.station_id, kt.ticket_no, kt.status, kt.priority, kt.fired_at, kt.started_at, kt.ready_at,
                 o.id as order_id, c.name as channel, c.kind as channel_kind, dt.name as table_name, o.customer_name, o.note as order_note,
                 coalesce(json_agg(json_build_object('id', ti.id, 'order_item_id', ti.order_item_id, 'name', ti.name, 'qty', ti.qty, 'modifiers', ti.modifiers,
                                                     'note', ti.note, 'status', ti.status) order by ti.id), '[]') as items
            from app.kitchen_tickets kt
            join app.orders o on o.id = kt.order_id
            join app.sales_channels c on c.id = o.channel_id
            left join app.dining_tables dt on dt.id = o.table_id
            join app.kitchen_ticket_items ti on ti.ticket_id = kt.id
           where kt.branch_id = ${query.branchId}
             and (${query.stationId ?? null}::uuid is null or kt.station_id = ${query.stationId ?? null})
             and (kt.status in ('new','in_progress') or (kt.status = 'ready' and kt.ready_at > now() - interval '10 minutes'))
           group by kt.id, o.id, c.name, c.kind, dt.name
           order by kt.priority desc, kt.fired_at`;
        return { stations, tickets, serverTime: new Date().toISOString() };
      }),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/kds/tickets/{id}/status", tag: "Kitchen", summary: "เริ่มทำ / เสร็จแล้ว / เรียกคืน", body: TicketStatusBody, permission: "kds.bump" },
    async ({ params, body, tx }) =>
      tx(async (t) => {
        await t`select app.set_ticket_status(${params.id}, ${body.status})`;
        return { id: params.id, status: body.status };
      }),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/kds/ticket-items/{id}/toggle", tag: "Kitchen", summary: "เสร็จ/ยังไม่เสร็จ เฉพาะรายการนี้ในตั๋ว (ไม่กระทบรายการอื่น)", permission: "kds.bump" },
    async ({ params, tx }) =>
      tx(async (t) => {
        await t`select app.toggle_ticket_item(${params.id})`;
        return { id: params.id };
      }),
  );

  // Server-sent events: KDS and POS screens refresh the moment something happens.
  app.get("/v1/events", async (c) => {
    const actor = c.get("actor");
    if (!actor) throw new ApiFailure("AUTH_REQUIRED", 401);
    const branchId = z.uuid().parse(c.req.query("branchId"));
    const hub = deps.events;
    if (!hub) throw new ApiFailure("INTERNAL", 503);
    const { asActor } = await import("../db");
    const tenantId = await asActor(deps.sql, actor, c.get("requestId"), (t) => branchTenant(t, branchId));

    return streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = hub.subscribe((e) => {
        if (e.tenant_id !== tenantId || (e.branch_id && e.branch_id !== branchId)) return;
        queue.push(JSON.stringify({ id: e.id, type: e.type, aggregateId: e.aggregate_id }));
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ branchId }) });
      while (!stream.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 20_000); // heartbeat keeps proxies from closing the stream
          });
          wake = null;
        }
        if (stream.aborted) break;
        if (queue.length === 0) {
          await stream.writeSSE({ event: "ping", data: "{}" });
          continue;
        }
        while (queue.length) await stream.writeSSE({ event: "domain", data: queue.shift()! });
      }
      unsubscribe();
    });
  });
}
