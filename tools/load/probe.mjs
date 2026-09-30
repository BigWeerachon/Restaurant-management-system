#!/usr/bin/env node
// A small load probe for the API: sells and pays bills, reads the kitchen and the day's numbers, at a steady concurrency, and
// reports latency (p50 / p95 / p99) and the error ratio per route — the numbers docs/10-slo.md is written against.
//
//   pnpm db:reset && pnpm db:seed && pnpm --filter @sabai/api dev      # a seeded API on :8787
//   node tools/load/probe.mjs                                          # 20 s, 4 at a time
//   DURATION_S=60 CONCURRENCY=8 node tools/load/probe.mjs
//
// Exits 1 if the error ratio is over 0.1% or any route's p95 is over the budget (200 ms), so it can gate a release.
// It measures the machine it runs on as much as the code: run it where the API and the database really are, and
// compare like with like. No dependencies (Node 22's fetch).
const BASE = process.env.BASE ?? "http://localhost:8787";
const EMAIL = process.env.EMAIL ?? "owner@sabai.dev";
const DURATION_MS = Number(process.env.DURATION_S ?? 20) * 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 200);
const ERROR_BUDGET = Number(process.env.ERROR_BUDGET ?? 0.001);

const id = () => crypto.randomUUID();
const stats = new Map();
const record = (route, ms, ok) => {
  const s = stats.get(route) ?? { ms: [], errors: 0 };
  s.ms.push(ms);
  if (!ok) s.errors++;
  stats.set(route, s);
};

async function call(route, method, path, { token, tenant, body } = {}) {
  const t0 = performance.now();
  let res;
  let text = "";
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(tenant ? { "x-tenant-id": tenant } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    text = await res.text();
  } catch {
    record(route, performance.now() - t0, false);
    return { ok: false, status: 0, data: null };
  }
  // Only the server's own failures count against it: a 4xx is the caller's (and this probe sends none on purpose).
  record(route, performance.now() - t0, res.status < 500);
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, data };
}
const json = async (route, method, path, opts) => {
  const r = await call(route, method, path, opts);
  return r.ok ? r.data : null;
};

// ---- set the scene (not measured): sign in, find the shop, open a shift, pick something to sell
const login = await fetch(`${BASE}/v1/dev/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL }) });
if (!login.ok) throw new Error(`dev login failed (${login.status}) — is the API running in development mode, with the database seeded?`);
const { token } = await login.json();
const me = await (await fetch(`${BASE}/v1/me`, { headers: { authorization: `Bearer ${token}` } })).json();
const tenant = me.memberships?.[0]?.tenantId;
if (!tenant) throw new Error("could not find the shop from /v1/me");
const shop = await (await fetch(`${BASE}/v1/shop`, { headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenant } })).json();
const branchId = shop.branches[0].id;
const cash = shop.paymentMethods.find((p) => p.kind === "cash").id;
const item = shop.menuItems.find((m) => m.is_active !== false) ?? shop.menuItems[0];
await fetch(`${BASE}/v1/shifts`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-tenant-id": tenant }, body: JSON.stringify({ branchId, openingFloat: 0 }) });
const ctx = { token, tenant };

// ---- the measured work: what a shop does all day
async function sale() {
  const order = id();
  const placed = await json("POST /v1/orders", "POST", "/v1/orders", { ...ctx, body: { id: order, branchId, items: [{ id: id(), menuItemId: item.id, qty: 1 }] } });
  if (placed) await call("POST /v1/orders/:id/pay", "POST", `/v1/orders/${order}/pay`, { ...ctx, body: { payments: [{ methodId: cash, amount: Number(placed.total) }] } });
}
const reads = [
  () => call("GET /v1/kds/tickets", "GET", `/v1/kds/tickets?branchId=${branchId}`, ctx),
  () => call("GET /v1/orders", "GET", `/v1/orders?branchId=${branchId}&detail=full`, ctx),
  () => call("GET /v1/reports/today", "GET", `/v1/reports/today?branchId=${branchId}`, ctx),
  () => call("GET /v1/stock", "GET", `/v1/stock?branchId=${branchId}`, ctx),
];

const until = performance.now() + DURATION_MS;
async function worker(n) {
  let read = n;
  for (let i = 0; performance.now() < until; i++) {
    // Mostly reads (screens refreshing, in turn), some sales.
    if (i % 4 === 0) await sale();
    else await reads[read++ % reads.length]();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => worker(n)));

// ---- the report
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const rows = [];
let total = 0;
let errors = 0;
for (const [route, s] of [...stats].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sorted = [...s.ms].sort((a, b) => a - b);
  total += sorted.length;
  errors += s.errors;
  rows.push({ route, n: sorted.length, p50: Math.round(pct(sorted, 50)), p95: Math.round(pct(sorted, 95)), p99: Math.round(pct(sorted, 99)), max: Math.round(sorted.at(-1)), errors: s.errors });
}
console.table(rows);
const ratio = total ? errors / total : 1;
console.log(`${total} requests in ${DURATION_MS / 1000} s at ${CONCURRENCY} at a time (${Math.round(total / (DURATION_MS / 1000))}/s) · server errors ${errors} (${(ratio * 100).toFixed(3)}%)`);
const over = rows.filter((r) => r.p95 > P95_BUDGET_MS);
if (over.length) console.error(`p95 over ${P95_BUDGET_MS} ms: ${over.map((r) => `${r.route} ${r.p95} ms`).join(", ")}`);
if (ratio > ERROR_BUDGET) console.error(`error ratio ${(ratio * 100).toFixed(3)}% is over ${(ERROR_BUDGET * 100).toFixed(1)}%`);
process.exit(over.length || ratio > ERROR_BUDGET ? 1 : 0);
