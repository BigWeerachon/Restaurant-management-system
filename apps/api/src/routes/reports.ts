import {
  channelProfitability,
  menuEngineering,
  profitWaterfall,
  toSatang,
  type ChannelSales,
} from "@sabai/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { route, type Deps, type Env } from "../http";
import { hasPermission, money, num, requirePermission } from "./support";

const SummaryQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  branchId: z.uuid().optional(),
});

const s = (v: unknown) => toSatang(String(v ?? 0));
const baht = (satang: number) => money(satang / 100);

export function registerReports(app: Hono<Env>, deps: Deps) {
  route(
    app,
    deps,
    { method: "GET", path: "/v1/reports/summary", tag: "Insights", summary: "อะไรขายดี ขายที่ไหน ช่องทางไหน และเหลือเงินจริงเท่าไร", tenant: true, query: SummaryQuery, permission: "reports.sales" },
    async ({ tenantId, query, tx }) =>
      tx(async (t) => {
        await requirePermission(t, tenantId, "reports.sales");
        const showProfit = await hasPermission(t, tenantId, "reports.profit");
        const branch = query.branchId ?? null;

        const [pnl] = await t`
          select coalesce(sum(orders), 0) as orders, coalesce(sum(net_sales), 0) as net_sales, coalesce(sum(cogs), 0) as cogs,
                 coalesce(sum(waste), 0) as waste, coalesce(sum(stock_variance), 0) as stock_variance,
                 coalesce(sum(commission), 0) as commission, coalesce(sum(payment_fees), 0) as payment_fees,
                 coalesce(sum(expenses), 0) as expenses
            from app.v_branch_daily_pnl
           where tenant_id = ${tenantId} and business_date between ${query.from}::date and ${query.to}::date
             and (${branch}::uuid is null or branch_id = ${branch})`;

        const daily = await t`
          select business_date::text as date, sum(net_sales) as net_sales, sum(profit) as profit, sum(orders) as orders
            from app.v_branch_daily_pnl
           where tenant_id = ${tenantId} and business_date between ${query.from}::date and ${query.to}::date
             and (${branch}::uuid is null or branch_id = ${branch})
           group by business_date order by business_date`;

        const channels = await t`
          select d.channel_id, c.name, c.kind, sum(d.orders) as orders, sum(d.net_sales) as net_sales, sum(d.cost) as cost,
                 sum(d.commission + case when t.vat_registered then 0 else d.commission_vat end) as commission,
                 coalesce((select sum(p.fee_amount) from app.payments p join app.orders o on o.id = p.order_id
                            where o.channel_id = d.channel_id and o.tenant_id = ${tenantId}
                              and o.business_date between ${query.from}::date and ${query.to}::date
                              and (${branch}::uuid is null or o.branch_id = ${branch})), 0) as fees
            from app.v_daily_sales d
            join app.sales_channels c on c.id = d.channel_id
            join app.tenants t on t.id = d.tenant_id
           where d.tenant_id = ${tenantId} and d.business_date between ${query.from}::date and ${query.to}::date
             and (${branch}::uuid is null or d.branch_id = ${branch})
           group by d.channel_id, c.name, c.kind`;

        const branches = await t`
          select b.id, b.name, sum(p.net_sales) as net_sales, sum(p.profit) as profit, sum(p.orders) as orders
            from app.v_branch_daily_pnl p join app.branches b on b.id = p.branch_id
           where p.tenant_id = ${tenantId} and p.business_date between ${query.from}::date and ${query.to}::date
           group by b.id, b.name order by sum(p.net_sales) desc`;

        const items = await t`
          select menu_item_id, name, sum(qty) as qty, sum(sales) as sales, sum(cost) as cost
            from app.v_item_sales
           where tenant_id = ${tenantId} and business_date between ${query.from}::date and ${query.to}::date
             and (${branch}::uuid is null or branch_id = ${branch})
           group by menu_item_id, name`;

        const channelRows: ChannelSales[] = channels.map((c) => ({
          channelId: c.channel_id,
          name: c.name,
          orders: num(c.orders),
          netSales: s(c.net_sales),
          cost: s(c.cost),
          commission: s(c.commission),
          paymentFees: s(c.fees),
        }));
        const engineered = menuEngineering(
          items.map((i) => ({ menuItemId: i.menu_item_id, name: i.name, qty: num(i.qty), sales: s(i.sales), cost: s(i.cost) })),
        );

        return {
          period: { from: query.from, to: query.to, branchId: branch },
          headline: {
            orders: num(pnl!.orders),
            netSales: money(pnl!.net_sales),
            avgTicket: num(pnl!.orders) > 0 ? money(num(pnl!.net_sales) / num(pnl!.orders)) : "0.00",
          },
          ...(showProfit
            ? {
                waterfall: profitWaterfall({
                  netSales: s(pnl!.net_sales),
                  cogs: s(pnl!.cogs),
                  waste: s(pnl!.waste),
                  stockVariance: s(pnl!.stock_variance),
                  commission: s(pnl!.commission),
                  paymentFees: s(pnl!.payment_fees),
                  expenses: s(pnl!.expenses),
                }).map((w) => ({ ...w, value: baht(w.value), running: baht(w.running) })),
              }
            : {}),
          daily: daily.map((d) => ({ date: d.date, orders: num(d.orders), netSales: money(d.net_sales), ...(showProfit ? { profit: money(d.profit) } : {}) })),
          branches: branches.map((b) => ({ id: b.id, name: b.name, orders: num(b.orders), netSales: money(b.net_sales), ...(showProfit ? { profit: money(b.profit) } : {}) })),
          channels: channelProfitability(channelRows).map((c) => ({
            channelId: c.channelId,
            name: c.name,
            orders: c.orders,
            netSales: baht(c.netSales),
            avgTicket: baht(c.avgTicket),
            shareOfSales: Math.round(c.shareOfSales * 1000) / 10,
            ...(showProfit ? { contribution: baht(c.contribution), marginPct: Math.round(c.marginPct * 1000) / 10, commission: baht(c.commission) } : {}),
          })),
          topItems: engineered.slice(0, 20).map((i) => ({
            menuItemId: i.menuItemId,
            name: i.name,
            qty: i.qty,
            sales: baht(i.sales),
            ...(showProfit ? { contributionPerItem: baht(i.contributionPerItem), class: i.class } : {}),
          })),
        };
      }),
  );

  route(app, deps, { method: "GET", path: "/v1/activity", tag: "Insights", summary: "ใครทำอะไร เมื่อไร (ยกเลิก ส่วนลด คืนเงิน ปรับสต็อก)", tenant: true, query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), permission: "audit.view" }, async ({ tenantId, query, tx }) =>
    tx((t) => t`
      select e.id, e.event_type as type, e.occurred_at, e.payload, e.branch_id, m.display_name as actor
        from app.domain_events e left join app.memberships m on m.id = e.actor_id
       where e.tenant_id = ${tenantId}
       order by e.occurred_at desc limit ${query.limit}`),
  );
}
