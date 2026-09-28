/**
 * Sabai API contracts (v1).
 *
 * Wire conventions (docs/06-api.md):
 *   – Money in responses is a decimal string in THB ("145.00"); requests accept
 *     a number or a decimal string.
 *   – Quantities are in the ingredient's base unit (g, ml, pcs).
 *   – IDs are UUIDs; clients generate order/item ids (UUIDv7) so retries are safe.
 *   – Errors always use ApiErrorSchema — a human message is included.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
export const Id = z.uuid();

export const Money = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d{1,2})?$/, "ใส่จำนวนเงินเป็นตัวเลข")])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && Math.abs(v) < 1e10, "จำนวนเงินไม่ถูกต้อง");

export const PositiveMoney = Money.refine((v) => v > 0, "จำนวนเงินต้องมากกว่า 0");

export const Qty = z.number().finite().positive("จำนวนต้องมากกว่า 0").max(1_000_000);

export const IsoDate = z.iso.date();

const Reason = z.string().trim().min(1, "บอกเหตุผลสั้นๆ").max(200);
const Name = z.string().trim().min(1, "ต้องมีชื่อ").max(80, "ชื่อยาวเกินไป");

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    /** Plain-language title & message, already localised. */
    title: z.string(),
    message: z.string(),
    action: z.string(),
    actionLabel: z.string(),
    severity: z.enum(["info", "warning", "error"]),
    /** Field-level messages for forms. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Short reference shown to staff ("รหัสอ้างอิง") — maps to the request id in logs. */
    reference: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Auth & tenancy
// ---------------------------------------------------------------------------
export const CreateTenantBody = z.object({
  name: Name,
  businessType: z.enum(["cafe", "restaurant", "bar", "bakery", "cloud_kitchen", "food_truck", "buffet", "other"]).default("restaurant"),
  branchName: z.string().trim().max(80).optional(),
  ownerName: Name,
  vatRegistered: z.boolean().default(false),
  pricesIncludeVat: z.boolean().default(true),
});

export const PinSwitchBody = z.object({
  branchId: Id,
  pin: z.string().regex(/^\d{4,6}$/, "PIN เป็นตัวเลข 4–6 หลัก"),
});

export const ApprovalBody = z.object({
  branchId: Id,
  permission: z.enum(["pos.discount", "pos.void", "pos.refund"]),
  pin: z.string().regex(/^\d{4,6}$/, "PIN เป็นตัวเลข 4–6 หลัก"),
  targetType: z.string().max(40).optional(),
  targetId: Id.optional(),
  reason: z.string().max(200).optional(),
});

export const CreateMemberBody = z.object({
  displayName: Name,
  nickname: z.string().max(40).optional(),
  roleKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  /** PIN for shared devices — staff don't need an e-mail account. */
  pin: z.string().regex(/^\d{4,6}$/, "PIN เป็นตัวเลข 4–6 หลัก").optional(),
  branchIds: z.array(Id).max(100).optional(),
  maxDiscountRate: z.number().min(0).max(1).optional(),
  inviteContact: z.string().max(120).optional(),
});

export const SkipOnboardingBody = z.object({
  step: z.enum(["recipe", "staff"]),
});

// ---------------------------------------------------------------------------
// Menu & recipes
// ---------------------------------------------------------------------------
export const RecipeLineInput = z.object({
  ingredientId: Id,
  qty: z.number().finite().refine((v) => v !== 0, "ปริมาณต้องไม่เป็น 0"),
  wasteRate: z.number().min(0).max(0.95).default(0),
});

export const CreateIngredientBody = z.object({
  name: Name,
  baseUnit: z.enum(["g", "ml", "pcs"]),
  displayUnit: z.string().max(10).optional(),
  kind: z.enum(["raw", "prep", "packaging", "merchandise"]).default("raw"),
  trackStock: z.boolean().default(true),
  categoryId: Id.optional(),
  reorderPoint: z.number().nonnegative().optional(),
  parLevel: z.number().nonnegative().optional(),
  /** Cost per base unit used until the first purchase is recorded. */
  standardCost: z.number().nonnegative().optional(),
  storageZone: z.string().max(40).optional(),
});

export const CreateMenuItemBody = z.object({
  categoryId: Id.optional(),
  categoryName: z.string().trim().max(60).optional(),
  name: Name,
  nameEn: z.string().max(80).optional(),
  price: PositiveMoney,
  kitchenRoute: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).default("kitchen"),
  imageUrl: z.url().optional(),
  recipe: z.array(RecipeLineInput).max(60).optional(),
}).refine((b) => b.categoryId || b.categoryName, { message: "เลือกหมวดหมู่หรือพิมพ์ชื่อหมวดใหม่", path: ["categoryId"] });

export const AvailabilityBody = z.object({
  branchId: Id,
  available: z.boolean(),
  until: z.iso.datetime().optional(),
});

export const UpdateMenuItemBody = z
  .object({
    name: Name.optional(),
    nameEn: z.string().max(80).optional(),
    price: PositiveMoney.optional(),
    kitchenRoute: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,30}$/)
      .optional(),
    imageUrl: z.url().optional(),
    active: z.boolean().optional(),
    /** Replaces the current recipe entirely; omit to leave it unchanged. */
    recipe: z.array(RecipeLineInput).max(60).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "ไม่มีอะไรให้แก้ไข" });

// ---------------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------------
export const OrderItemInput = z.object({
  id: Id,
  menuItemId: Id,
  qty: Qty.max(999),
  note: z.string().trim().max(140).optional(),
  modifierOptionIds: z.array(Id).max(20).default([]),
});

export const SubmitOrderBody = z.object({
  id: Id,
  branchId: Id,
  channelId: Id.optional(),
  tableId: Id.optional(),
  deviceId: Id.optional(),
  guestCount: z.number().int().min(1).max(500).optional(),
  customerName: z.string().max(80).optional(),
  externalRef: z.string().max(60).optional(),
  note: z.string().max(200).optional(),
  expectedVersion: z.number().int().positive().optional(),
  items: z.array(OrderItemInput).max(200).default([]),
  fire: z.boolean().default(true),
});
export type SubmitOrderInput = z.infer<typeof SubmitOrderBody>;

export const PaymentInput = z.object({
  methodId: Id,
  amount: PositiveMoney,
  tendered: Money.optional(),
  reference: z.string().max(60).optional(),
});

export const PayOrderBody = z.object({
  payments: z.array(PaymentInput).min(1, "เลือกวิธีชำระเงิน").max(10),
});

export const DiscountBody = z.object({
  type: z.enum(["percent", "amount"]),
  value: z.number().nonnegative(),
  reason: Reason,
  approvalId: Id.optional(),
}).refine((b) => b.type !== "percent" || b.value <= 100, { message: "ส่วนลดสูงสุด 100%", path: ["value"] });

export const VoidBody = z.object({ reason: Reason, approvalId: Id.optional() });
export const RefundBody = z.object({ reason: Reason, restock: z.boolean().default(false), approvalId: Id.optional() });

export const OpenShiftBody = z.object({
  branchId: Id,
  deviceId: Id.optional(),
  openingFloat: Money.refine((v) => v >= 0, "เงินทอนตั้งต้นต้องไม่ติดลบ"),
});

export const CloseShiftBody = z.object({
  countedCash: Money.refine((v) => v >= 0, "จำนวนเงินต้องไม่ติดลบ"),
  /** {"1000": 2, "100": 5, "20": 3, …} — counting by note is faster and more accurate. */
  denominations: z.record(z.string(), z.number().int().nonnegative()).optional(),
  note: z.string().max(200).optional(),
});

export const CashMovementBody = z.object({
  kind: z.enum(["pay_in", "pay_out", "drop"]),
  amount: PositiveMoney,
  reason: Reason,
});

export const TicketStatusBody = z.object({ status: z.enum(["new", "in_progress", "ready", "served"]) });

// ---------------------------------------------------------------------------
// Inventory & purchasing
// ---------------------------------------------------------------------------
export const ReceiveLineInput = z.object({
  ingredientId: Id,
  packName: z.string().max(40).optional(),
  packQty: Qty.default(1),
  qtyPacks: Qty,
  unitPrice: Money.refine((v) => v >= 0, "ราคาต้องไม่ติดลบ"),
  poLineId: Id.optional(),
});

export const ReceiveGoodsBody = z.object({
  branchId: Id,
  locationId: Id.optional(),
  supplierId: Id.optional(),
  poId: Id.optional(),
  invoiceNo: z.string().max(40).optional(),
  invoiceDate: IsoDate.optional(),
  paymentMode: z.enum(["credit", "cash_paid", "transfer_paid"]).optional(),
  vatAmount: Money.optional(),
  attachmentUrl: z.url().optional(),
  note: z.string().max(200).optional(),
  lines: z.array(ReceiveLineInput).min(1, "เพิ่มอย่างน้อย 1 รายการ").max(200),
});

export const WasteBody = z.object({
  locationId: Id,
  ingredientId: Id,
  qty: Qty,
  reason: z.enum(["expired", "spoiled", "dropped", "overcooked", "wrong_order", "staff_meal", "tasting", "other"]),
  note: z.string().max(200).optional(),
});

export const StartCountBody = z.object({
  locationId: Id,
  scope: z.enum(["full", "partial", "cycle"]).default("full"),
  ingredientIds: z.array(Id).max(500).optional(),
  blind: z.boolean().default(true),
});

export const RecordCountBody = z.object({
  ingredientId: Id,
  counted: z.number().nonnegative().nullable(),
  note: z.string().max(200).optional(),
});

export const TransferBody = z.object({
  fromLocationId: Id,
  toLocationId: Id,
  note: z.string().max(200).optional(),
  lines: z.array(z.object({ ingredientId: Id, qty: Qty })).min(1).max(200),
});

export const SavePurchaseOrderBody = z.object({
  id: Id.optional(),
  branchId: Id,
  supplierId: Id,
  locationId: Id.optional(),
  expectedDate: IsoDate.optional(),
  note: z.string().max(200).optional(),
  lines: z
    .array(z.object({ ingredientId: Id, packName: z.string().max(40), packQty: Qty, qtyPacks: Qty, unitPrice: Money }))
    .min(1)
    .max(200),
});

export const PurchaseOrderStatusBody = z.object({ status: z.enum(["submitted", "approved", "sent", "cancelled"]) });

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export const CloseDayBody = z.object({ branchId: Id, note: z.string().max(500).optional() });

export const ExpenseBody = z.object({
  branchId: Id.optional(),
  expenseDate: IsoDate.optional(),
  accountId: Id,
  description: z.string().trim().min(1, "บอกว่าจ่ายค่าอะไร").max(200),
  amount: PositiveMoney,
  vatAmount: Money.optional(),
  whtAmount: Money.optional(),
  paidFrom: z.enum(["cash_on_hand", "bank", "credit"]),
  supplierId: Id.optional(),
  attachmentUrl: z.url().optional(),
  /** Service period, e.g. the month a rent payment covers. Reports spread the amount over it. */
  periodStart: IsoDate.optional(),
  periodEnd: IsoDate.optional(),
}).refine((b) => (b.periodStart === undefined) === (b.periodEnd === undefined) && (!b.periodStart || !b.periodEnd || b.periodEnd >= b.periodStart), {
  message: "ช่วงเวลาไม่ถูกต้อง: ใส่ทั้งวันเริ่มและวันสิ้นสุด โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
  path: ["periodEnd"],
});

export const ImportStatementBody = z.object({
  bankAccountId: Id,
  fileName: z.string().max(120).optional(),
  lines: z
    .array(z.object({ txnDate: IsoDate, amount: Money, description: z.string().max(200).optional(), reference: z.string().max(80).optional() }))
    .min(1)
    .max(5000),
});

export const MatchBody = z.object({
  expectedIds: z.array(Id).min(1).max(50),
  varianceAccount: z.enum(["commission_expense", "payment_fee_expense", "other_income", "other_expense"]).optional(),
  note: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Responses (shapes clients rely on)
// ---------------------------------------------------------------------------
export const MeResponse = z.object({
  user: z.object({ id: z.string().nullable(), displayName: z.string() }),
  memberships: z.array(
    z.object({
      membershipId: z.string(),
      tenantId: z.string(),
      tenantName: z.string(),
      role: z.object({ key: z.string(), name: z.string(), home: z.string(), grantsAll: z.boolean() }),
      permissions: z.array(z.string()),
      branches: z.array(z.object({ id: z.string(), name: z.string(), code: z.string() })),
      navigation: z.object({
        primary: z.array(z.object({ key: z.string(), href: z.string(), th: z.string(), icon: z.string() })),
        more: z.array(z.object({ key: z.string(), href: z.string(), th: z.string(), icon: z.string() })),
      }),
      home: z.string(),
    }),
  ),
});
export type Me = z.infer<typeof MeResponse>;

export const OrderResult = z.object({
  id: z.string(),
  orderNo: z.string().optional(),
  status: z.string(),
  total: z.string(),
  receiptNo: z.string().nullable().optional(),
  change: z.string().optional(),
});
