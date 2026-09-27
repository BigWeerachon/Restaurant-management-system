import { AvailabilityBody, CreateIngredientBody, CreateMenuItemBody } from "@sabai/contracts";
import { costRecipe, foodCostPct, marginHealth, suggestPrice, type CostIngredient, type RecipeBook } from "@sabai/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { hasPermission, money, num, requirePermission } from "./support";

const CatalogQuery = z.object({ branchId: z.uuid(), channelId: z.uuid().optional() });

export function registerCatalog(app: Hono<Env>, deps: Deps) {
  route(
    app,
    deps,
    { method: "GET", path: "/v1/catalog", tag: "Menu", summary: "ทุกอย่างที่หน้าขายต้องใช้ในคำขอเดียว (แคชไว้ขายออฟไลน์ได้)", tenant: true, query: CatalogQuery },
    async ({ tenantId, query, tx }) =>
      tx(async (t) => {
        const channels = await t<{ id: string; key: string; kind: string; name: string; color: string | null; icon: string | null }[]>`
          select id, key, kind, name, color, icon from app.sales_channels where tenant_id = ${tenantId} and is_active order by sort`;
        const channelId = query.channelId ?? channels.find((c) => c.kind === "dine_in")?.id ?? channels[0]?.id ?? null;
        const [categories, items, groups, options, links, methods, tables] = await Promise.all([
          t`select id, name, color, icon, sort from app.menu_categories where tenant_id = ${tenantId} and archived_at is null order by sort, name`,
          t<{ id: string; category_id: string; name: string; name_en: string | null; image_url: string | null; price: string; kitchen_route: string; tags: string[]; sold_out: boolean }[]>`
            select i.id, i.category_id, i.name, i.name_en, i.image_url, i.kitchen_route, i.tags,
                   app.resolve_menu_price(i.id, ${channelId}::uuid, ${query.branchId}::uuid) as price,
                   coalesce((select not a.is_available or (a.sold_out_until is not null and a.sold_out_until > now())
                               from app.menu_item_availability a where a.menu_item_id = i.id and a.branch_id = ${query.branchId}), false) as sold_out
              from app.menu_items i
             where i.tenant_id = ${tenantId} and i.is_active and i.archived_at is null
             order by i.sort, i.name`,
          t`select id, name, min_select, max_select, sort from app.modifier_groups where tenant_id = ${tenantId} order by sort`,
          t`select id, group_id, name, price_delta, is_default, sort from app.modifier_options where tenant_id = ${tenantId} and is_active order by sort`,
          t<{ menu_item_id: string; group_id: string }[]>`select menu_item_id, group_id from app.menu_item_modifier_groups where tenant_id = ${tenantId} order by sort`,
          t`select id, kind, name, icon, requires_reference, opens_drawer, config from app.payment_methods where tenant_id = ${tenantId} and is_active order by sort`,
          t`select id, name, seats, area_id from app.dining_tables where branch_id = ${query.branchId} and is_active order by sort, name`,
        ]);
        return {
          channelId,
          channels,
          categories,
          items: items.map((i) => ({
            ...i,
            price: money(i.price),
            modifierGroupIds: links.filter((l) => l.menu_item_id === i.id).map((l) => l.group_id),
          })),
          modifierGroups: groups.map((g) => ({ ...g, options: options.filter((o) => o.group_id === g.id).map((o) => ({ ...o, price_delta: money(o.price_delta) })) })),
          paymentMethods: methods,
          tables,
        };
      }),
  );

  route(app, deps, { method: "GET", path: "/v1/ingredients", tag: "Inventory", summary: "รายการวัตถุดิบ", tenant: true }, async ({ tenantId, tx }) =>
    tx((t) => t`
      select i.id, i.name, i.kind, i.base_unit, i.display_unit, i.track_stock, i.reorder_point, i.par_level,
             i.storage_zone, c.name as category
        from app.ingredients i left join app.ingredient_categories c on c.id = i.category_id
       where i.tenant_id = ${tenantId} and i.archived_at is null order by i.name`),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/ingredients", tag: "Inventory", summary: "เพิ่มวัตถุดิบ (หน่วยพื้นฐาน กรัม/มล./ชิ้น)", tenant: true, body: CreateIngredientBody, permission: "inventory.manage", status: 201 },
    async ({ tenantId, body, tx }) =>
      tx(async (t) => {
        await requirePermission(t, tenantId, "inventory.manage");
        const [row] = await t`
          insert into app.ingredients (tenant_id, name, base_unit, display_unit, kind, track_stock, category_id,
                                       reorder_point, par_level, standard_cost, storage_zone)
          values (${tenantId}, ${body.name}, ${body.baseUnit}, ${body.displayUnit ?? null}, ${body.kind}, ${body.trackStock},
                  ${body.categoryId ?? null}, ${body.reorderPoint ?? null}, ${body.parLevel ?? null}, ${body.standardCost ?? null},
                  ${body.storageZone ?? null})
          returning id, name, base_unit, display_unit, kind, track_stock`;
        return row;
      }),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/menu-items", tag: "Menu", summary: "เพิ่มเมนู (พร้อมสูตรในขั้นตอนเดียวได้)", tenant: true, body: CreateMenuItemBody, permission: "menu.manage", status: 201 },
    async ({ tenantId, body, tx }) =>
      tx(async (t) => {
        await requirePermission(t, tenantId, "menu.manage");
        const [brand] = await t<{ id: string }[]>`select id from app.brands where tenant_id = ${tenantId} and is_default`;
        if (!brand) throw new ApiFailure("NOT_FOUND", 404, { entity: "brand" });
        let categoryId = body.categoryId;
        if (!categoryId) {
          const [existing] = await t<{ id: string }[]>`
            select id from app.menu_categories where tenant_id = ${tenantId} and lower(name) = lower(${body.categoryName!}) and archived_at is null`;
          categoryId =
            existing?.id ??
            (await t<{ id: string }[]>`insert into app.menu_categories (tenant_id, brand_id, name) values (${tenantId}, ${brand.id}, ${body.categoryName!}) returning id`)[0]!.id;
        }
        const [item] = await t<{ id: string; name: string; price: string }[]>`
          insert into app.menu_items (tenant_id, brand_id, category_id, name, name_en, price, kitchen_route, image_url)
          values (${tenantId}, ${brand.id}, ${categoryId}, ${body.name}, ${body.nameEn ?? null}, ${body.price}, ${body.kitchenRoute}, ${body.imageUrl ?? null})
          returning id, name, price`;
        if (body.recipe?.length) {
          await requirePermission(t, tenantId, "recipes.manage");
          const [r] = await t<{ id: string }[]>`insert into app.recipes (tenant_id, kind, menu_item_id) values (${tenantId}, 'menu_item', ${item!.id}) returning id`;
          for (const l of body.recipe) {
            await t`insert into app.recipe_lines (tenant_id, recipe_id, ingredient_id, qty, waste_rate)
                    values (${tenantId}, ${r!.id}, ${l.ingredientId}, ${l.qty}, ${l.wasteRate})`;
          }
        }
        const showCost = await hasPermission(t, tenantId, "costs.view");
        const [cost] = showCost ? await t<{ c: string }[]>`select app.menu_item_cost(${item!.id}) as c` : [];
        return { id: item!.id, name: item!.name, price: money(item!.price), ...(cost ? { cost: money(cost.c) } : {}) };
      }),
  );

  route(
    app,
    deps,
    { method: "GET", path: "/v1/menu-items/{id}/costing", tag: "Menu", summary: "ต้นทุนต่อจาน สัดส่วนต้นทุน และราคาแนะนำ", tenant: true, permission: "costs.view" },
    async ({ tenantId, params, tx }) =>
      tx(async (t) => {
        await requirePermission(t, tenantId, "costs.view");
        const [item] = await t<{ id: string; name: string; price: string }[]>`select id, name, price from app.menu_items where id = ${params.id} and tenant_id = ${tenantId}`;
        if (!item) throw new ApiFailure("NOT_FOUND", 404);
        const [tenant] = await t<{ vat_registered: boolean; vat_rate: string; prices_include_vat: boolean }[]>`
          select vat_registered, vat_rate, prices_include_vat from app.tenants where id = ${tenantId}`;
        const lines = await t<{ ingredient_id: string; name: string; qty: string; waste_rate: string; unit_cost: string; base_unit: string; yield_qty: string }[]>`
          select l.ingredient_id, i.name, l.qty, l.waste_rate, app.ingredient_unit_cost(l.ingredient_id) as unit_cost, i.base_unit, r.yield_qty
            from app.recipes r join app.recipe_lines l on l.recipe_id = r.id join app.ingredients i on i.id = l.ingredient_id
           where r.menu_item_id = ${item.id} and r.is_current and r.kind = 'menu_item'
           order by l.sort`;
        const book: RecipeBook = {
          ingredients: new Map<string, CostIngredient>(
            lines.map((l) => [l.ingredient_id, { id: l.ingredient_id, name: l.name, kind: "raw", trackStock: true, unitCost: num(l.unit_cost) }]),
          ),
          prepRecipes: new Map(),
        };
        const breakdown = costRecipe(
          { yieldQty: num(lines[0]?.yield_qty ?? 1), lines: lines.map((l) => ({ ingredientId: l.ingredient_id, qty: num(l.qty), wasteRate: num(l.waste_rate) })) },
          book,
        );
        const vatRate = tenant!.vat_registered ? num(tenant!.vat_rate) : 0;
        const pct = foodCostPct(breakdown.cost, num(item.price), vatRate, tenant!.prices_include_vat);
        return {
          menuItemId: item.id,
          name: item.name,
          price: money(item.price),
          cost: money(breakdown.cost),
          foodCostPct: Math.round(pct * 1000) / 10,
          health: marginHealth(pct),
          suggestedPrice: money(suggestPrice(breakdown.cost, 0.3, vatRate, tenant!.prices_include_vat)),
          hasRecipe: lines.length > 0,
          lines: breakdown.lines.map((l) => ({ ...l, cost: money(l.cost), share: Math.round(l.share * 1000) / 10 })),
        };
      }),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/menu-items/{id}/availability", tag: "Menu", summary: "ของหมด / เปิดขายอีกครั้ง (ต่อสาขา)", body: AvailabilityBody, permission: "menu.availability" },
    async ({ params, body, tx }) =>
      tx(async (t) => {
        await t`select app.set_item_availability(${params.id}, ${body.branchId}, ${body.available}, ${body.until ?? null}::timestamptz)`;
        return { ok: true };
      }),
  );
}
