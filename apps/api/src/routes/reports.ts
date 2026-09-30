import {
  channelProfitability,
  menuEngineering,
  profitWaterfall,
  toSatang,
  type ChannelSales,
} from "@sabai/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { branchTenant, hasPermission, money, num, requirePermission } from "./support";

const SummaryQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  branchId: z.uuid().optional(),
});

const TodayQuery = z.object({ branchId: z.uuid() });

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

        // Orders by hour of the shop's own clock (not UTC) — for the "when do we get busy" chart.
        const hourRows = await t<{ hour: number; n: string }[]>`
          select extract(hour from (o.opened_at at time zone tn.timezone))::int as hour, count(*) as n
            from app.orders o join app.tenants tn on tn.id = o.tenant_id
           where o.tenant_id = ${tenantId} and o.status = 'paid'
             and o.business_date between ${query.from}::date and ${query.to}::date
             and (${branch}::uuid is null or o.branch_id = ${branch})
           group by hour`;
        const hours = new Array(24).fill(0) as number[];
        for (const r of hourRows) hours[r.hour] = num(r.n);

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
          // Shape mirrors the web demo's reportSummary selector (totals, waterfall,
          // channels, items, days, hours, branches) so the DataSource mapper
          // (ADR-0009) only has to convert satang↔decimal and camelCase, not
          // reshape the whole payload.
          period: { from: query.from, to: query.to, branchId: branch },
          totals: {
            orders: num(pnl!.orders),
            netSales: money(pnl!.net_sales),
            avgTicket: num(pnl!.orders) > 0 ? money(num(pnl!.net_sales) / num(pnl!.orders)) : "0.00",
            ...(showProfit
              ? { cost: money(pnl!.cogs), commission: money(pnl!.commission), fees: money(pnl!.payment_fees), waste: money(pnl!.waste), variance: money(pnl!.stock_variance), expenses: money(pnl!.expenses) }
              : {}),
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
          days: daily.map((d) => ({ date: d.date, orders: num(d.orders), netSales: money(d.net_sales), ...(showProfit ? { profit: money(d.profit) } : {}) })),
          hours,
          branches: branches.map((b) => ({ id: b.id, name: b.name, orders: num(b.orders), netSales: money(b.net_sales), ...(showProfit ? { profit: money(b.profit) } : {}) })),
          channels: channelProfitability(channelRows).map((c) => ({
            channelId: c.channelId,
            name: c.name,
            orders: c.orders,
            netSales: baht(c.netSales),
            avgTicket: baht(c.avgTicket),
            shareOfSales: Math.round(c.shareOfSales * 1000) / 10,
            ...(showProfit
              ? {
                  cost: baht(c.cost),
                  commission: baht(c.commission),
                  paymentFees: baht(c.paymentFees),
                  contribution: baht(c.contribution),
                  marginPct: Math.round(c.marginPct * 1000) / 10,
                  shareOfContribution: Math.round(c.shareOfContribution * 1000) / 10,
                }
              : {}),
          })),
          items: engineered.map((i) => ({
            menuItemId: i.menuItemId,
            name: i.name,
            qty: i.qty,
            sales: baht(i.sales),
            ...(showProfit ? { cost: baht(i.cost), contributionPerItem: baht(i.contributionPerItem), mixPct: Math.round(i.mixPct * 1000) / 10, class: i.class } : {}),
          })),
        };
      }),
  );

  route(
    app,
    deps,
    { method: "GET", path: "/v1/reports/today", tag: "Insights", summary: "ยอดวันนี้ เทียบกับสัปดาห์ก่อนเวลาเดียวกัน พร้อมกราฟ 14 วันย้อนหลัง", query: TodayQuery },
    async ({ query, tx }) =>
      tx(async (t) => {
        const tenantId = await branchTenant(t, query.branchId);
        if (!(await hasPermission(t, tenantId, "reports.sales", query.branchId)) && !(await hasPermission(t, tenantId, "finance.close_day", query.branchId)) && !(await hasPermission(t, tenantId, "staff.manage")))
          throw new ApiFailure("PERMISSION_DENIED", 403, { permission: "reports.sales" });

        const [branch] = await t<{ timezone: string }[]>`select timezone from app.branches where id = ${query.branchId}`;
        if (!branch) throw new ApiFailure("NOT_FOUND", 404, { entity: "branch" });
        const [clock] = await t<{ today: string; hour: number; minute: number }[]>`
          select app.business_date(${query.branchId})::text as today,
                 extract(hour from (now() at time zone ${branch.timezone}))::int as hour,
                 extract(minute from (now() at time zone ${branch.timezone}))::int as minute`;
        const { today, hour, minute } = clock!;

        const [today_] = await t`
          select count(*) as orders, coalesce(sum(total), 0) as sales, coalesce(sum(total - vat_amount - rounding), 0) as net,
                 coalesce(sum(cost_total), 0) as cost, coalesce(sum(commission_amount), 0) as commission
            from app.orders where branch_id = ${query.branchId} and status = 'paid' and business_date = ${today}::date`;
        const [fees_] = await t`
          select coalesce(sum(p.fee_amount), 0) as fees from app.payments p join app.orders o on o.id = p.order_id
           where o.branch_id = ${query.branchId} and o.status = 'paid' and o.business_date = ${today}::date`;

        const lastWeek = new Date(new Date(`${today}T00:00:00Z`).getTime() - 7 * 86400000).toISOString().slice(0, 10);
        const lastWeekHours = await t<{ hour: number; n: string }[]>`
          select extract(hour from (opened_at at time zone ${branch.timezone}))::int as hour, count(*) as n
            from app.orders where branch_id = ${query.branchId} and status = 'paid' and business_date = ${lastWeek}::date
           group by hour`;
        const [lastWeekTotal] = await t<{ orders: string; gross: string }[]>`
          select count(*) as orders, coalesce(sum(total), 0) as gross
            from app.orders where branch_id = ${query.branchId} and status = 'paid' and business_date = ${lastWeek}::date`;
        const hourBuckets = new Array(24).fill(0) as number[];
        for (const r of lastWeekHours) hourBuckets[r.hour] = num(r.n);
        const hourShare = minute / 60;
        const uptoOrders = hourBuckets.slice(0, hour).reduce((a, b) => a + b, 0) + (hourBuckets[hour] ?? 0) * hourShare;
        const totalLastWeekOrders = num(lastWeekTotal!.orders);
        const share = totalLastWeekOrders ? uptoOrders / totalLastWeekOrders : 0;
        const lastWeekSales = num(lastWeekTotal!.gross) * share;

        const sparkFrom = new Date(new Date(`${today}T00:00:00Z`).getTime() - 14 * 86400000).toISOString().slice(0, 10);
        const sparkTo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 1 * 86400000).toISOString().slice(0, 10);
        const sparkRows = await t<{ d: string; gross: string }[]>`
          select business_date::text as d, coalesce(sum(total), 0) as gross
            from app.orders where branch_id = ${query.branchId} and status = 'paid' and business_date between ${sparkFrom}::date and ${sparkTo}::date
           group by business_date`;
        const sparkByDate = new Map(sparkRows.map((r) => [r.d, num(r.gross)]));
        const spark: number[] = [];
        for (let i = 14; i >= 1; i--) {
          const d = new Date(new Date(`${today}T00:00:00Z`).getTime() - i * 86400000).toISOString().slice(0, 10);
          spark.push(sparkByDate.get(d) ?? 0);
        }
        spark.push(num(today_!.sales));

        const [open] = await t<{ n: string }[]>`select count(*) as n from app.orders where branch_id = ${query.branchId} and status = 'open'`;

        const net = num(today_!.net);
        const cost = num(today_!.cost);
        const commission = num(today_!.commission);
        const fees = num(fees_!.fees);
        const keep = net - cost - commission - fees;

        return {
          today,
          sales: money(today_!.sales),
          orders: num(today_!.orders),
          avgTicket: num(today_!.orders) > 0 ? money(num(today_!.sales) / num(today_!.orders)) : "0.00",
          keep: money(keep),
          keepPct: net > 0 ? Math.round((keep / net) * 1000) / 1000 : 0,
          lastWeekSales: money(lastWeekSales),
          lastWeekOrders: Math.round(uptoOrders),
          spark: spark.map((v) => money(v)),
          open: num(open!.n),
        };
      }),
  );

  route(app, deps, { method: "GET", path: "/v1/activity", tag: "Insights", summary: "ใครทำอะไร เมื่อไร (ยกเลิก ส่วนลด คืนเงิน ปรับสต็อก)", tenant: true, query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), permission: "audit.view" }, async ({ tenantId, query, tx }) =>
    tx((t) => t`
      select e.id, e.event_type as type, e.occurred_at, e.payload, e.branch_id, e.actor_id, e.aggregate_type as entity_type, e.aggregate_id as entity_id, m.display_name as actor
        from app.domain_events e left join app.memberships m on m.id = e.actor_id
       where e.tenant_id = ${tenantId}
       order by e.occurred_at desc limit ${query.limit}`),
  );
}
