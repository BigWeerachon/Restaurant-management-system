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

/** The device makes its own secret and sends only its SHA-256, so the API and the database never see the secret itself. */
export const RegisterDeviceBody = z.object({
  branchId: Id,
  name: Name,
  kind: z.enum(["pos", "kds", "kiosk", "printer_hub"]),
  stationId: Id.optional(),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/, "รหัสเครื่องไม่ถูกต้อง"),
});

export const DevicePinBody = z.object({
  pin: z.string().regex(/^\d{4,6}$/, "PIN เป็นตัวเลข 4–6 หลัก"),
});

export const PinSwitchBody = z.object({
  branchId: Id,
  pin: z.string().regex(/^\d{4,6}$/, "PIN เป็นตัวเลข 4–6 หลัก"),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const UpdateTenantBody = z
  .object({
    name: Name.optional(),
    businessType: z.enum(["cafe", "restaurant", "bar", "bakery", "cloud_kitchen", "food_truck", "buffet", "other"]).optional(),
    vatRegistered: z.boolean().optional(),
    pricesIncludeVat: z.boolean().optional(),
    vatRate: z.number().min(0).max(1).optional(),
    cashRounding: z.enum(["none", "0.25", "1.00"]).optional(),
    /** Printed on receipts and tax invoices. `null` clears it. */
    legalName: z.string().trim().max(160).nullable().optional(),
    taxId: z.string().regex(/^\d{13}$/, "เลขประจำตัวผู้เสียภาษี 13 หลัก").nullable().optional(),
    receiptFooter: z.string().trim().max(200).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "ไม่มีอะไรให้แก้ไข" });

export const CreateBranchBody = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{2,8}$/, "รหัสสาขา 2–8 ตัวอักษร/ตัวเลข"),
  name: Name,
  kind: z.enum(["outlet", "central_kitchen", "warehouse"]).default("outlet"),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  dayCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  serviceChargeRate: z.number().min(0).max(0.3).optional(),
});

export const UpdateBranchBody = z
  .object({
    name: Name.optional(),
    address: z.string().max(200).optional(),
    phone: z.string().max(20).optional(),
    dayCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    serviceChargeRate: z.number().min(0).max(0.3).optional(),
    /** Opening hours as the shop writes them ("07:00–21:00"), shown on the branch card. */
    openingHours: z.string().trim().max(60).optional(),
    /** The branch number on tax documents: "00000" is the head office. */
    taxBranchNo: z.string().regex(/^\d{5}$/, "เลขที่สาขา 5 หลัก เช่น 00000 (สำนักงานใหญ่)").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "ไม่มีอะไรให้แก้ไข" });

export const UpdateChannelBody = z
  .object({
    name: Name.optional(),
    color: z.string().max(20).optional(),
    active: z.boolean().optional(),
    appliesServiceCharge: z.boolean().optional(),
    /** Added to the menu price on this channel (0.15 = +15 %), rounded up to the next ฿5. */
    priceMarkup: z.number().min(0).max(1).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "ไม่มีอะไรให้แก้ไข" });

export const SetChannelCommissionBody = z.object({
  rate: z.number().min(0).max(1),
  validFrom: IsoDate,
  note: z.string().max(200).optional(),
});

export const UpdatePaymentMethodBody = z
  .object({
    name: Name.optional(),
    active: z.boolean().optional(),
    feeRate: z.number().min(0).max(0.2).optional(),
    promptpayId: z.string().max(20).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "ไม่มีอะไรให้แก้ไข" });

export const ChangePlanBody = z.object({ planCode: z.enum(["free", "starter", "pro", "business", "enterprise"]) });

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

export const UpdateMemberBody = z
  .object({
    displayName: Name.optional(),
    nickname: z.string().max(40).optional(),
    roleKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
    /** Present (even []) scopes to these branches; omit to leave scope unchanged. */
    branchIds: z.array(Id).max(100).optional(),
    allBranches: z.boolean().optional(),
    maxDiscountRate: z.number().min(0).max(1).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "ไม่มีอะไรให้แก้ไข" });

export const SetMemberPinBody = z.object({ pin: z.string().regex(/^\d{4,6}$/, "PIN เป็นตัวเลข 4–6 หลัก") });

export const SetRolePermissionsBody = z.object({ permissions: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).max(200) });

export const SkipOnboardingBody = z.object({
  step: z.enum(["recipe", "staff"]),
});

// ---------------------------------------------------------------------------
// Menu & recipes
// ---------------------------------------------------------------------------
/** The picture staff recognise an item by (one emoji, sometimes a sequence of them). */
const Emoji = z.string().trim().min(1).max(16);

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
  emoji: Emoji.optional(),
  /** Category by name: an existing one is reused, a new name creates it (like menu categories). */
  categoryName: z.string().trim().min(1).max(60).optional(),
  /** How it is usually bought. Remembered as the supplier's pack when a supplier is given. */
  pack: z.object({ name: z.string().max(40), qty: Qty, price: Money.refine((v) => v >= 0, "ราคาต้องไม่ติดลบ"), supplierId: Id.optional() }).optional(),
  /** Stock already on the shelf, recorded as an opening movement in this branch's default location. */
  openingQty: Qty.optional(),
  branchId: Id.optional(),
}).refine((b) => b.openingQty === undefined || b.branchId !== undefined, { message: "ระบุสาขาที่นับของเปิดยอด", path: ["branchId"] });

export const CreateMenuItemBody = z.object({
  categoryId: Id.optional(),
  categoryName: z.string().trim().max(60).optional(),
  name: Name,
  nameEn: z.string().max(80).optional(),
  emoji: Emoji.optional(),
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
    emoji: Emoji.optional(),
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

export const CreatePOFromSuggestionsBody = z.object({
  branchId: Id,
  supplierId: Id,
  /** Omit to include every suggested item for this supplier. */
  ingredientIds: z.array(Id).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export const CloseDayBody = z.object({ branchId: Id, note: z.string().max(500).optional() });

/** Matches the account system_key seeded by app.install_chart_of_accounts, "other" → "other_expense". */
export const ExpenseCategory = z.enum(["rent", "salaries", "utilities", "marketing", "supplies", "repairs", "other"]);

export const ExpenseBody = z
  .object({
    branchId: Id.optional(),
    expenseDate: IsoDate.optional(),
    /** Either works: accountId for a specific ledger account, or category for the usual ones (rent, salaries, ...). */
    accountId: Id.optional(),
    category: ExpenseCategory.optional(),
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
  })
  .refine((b) => b.accountId || b.category, { message: "เลือกบัญชีหรือหมวดหมู่ค่าใช้จ่าย", path: ["accountId"] })
  .refine((b) => (b.periodStart === undefined) === (b.periodEnd === undefined) && (!b.periodStart || !b.periodEnd || b.periodEnd >= b.periodStart), {
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
