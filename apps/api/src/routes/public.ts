import { WebsiteOrderBody } from "@sabai/contracts";
import type { Hono } from "hono";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { RateLimiter } from "../rate-limit";
import { money } from "./support";

/**
 * The shop's own website (One Day Easy or any other): the menu straight from the POS, and orders that go to the kitchen
 * screen on the channel "เว็บไซต์" with no GP. Opened by the branch's website key (`X-Website-Key`), which can do
 * nothing else. Any origin may call these two (a shop's website lives on its own domain).
 */
const menuLimiter = new RateLimiter(120, 60_000);
const orderLimiter = new RateLimiter(10, 60_000);

const websiteKey = (h: string | undefined) => {
  const key = (h ?? "").trim();
  if (!/^sbw_[0-9a-f]{48}$/.test(key)) throw new ApiFailure("NOT_FOUND", 404);
  return key;
};
const client = (h: string | undefined) => (h ?? "local").split(",")[0]!.trim();

interface MenuRow {
  shop: string;
  branch: string;
  phone: string | null;
  address: string | null;
  currency: string;
  prices_include_vat: boolean;
  ordering: boolean;
  categories: { id: string; name: string; items: { id: string; name: string; name_en: string | null; description: string | null; image_url: string | null; price: number | string; tags: string[]; available: boolean }[] }[];
}

export function registerPublic(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "GET", path: "/v1/public/menu", tag: "Website", summary: "เมนูของสาขาสำหรับเว็บไซต์ร้าน (X-Website-Key)", auth: false }, async ({ c }) => {
    const key = websiteKey(c.req.header("x-website-key"));
    menuLimiter.check(`${client(c.req.header("x-forwarded-for"))}:menu`);
    const [row] = await deps.sql<{ m: MenuRow }[]>`select app.website_menu(${key}) as m`;
    const m = row!.m;
    c.header("Cache-Control", "public, max-age=60");
    return {
      shop: m.shop,
      branch: m.branch,
      phone: m.phone,
      address: m.address,
      currency: m.currency,
      pricesIncludeVat: m.prices_include_vat,
      ordering: m.ordering,
      categories: m.categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        items: cat.items.map((i) => ({ id: i.id, name: i.name, nameEn: i.name_en, description: i.description, imageUrl: i.image_url, price: money(i.price), tags: i.tags, available: i.available })),
      })),
    };
  });

  route(app, deps, { method: "POST", path: "/v1/public/orders", tag: "Website", summary: "สั่งจากเว็บไซต์ร้าน เข้าจอครัวทันที ชำระที่ร้าน (X-Website-Key)", auth: false, idempotent: false, body: WebsiteOrderBody }, async ({ c, body }) => {
    const key = websiteKey(c.req.header("x-website-key"));
    orderLimiter.check(`${client(c.req.header("x-forwarded-for"))}:order`);
    const payload = {
      customer_name: body.customerName,
      phone: body.phone,
      note: body.note,
      pickup_at: body.pickupAt,
      external_ref: body.externalRef,
      items: body.items.map((i) => ({ menu_item_id: i.menuItemId, qty: i.qty, note: i.note })),
    };
    const [row] = await deps.sql<{ r: { id: string; order_no: string; total: number | string; status: string; repeat: boolean } }[]>`
      select app.website_place_order(${key}, ${deps.sql.json(payload as never)}) as r`;
    const r = row!.r;
    return { orderId: r.id, orderNo: r.order_no, total: money(r.total), status: r.status, repeat: r.repeat };
  });
}
