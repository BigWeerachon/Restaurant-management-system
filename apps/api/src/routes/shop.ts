import type { Hono } from "hono";
import { route, type Deps, type Env } from "../http";
import { money, num } from "./support";

/**
 * Everything a client needs to boot the app for a tenant in one request:
 * settings, branches, catalog, roles/permissions, team, suppliers, plan.
 * Live/transactional data (orders, stock, purchase orders, ...) has its own
 * endpoints — this is reference/master data only, refetched rarely.
 */
export function registerShop(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "GET", path: "/v1/shop", tag: "Shop", summary: "ข้อมูลตั้งต้นทั้งร้านในคำขอเดียว (ตั้งค่า สาขา เมนู ทีมงาน ผู้ขาย แพ็กเกจ)", tenant: true }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      const [
        [tenant],
        branches,
        tables,
        stations,
        channels,
        paymentMethods,
        suppliers,
        supplierItems,
        ingredients,
        menuCategories,
        menuItems,
        recipeLines,
        modifierLinks,
        modifierGroups,
        modifierOptions,
        roles,
        rolePermissions,
        members,
        membershipBranches,
        stockLocations,
      ] = await Promise.all([
        t<{ id: string; name: string; business_type: string; vat_registered: boolean; prices_include_vat: boolean; vat_rate: string; cash_rounding: string; settings: unknown; plan_code: string | null; subscription_status: string | null; trial_ends_at: string | null }[]>`
          select tn.id, tn.name, tn.business_type, tn.vat_registered, tn.prices_include_vat, tn.vat_rate, tn.cash_rounding, tn.settings,
                 s.plan_code, s.status as subscription_status, s.trial_ends_at
            from app.tenants tn left join app.subscriptions s on s.tenant_id = tn.id
           where tn.id = ${tenantId}`,
        t<{ id: string; code: string; name: string; address: string | null; phone: string | null; day_cutoff: string; opening_hours: unknown; service_charge_rate: string; is_active: boolean }[]>`
          select id, code, name, address, phone, day_cutoff, opening_hours, service_charge_rate, is_active
            from app.branches where tenant_id = ${tenantId} and archived_at is null order by created_at`,
        t<{ id: string; branch_id: string; area_id: string | null; area_name: string | null; name: string; seats: number }[]>`
          select dt.id, dt.branch_id, dt.area_id, da.name as area_name, dt.name, dt.seats
            from app.dining_tables dt left join app.dining_areas da on da.id = dt.area_id
           where dt.tenant_id = ${tenantId} and dt.is_active order by dt.branch_id, dt.sort, dt.name`,
        t<{ id: string; branch_id: string; name: string; route_key: string; color: string | null; warn_after_sec: number; late_after_sec: number }[]>`
          select id, branch_id, name, route_key, color, warn_after_sec, late_after_sec
            from app.kitchen_stations where tenant_id = ${tenantId} and is_active order by branch_id, sort`,
        t<{ id: string; key: string; kind: string; name: string; color: string | null; icon: string | null; applies_service_charge: boolean; commission_rate: string; price_markup: string; settlement_days: number; is_active: boolean; sort: number }[]>`
          -- The GP in force today (the one on the newest rate that has started), not just the default it started from.
          select c.id, c.key, c.kind, c.name, c.color, c.icon, c.applies_service_charge,
                 app.channel_commission_rate(c.id, (now() at time zone tn.timezone)::date) as commission_rate,
                 c.price_markup, c.settlement_days, c.is_active, c.sort
            from app.sales_channels c join app.tenants tn on tn.id = c.tenant_id
           where c.tenant_id = ${tenantId} order by c.sort`,
        t<{ id: string; kind: string; name: string; icon: string | null; fee_rate: string; fee_fixed: string; opens_drawer: boolean; requires_reference: boolean; settlement_days: number; config: unknown; is_active: boolean; sort: number }[]>`
          select id, kind, name, icon, fee_rate, fee_fixed, opens_drawer, requires_reference, settlement_days, config, is_active, sort
            from app.payment_methods where tenant_id = ${tenantId} order by sort`,
        t<{ id: string; name: string; phone: string | null; line_id: string | null; payment_terms_days: number; lead_time_days: number; is_active: boolean }[]>`
          select id, name, phone, line_id, payment_terms_days, lead_time_days, is_active from app.suppliers where tenant_id = ${tenantId} order by name`,
        t<{ supplier_id: string; ingredient_id: string; pack_name: string; pack_qty: string; last_price: string | null; is_preferred: boolean }[]>`
          select supplier_id, ingredient_id, pack_name, pack_qty, last_price, is_preferred from app.supplier_items where tenant_id = ${tenantId}`,
        t<{ id: string; name: string; kind: string; base_unit: string; display_unit: string | null; track_stock: boolean; reorder_point: string | null; par_level: string | null; standard_cost: string | null; last_cost: string | null; storage_zone: string | null; emoji: string | null; category: string | null }[]>`
          select i.id, i.name, i.kind, i.base_unit, i.display_unit, i.track_stock, i.reorder_point, i.par_level,
                 i.standard_cost, i.last_cost, i.storage_zone, i.emoji, c.name as category
            from app.ingredients i left join app.ingredient_categories c on c.id = i.category_id
           where i.tenant_id = ${tenantId} and i.archived_at is null order by i.name`,
        t`select id, name, color, icon, sort from app.menu_categories where tenant_id = ${tenantId} and archived_at is null order by sort, name`,
        t<{ id: string; category_id: string; name: string; name_en: string | null; image_url: string | null; emoji: string | null; kitchen_route: string; tags: string[]; price: string; is_active: boolean }[]>`
          select id, category_id, name, name_en, image_url, emoji, kitchen_route, tags, price, is_active
            from app.menu_items where tenant_id = ${tenantId} and archived_at is null order by sort, name`,
        t<{ menu_item_id: string; ingredient_id: string; qty: string; waste_rate: string }[]>`
          select r.menu_item_id, l.ingredient_id, l.qty, l.waste_rate
            from app.recipes r join app.recipe_lines l on l.recipe_id = r.id
           where r.tenant_id = ${tenantId} and r.kind = 'menu_item' and r.is_current order by l.sort`,
        t<{ menu_item_id: string; group_id: string }[]>`select menu_item_id, group_id from app.menu_item_modifier_groups where tenant_id = ${tenantId} order by sort`,
        t<{ id: string; name: string; min_select: number; max_select: number; sort: number }[]>`
          select id, name, min_select, max_select, sort from app.modifier_groups where tenant_id = ${tenantId} order by sort`,
        t<{ id: string; group_id: string; name: string; price_delta: string; is_default: boolean; sort: number }[]>`
          select id, group_id, name, price_delta, is_default, sort from app.modifier_options where tenant_id = ${tenantId} and is_active order by sort`,
        t<{ id: string; key: string; name: string; description: string | null; grants_all: boolean; home: string; color: string | null; sort: number }[]>`
          select id, key, name, description, grants_all, home, color, sort from app.roles where tenant_id = ${tenantId} order by sort`,
        t<{ role_id: string; permission_key: string }[]>`select role_id, permission_key from app.role_permissions where tenant_id = ${tenantId}`,
        t<{ id: string; display_name: string; nickname: string | null; status: string; all_branches: boolean; pin_only: boolean; role_key: string; role_name: string; max_discount_rate: string }[]>`
          select m.id, m.display_name, m.nickname, m.status, m.all_branches, m.user_id is null as pin_only, r.key as role_key, r.name as role_name,
                 coalesce((m.limits->>'max_discount_rate')::numeric, 1) as max_discount_rate
            from app.memberships m join app.roles r on r.id = m.role_id
           where m.tenant_id = ${tenantId} and m.status <> 'removed' order by r.sort, m.display_name`,
        t<{ membership_id: string; branch_id: string }[]>`select membership_id, branch_id from app.membership_branches where tenant_id = ${tenantId}`,
        t<{ id: string; branch_id: string }[]>`select id, branch_id from app.stock_locations where tenant_id = ${tenantId} and is_default`,
      ]);

      const [plan] = tenant?.plan_code
        ? await t<{ code: string; name: string; name_en: string; price_monthly: string | null; price_yearly: string | null; limits: unknown; features: string[] }[]>`
            select code, name, name_en, price_monthly, price_yearly, limits, features from app.plans where code = ${tenant.plan_code}`
        : [];

      return {
        tenant: tenant
          ? {
              id: tenant.id,
              name: tenant.name,
              businessType: tenant.business_type,
              vatRegistered: tenant.vat_registered,
              pricesIncludeVat: tenant.prices_include_vat,
              vatRate: num(tenant.vat_rate),
              cashRounding: tenant.cash_rounding,
              settings: tenant.settings,
              planCode: tenant.plan_code,
              subscriptionStatus: tenant.subscription_status,
              trialEndsAt: tenant.trial_ends_at,
            }
          : null,
        plan: plan
          ? { code: plan.code, name: plan.name, nameEn: plan.name_en, priceMonthly: plan.price_monthly ? money(plan.price_monthly) : null, priceYearly: plan.price_yearly ? money(plan.price_yearly) : null, limits: plan.limits, features: plan.features }
          : null,
        branches: branches.map((b) => ({
          ...b,
          service_charge_rate: num(b.service_charge_rate),
          // Where waste, counts and opening stock are recorded for this branch.
          stock_location_id: stockLocations.find((l) => l.branch_id === b.id)?.id ?? null,
          tables: tables.filter((tb) => tb.branch_id === b.id),
          stations: stations.filter((st) => st.branch_id === b.id),
        })),
        channels: channels.map((c) => ({ ...c, commission_rate: num(c.commission_rate), price_markup: num(c.price_markup) })),
        paymentMethods: paymentMethods.map((p) => ({ ...p, fee_rate: num(p.fee_rate), fee_fixed: money(p.fee_fixed) })),
        suppliers: suppliers.map((s) => ({
          ...s,
          items: supplierItems
            .filter((si) => si.supplier_id === s.id)
            .map((si) => ({ ingredientId: si.ingredient_id, packName: si.pack_name, packQty: num(si.pack_qty), lastPrice: si.last_price ? money(si.last_price) : null, isPreferred: si.is_preferred })),
        })),
        ingredients: ingredients.map((i) => ({
          ...i,
          reorder_point: i.reorder_point ? num(i.reorder_point) : null,
          par_level: i.par_level ? num(i.par_level) : null,
          // Per-base-unit costs keep their 6 decimals (0.045 ฿/ml); money() would round them to satang.
          standard_cost: i.standard_cost === null ? null : num(i.standard_cost),
          last_cost: i.last_cost === null ? null : num(i.last_cost),
        })),
        menuCategories,
        menuItems: menuItems.map((i) => ({
          ...i,
          price: money(i.price),
          modifierGroupIds: modifierLinks.filter((l) => l.menu_item_id === i.id).map((l) => l.group_id),
          recipe: recipeLines.filter((l) => l.menu_item_id === i.id).map((l) => ({ ingredientId: l.ingredient_id, qty: num(l.qty), wasteRate: num(l.waste_rate) })),
        })),
        modifierGroups: modifierGroups.map((g) => ({
          ...g,
          options: modifierOptions.filter((o) => o.group_id === g.id).map((o) => ({ ...o, price_delta: money(o.price_delta) })),
        })),
        roles: roles.map((r) => ({ ...r, permissions: r.grants_all ? ["*"] : rolePermissions.filter((p) => p.role_id === r.id).map((p) => p.permission_key) })),
        members: members.map((m) => ({
          ...m,
          max_discount_rate: num(m.max_discount_rate),
          branch_ids: m.all_branches ? null : membershipBranches.filter((mb) => mb.membership_id === m.id).map((mb) => mb.branch_id),
        })),
      };
    }),
  );
}
