import {
  ChangePlanBody,
  CreateBranchBody,
  SetChannelCommissionBody,
  UpdateBranchBody,
  UpdateChannelBody,
  UpdatePaymentMethodBody,
  UpdateTenantBody,
} from "@sabai/contracts";
import type { Hono } from "hono";
import { ApiFailure } from "../errors";
import { route, type Deps, type Env } from "../http";
import { callJson } from "./support";

export function registerSettings(app: Hono<Env>, deps: Deps) {
  route(app, deps, { method: "PATCH", path: "/v1/tenant", tag: "Settings", summary: "แก้ไขข้อมูลร้าน (ชื่อ ประเภทกิจการ ภาษี การปัดเศษ)", tenant: true, body: UpdateTenantBody, permission: "settings.manage" }, async ({ tenantId, body, tx }) =>
    tx(async (t) => {
      const rows = await t`
        update app.tenants
           set name = coalesce(${body.name ?? null}, name),
               business_type = coalesce(${body.businessType ?? null}, business_type),
               vat_registered = coalesce(${body.vatRegistered ?? null}, vat_registered),
               prices_include_vat = coalesce(${body.pricesIncludeVat ?? null}, prices_include_vat),
               vat_rate = coalesce(${body.vatRate ?? null}, vat_rate),
               cash_rounding = coalesce(${body.cashRounding ?? null}, cash_rounding)
         where id = ${tenantId}
        returning id`;
      if (!rows.length) throw new ApiFailure("NOT_FOUND", 404);
      return { id: tenantId };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/branches", tag: "Settings", summary: "เพิ่มสาขาใหม่", tenant: true, body: CreateBranchBody, permission: "settings.manage", status: 201 }, async ({ tenantId, body, tx }) =>
    tx((t) =>
      callJson<string>(t, "app.add_branch", {
        tenant_id: tenantId,
        code: body.code,
        name: body.name,
        kind: body.kind,
        address: body.address,
        phone: body.phone,
        day_cutoff: body.dayCutoff,
        service_charge_rate: body.serviceChargeRate,
      }).then((id) => ({ id })),
    ),
  );

  route(app, deps, { method: "PATCH", path: "/v1/branches/{id}", tag: "Settings", summary: "แก้ไขสาขา (ที่อยู่ เบอร์โทร เวลาตัดรอบวัน ค่าบริการ เปิด-ปิดใช้งาน)", tenant: true, body: UpdateBranchBody, permission: "settings.manage" }, async ({ tenantId, params, body, tx }) =>
    tx(async (t) => {
      const rows = await t`
        update app.branches
           set name = coalesce(${body.name ?? null}, name),
               address = coalesce(${body.address ?? null}, address),
               phone = coalesce(${body.phone ?? null}, phone),
               day_cutoff = coalesce(${body.dayCutoff ?? null}::time, day_cutoff),
               service_charge_rate = coalesce(${body.serviceChargeRate ?? null}, service_charge_rate),
               is_active = coalesce(${body.isActive ?? null}, is_active)
         where id = ${params.id} and tenant_id = ${tenantId}
        returning id`;
      if (!rows.length) throw new ApiFailure("NOT_FOUND", 404, { entity: "branch" });
      return { id: params.id };
    }),
  );

  route(app, deps, { method: "PATCH", path: "/v1/channels/{id}", tag: "Settings", summary: "แก้ไขช่องทางขาย (ชื่อ สี เปิด-ปิดใช้งาน ค่าบริการ)", tenant: true, body: UpdateChannelBody, permission: "settings.manage" }, async ({ tenantId, params, body, tx }) =>
    tx(async (t) => {
      const rows = await t`
        update app.sales_channels
           set name = coalesce(${body.name ?? null}, name),
               color = coalesce(${body.color ?? null}, color),
               is_active = coalesce(${body.active ?? null}, is_active),
               applies_service_charge = coalesce(${body.appliesServiceCharge ?? null}, applies_service_charge)
         where id = ${params.id} and tenant_id = ${tenantId}
        returning id`;
      if (!rows.length) throw new ApiFailure("NOT_FOUND", 404, { entity: "channel" });
      return { id: params.id };
    }),
  );

  route(
    app,
    deps,
    { method: "POST", path: "/v1/channels/{id}/commission-rate", tag: "Settings", summary: "ตั้งค่า GP ใหม่ พร้อมวันเริ่มมีผล (ของเดิมยังใช้กับยอดขายเก่า)", tenant: true, body: SetChannelCommissionBody, permission: "settings.manage" },
    async ({ tenantId, params, body, tx }) =>
      tx(async (t) => {
        const [channel] = await t<{ id: string }[]>`select id from app.sales_channels where id = ${params.id} and tenant_id = ${tenantId}`;
        if (!channel) throw new ApiFailure("NOT_FOUND", 404, { entity: "channel" });
        // Close whatever rate was open, then open the new one — never overlapping.
        await t`update app.channel_commission_rates set valid_to = ${body.validFrom}::date - 1
                 where tenant_id = ${tenantId} and channel_id = ${params.id} and valid_to is null`;
        await t`insert into app.channel_commission_rates (tenant_id, channel_id, rate, valid_from, note)
                values (${tenantId}, ${params.id}, ${body.rate}, ${body.validFrom}::date, ${body.note ?? null})`;
        return { id: params.id, rate: body.rate, validFrom: body.validFrom };
      }),
  );

  route(app, deps, { method: "PATCH", path: "/v1/payment-methods/{id}", tag: "Settings", summary: "แก้ไขช่องทางรับเงิน (ชื่อ เปิด-ปิดใช้งาน ค่าธรรมเนียม พร้อมเพย์)", tenant: true, body: UpdatePaymentMethodBody, permission: "settings.manage" }, async ({ tenantId, params, body, tx }) =>
    tx(async (t) => {
      const rows = await t`
        update app.payment_methods
           set name = coalesce(${body.name ?? null}, name),
               is_active = coalesce(${body.active ?? null}, is_active),
               fee_rate = coalesce(${body.feeRate ?? null}, fee_rate),
               config = case when ${body.promptpayId ?? null}::text is null then config
                        else coalesce(config, '{}'::jsonb) || jsonb_build_object('promptpay_id', ${body.promptpayId ?? null}::text) end
         where id = ${params.id} and tenant_id = ${tenantId}
        returning id`;
      if (!rows.length) throw new ApiFailure("NOT_FOUND", 404, { entity: "payment_method" });
      return { id: params.id };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/settings/payments/confirm-cash-only", tag: "Settings", summary: "ยืนยันว่าตั้งใจรับเงินสดอย่างเดียว (ข้ามขั้นตอนตั้งพร้อมเพย์)", tenant: true, permission: "settings.manage" }, async ({ tenantId, tx }) =>
    tx(async (t) => {
      await t`
        update app.tenants
           set settings = jsonb_set(settings, '{onboarding}',
                 coalesce(settings->'onboarding', '{}'::jsonb) || jsonb_build_object('payments_confirmed', true))
         where id = ${tenantId}`;
      return { ok: true };
    }),
  );

  route(app, deps, { method: "POST", path: "/v1/settings/plan", tag: "Settings", summary: "เปลี่ยนแพ็กเกจ", tenant: true, body: ChangePlanBody, permission: "settings.manage" }, async ({ tenantId, body, tx }) =>
    tx(async (t) => {
      await t`select app.change_plan(${tenantId}, ${body.planCode})`;
      return { planCode: body.planCode };
    }),
  );
}
