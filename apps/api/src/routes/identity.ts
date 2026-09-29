import {
  ApprovalBody,
  CreateMemberBody,
  CreateTenantBody,
  PinSwitchBody,
  SetMemberPinBody,
  SetRolePermissionsBody,
  SkipOnboardingBody,
  UpdateMemberBody,
} from "@sabai/contracts";
import { homeFor, navigationFor, onboardingProgress, type Home } from "@sabai/domain";
import type { Hono } from "hono";
import { mintStaffToken } from "../auth";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { RateLimiter } from "../rate-limit";
import { branchTenant, callJson } from "./support";

const pinLimiter = new RateLimiter(10, 60_000);

export function registerIdentity(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "POST", path: "/v1/tenants", tag: "Identity", summary: "สมัครใช้งาน: สร้างร้านพร้อมค่าเริ่มต้นที่พร้อมขาย", body: CreateTenantBody, status: 201 }, async ({ body, actor, tx }) => {
    if (!actor.userId) throw new ApiFailure("AUTH_REQUIRED", 401);
    return tx((t) =>
      callJson(t, "app.create_tenant", {
        name: body.name,
        business_type: body.businessType,
        branch_name: body.branchName,
        owner_name: body.ownerName,
        vat_registered: body.vatRegistered,
        prices_include_vat: body.pricesIncludeVat,
      }),
    );
  });

  route(app, deps, { method: "GET", path: "/v1/me", tag: "Identity", summary: "ฉันคือใคร อยู่ร้านไหน ทำอะไรได้บ้าง และควรเริ่มที่หน้าไหน" }, async ({ tx }) =>
    tx(async (t) => {
      const rows = await t<
        {
          membership_id: string;
          tenant_id: string;
          tenant_name: string;
          display_name: string;
          user_id: string | null;
          role_key: string;
          role_name: string;
          home: Home;
          grants_all: boolean;
          permissions: string[];
          all_branches: boolean;
        }[]
      >`
        select m.id as membership_id, m.tenant_id, t.name as tenant_name, m.display_name, m.user_id, m.all_branches,
               r.key as role_key, r.name as role_name, r.home, r.grants_all,
               coalesce(array_agg(rp.permission_key) filter (where rp.permission_key is not null), '{}') as permissions
          from app.actor_memberships() am
          join app.memberships m on m.id = am.id
          join app.tenants t on t.id = m.tenant_id
          join app.roles r on r.id = m.role_id
          left join app.role_permissions rp on rp.role_id = r.id
         group by m.id, t.name, r.id
         order by t.name`;
      const branches = await t<{ id: string; tenant_id: string; name: string; code: string }[]>`
        select id, tenant_id, name, code from app.branches where archived_at is null order by created_at`;
      const memberships = rows.map((m) => {
        const access = { grantsAll: m.grants_all, permissions: new Set(m.permissions) };
        const nav = navigationFor(access, m.role_key);
        const slim = (n: { key: string; href: string; th: string; icon: string }) => ({ key: n.key, href: n.href, th: n.th, icon: n.icon });
        return {
          membershipId: m.membership_id,
          tenantId: m.tenant_id,
          tenantName: m.tenant_name,
          displayName: m.display_name,
          role: { key: m.role_key, name: m.role_name, home: m.home, grantsAll: m.grants_all },
          permissions: m.grants_all ? ["*"] : m.permissions,
          branches: branches.filter((b) => b.tenant_id === m.tenant_id).map(({ id, name, code }) => ({ id, name, code })),
          navigation: { primary: nav.primary.map(slim), more: nav.more.map(slim) },
          home: homeFor(access, m.home),
        };
      });
      return { user: { id: rows[0]?.user_id ?? null, displayName: rows[0]?.display_name ?? "" }, memberships };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/auth/pin", tag: "Identity", summary: "สลับผู้ใช้บนเครื่องร้านด้วย PIN (ไม่ต้องมีอีเมล)", body: PinSwitchBody }, async ({ c, body, tx }) => {
    pinLimiter.check(`${c.req.header("x-forwarded-for") ?? "local"}:${body.branchId}`);
    const found = await tx(async (t) => {
      const tenantId = await branchTenant(t, body.branchId);
      const [row] = await t<{ id: string | null }[]>`select app.verify_pin(${tenantId}, ${body.branchId}, ${body.pin}) as id`;
      if (!row?.id) return null;
      const [m] = await t<{ display_name: string; role_key: string; home: string }[]>`
        select m.display_name, r.key as role_key, r.home from app.memberships m join app.roles r on r.id = m.role_id where m.id = ${row.id}`;
      return { tenantId, membershipId: row.id, ...m! };
    });
    if (!found) throw new ApiFailure("PIN_INVALID", 401);
    const token = await mintStaffToken({
      secret: deps.config.jwtSecret,
      membershipId: found.membershipId,
      tenantId: found.tenantId,
      branchId: body.branchId,
      ttlSeconds: deps.config.staffTokenTtlSeconds,
    });
    return { ...token, membership: { id: found.membershipId, displayName: found.display_name, role: found.role_key, home: found.home } };
  });

  route(app, deps, { method: "POST", path: "/v1/approvals", tag: "Identity", summary: "ผู้จัดการอนุมัติด้วย PIN (ใช้ได้ครั้งเดียวภายใน 5 นาที)", body: ApprovalBody, status: 201 }, async ({ c, body, tx }) => {
    pinLimiter.check(`${c.req.header("x-forwarded-for") ?? "local"}:${body.branchId}:approve`);
    const id = await tx(async (t) => {
      const [row] = await t<{ id: string }[]>`
        select app.request_approval(${body.branchId}, ${body.permission}, ${body.pin}, ${body.targetType ?? null},
                                    ${body.targetId ?? null}::uuid, ${body.reason ?? null}) as id`;
      return row!.id;
    });
    return { approvalId: id, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  });

  route(app, deps, { method: "GET", path: "/v1/members", tag: "Team", summary: "ทีมงานในร้าน", tenant: true, permission: "staff.manage" }, async ({ tenantId, tx }) =>
    tx((t) => t`
      select m.id, m.display_name, m.nickname, m.status, m.all_branches, m.user_id is null as pin_only, r.key as role_key, r.name as role_name
        from app.memberships m join app.roles r on r.id = m.role_id
       where m.tenant_id = ${tenantId} and m.status <> 'removed' order by r.sort, m.display_name`),
  );

  route(app, deps, { method: "POST", path: "/v1/members", tag: "Team", summary: "เพิ่มพนักงาน (ใช้ PIN บนเครื่องร้าน ไม่ต้องมีอีเมล)", tenant: true, body: CreateMemberBody, permission: "staff.manage", status: 201 }, async ({ tenantId, body, tx }) =>
    tx(async (t) => {
      const [role] = await t<{ id: string }[]>`select id from app.roles where tenant_id = ${tenantId} and key = ${body.roleKey}`;
      if (!role) throw new ApiFailure("VALIDATION", 422, {}, { roleKey: "ไม่พบตำแหน่งนี้" });
      const limits = body.maxDiscountRate !== undefined ? { max_discount_rate: body.maxDiscountRate } : {};
      const [m] = await t<{ id: string }[]>`
        insert into app.memberships (tenant_id, display_name, nickname, invite_contact, role_id, all_branches, status, limits)
        values (${tenantId}, ${body.displayName}, ${body.nickname ?? null}, ${body.inviteContact ?? null}, ${role.id},
                ${!body.branchIds?.length}, ${body.inviteContact ? "invited" : "active"}, ${t.json(limits)})
        returning id`;
      for (const b of body.branchIds ?? []) {
        await t`insert into app.membership_branches (tenant_id, membership_id, branch_id) values (${tenantId}, ${m!.id}, ${b})`;
      }
      if (body.pin) await t`select app.set_member_pin(${m!.id}, ${body.pin})`;
      return { id: m!.id };
    }),
  );

  route(app, deps, { method: "PATCH", path: "/v1/members/{id}", tag: "Team", summary: "แก้พนักงาน (ชื่อ ตำแหน่ง สาขา วงเงินส่วนลด) หรือปิด/เปิดใช้งาน", tenant: true, body: UpdateMemberBody, permission: "staff.manage" }, async ({ tenantId, params, body, tx }) =>
    tx(async (t) => {
      const [existing] = await t<{ id: string; status: string }[]>`select id, status from app.memberships where id = ${params.id} and tenant_id = ${tenantId} and status <> 'removed'`;
      if (!existing) throw new ApiFailure("NOT_FOUND", 404, { entity: "member" });

      // Two rules the database cannot know: you may not lock yourself out, and bringing someone back counts as adding them.
      if (body.status === "suspended") {
        const [me] = await t<{ id: string | null }[]>`select app.actor_membership_id(${tenantId}) as id`;
        if (me?.id === params.id) throw new ApiFailure("CANNOT_DEACTIVATE_SELF");
      }
      if (body.status === "active" && existing.status !== "active") {
        const [lim] = await t<{ limit: number | null; used: string }[]>`
          select app.plan_limit(${tenantId}, 'staff') as limit,
                 (select count(*) from app.memberships where tenant_id = ${tenantId} and status in ('active','invited')) as used`;
        if (lim && lim.limit !== null && Number(lim.used) >= lim.limit) throw new ApiFailure("PLAN_LIMIT_REACHED", 402, { metric: "staff", limit: lim.limit });
      }

      let roleId: string | null = null;
      if (body.roleKey !== undefined) {
        const [role] = await t<{ id: string }[]>`select id from app.roles where tenant_id = ${tenantId} and key = ${body.roleKey}`;
        if (!role) throw new ApiFailure("VALIDATION", 422, {}, { roleKey: "ไม่พบตำแหน่งนี้" });
        roleId = role.id;
      }

      await t`
        update app.memberships
           set display_name = coalesce(${body.displayName ?? null}, display_name),
               nickname = coalesce(${body.nickname ?? null}, nickname),
               role_id = coalesce(${roleId}, role_id),
               all_branches = coalesce(${body.allBranches ?? (body.branchIds ? false : null)}, all_branches),
               status = coalesce(${body.status ?? null}, status),
               limits = case when ${body.maxDiscountRate ?? null}::numeric is null then limits
                        else coalesce(limits, '{}'::jsonb) || jsonb_build_object('max_discount_rate', ${body.maxDiscountRate ?? null}::numeric) end
         where id = ${params.id} and tenant_id = ${tenantId}`;

      if (body.branchIds) {
        await t`delete from app.membership_branches where tenant_id = ${tenantId} and membership_id = ${params.id}`;
        for (const b of body.branchIds) {
          await t`insert into app.membership_branches (tenant_id, membership_id, branch_id) values (${tenantId}, ${params.id}, ${b})`;
        }
      } else if (body.allBranches === true) {
        await t`delete from app.membership_branches where tenant_id = ${tenantId} and membership_id = ${params.id}`;
      }

      return { id: params.id };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/members/{id}/pin", tag: "Team", summary: "ตั้ง PIN ใหม่ให้พนักงาน", tenant: true, body: SetMemberPinBody, permission: "staff.manage" }, async ({ tenantId, params, body, tx }) =>
    tx(async (t) => {
      const [existing] = await t<{ id: string }[]>`select id from app.memberships where id = ${params.id} and tenant_id = ${tenantId} and status <> 'removed'`;
      if (!existing) throw new ApiFailure("NOT_FOUND", 404, { entity: "member" });
      await t`select app.set_member_pin(${params.id}, ${body.pin})`;
      return { ok: true };
    }),
  );

  route(app, deps, { method: "PUT", path: "/v1/roles/{id}/permissions", tag: "Team", summary: "ตั้งสิทธิ์ของตำแหน่ง (แทนที่ชุดเดิมทั้งหมด)", tenant: true, body: SetRolePermissionsBody, permission: "staff.manage" }, async ({ tenantId, params, body, tx }) =>
    tx(async (t) => {
      const [role] = await t<{ id: string; grants_all: boolean }[]>`select id, grants_all from app.roles where id = ${params.id} and tenant_id = ${tenantId}`;
      if (!role) throw new ApiFailure("NOT_FOUND", 404, { entity: "role" });
      // The owner role has every right by definition; there is nothing to edit.
      if (role.grants_all) throw new ApiFailure("PERMISSION_DENIED", 403, { permission: "roles.edit_owner" });
      await t`delete from app.role_permissions where tenant_id = ${tenantId} and role_id = ${params.id}`;
      for (const key of body.permissions) {
        await t`insert into app.role_permissions (tenant_id, role_id, permission_key) values (${tenantId}, ${params.id}, ${key}) on conflict do nothing`;
      }
      return { id: params.id, permissions: body.permissions };
    }),
  );

  route(app, deps, { method: "GET", path: "/v1/onboarding", tag: "Onboarding", summary: "ความคืบหน้าการเริ่มต้นใช้งาน (คำนวณจากข้อมูลจริง)", tenant: true }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      const [f] = await t<
        { branch_ready: boolean; payments_ready: boolean; ingredients: number; menu_items: number; recipes: number; staff: number; has_sale: boolean; skipped: string[] }[]
      >`select * from app.v_onboarding_facts where tenant_id = ${tenantId}`;
      if (!f) throw new ApiFailure("NOT_FOUND", 404);
      return onboardingProgress({
        branchReady: f.branch_ready,
        paymentsReady: f.payments_ready,
        ingredients: f.ingredients,
        menuItems: f.menu_items,
        recipes: f.recipes,
        staff: f.staff,
        hasSale: f.has_sale,
        skipped: f.skipped ?? [],
      });
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/onboarding/skip", tag: "Onboarding", summary: "ข้ามขั้นตอนที่ไม่บังคับ", tenant: true, body: SkipOnboardingBody, permission: "settings.manage" }, async ({ tenantId, body, tx }) =>
    tx(async (t) => {
      const rows = await t`
        update app.tenants
           set settings = jsonb_set(settings, '{onboarding}',
                 coalesce(settings->'onboarding', '{}'::jsonb)
                 || jsonb_build_object('skipped', coalesce(settings->'onboarding'->'skipped', '[]'::jsonb) || to_jsonb(${body.step}::text)))
         where id = ${tenantId}
        returning id`;
      if (rows.length === 0) throw new ApiFailure("PERMISSION_DENIED", 403);
      return { ok: true };
    }),
  );
}
