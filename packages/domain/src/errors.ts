/**
 * Human error messages.
 *
 * Staff never see a stack trace, SQL state or "Error 500". Every failure has a
 * code (raised by the database/API), and every code maps to:
 *   – a short title in plain Thai,
 *   – what happened and what to do next, in one sentence,
 *   – a primary action the UI can offer (retry, ask a manager, open a shift…).
 * Unknown codes fall back to a calm generic message with a reference number
 * support can look up — the technical detail stays in the logs.
 */
export type ErrorAction =
  | "retry"
  | "request_approval"
  | "open_shift"
  | "refresh"
  | "upgrade"
  | "fix_input"
  | "contact_manager"
  | "dismiss"
  | "sign_in";

export type Severity = "info" | "warning" | "error";

export interface ErrorCopy {
  title: string;
  message: string;
  titleEn: string;
  messageEn: string;
  action: ErrorAction;
  actionLabel: string;
  severity: Severity;
}

type Params = Record<string, unknown>;
type CopyFn = (p: Params) => ErrorCopy;

const c = (
  title: string,
  message: string | ((p: Params) => string),
  titleEn: string,
  messageEn: string | ((p: Params) => string),
  action: ErrorAction,
  actionLabel: string,
  severity: Severity = "warning",
): CopyFn => (p) => ({
  title,
  message: typeof message === "function" ? message(p) : message,
  titleEn,
  messageEn: typeof messageEn === "function" ? messageEn(p) : messageEn,
  action,
  actionLabel,
  severity,
});

const baht = (v: unknown) =>
  typeof v === "number" || typeof v === "string"
    ? `฿${Number(v).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";

export const ERROR_CATALOG = {
  // Access & session
  PERMISSION_DENIED: c("ต้องให้ผู้จัดการช่วย", "งานนี้ต้องใช้สิทธิ์ที่สูงขึ้น ขอให้ผู้จัดการใส่ PIN หรือทำให้แทน", "Manager needed", "This needs higher permission. Ask a manager to approve with their PIN.", "request_approval", "ขออนุมัติ"),
  AUTH_REQUIRED: c("กรุณาเข้าสู่ระบบอีกครั้ง", "เพื่อความปลอดภัย ระบบออกจากบัญชีอัตโนมัติ", "Please sign in again", "You were signed out for security.", "sign_in", "เข้าสู่ระบบ", "info"),
  AUTH_INVALID: c("อีเมลหรือรหัสผ่านไม่ถูกต้อง", "ตรวจอีเมลและรหัสผ่านอีกครั้ง ถ้าลืมรหัสผ่านให้กด “ลืมรหัสผ่าน”", "Wrong e-mail or password", "Check both and try again. Use “Forgot password” if you need a new one.", "fix_input", "ลองใหม่", "warning"),
  EMAIL_TAKEN: c("อีเมลนี้มีบัญชีอยู่แล้ว", "ลองเข้าสู่ระบบด้วยอีเมลนี้ หรือใช้อีเมลอื่นสมัคร", "This e-mail already has an account", "Sign in with it instead, or sign up with another e-mail.", "sign_in", "เข้าสู่ระบบ", "warning"),
  WEAK_PASSWORD: c("รหัสผ่านสั้นหรือเดาง่ายเกินไป", "ใช้อย่างน้อย 8 ตัวอักษร ผสมตัวอักษรกับตัวเลข", "That password is too weak", "Use at least 8 characters, mixing letters and numbers.", "fix_input", "แก้รหัสผ่าน", "warning"),
  EMAIL_NOT_CONFIRMED: c("ยังไม่ได้ยืนยันอีเมล", "เปิดอีเมลที่เราส่งไปแล้วกดลิงก์ยืนยัน จากนั้นเข้าสู่ระบบอีกครั้ง", "E-mail not confirmed yet", "Open the message we sent, tap the link, then sign in again.", "dismiss", "เข้าใจแล้ว", "info"),
  DEVICE_REVOKED: c("เครื่องนี้ถูกยกเลิกการลงทะเบียนแล้ว", "ให้เจ้าของร้านหรือผู้จัดการเข้าสู่ระบบด้วยอีเมล แล้วลงทะเบียนเครื่องนี้ใหม่ในตั้งค่า", "This device is no longer registered", "Ask the owner or a manager to sign in with e-mail and register this device again in Settings.", "contact_manager", "เข้าสู่ระบบด้วยอีเมล", "warning"),
  APPROVAL_REQUIRED: c("ต้องให้ผู้จัดการอนุมัติ", "ให้ผู้จัดการใส่ PIN บนเครื่องนี้เพื่อยืนยัน", "Approval needed", "Ask a manager to enter their PIN on this device.", "request_approval", "ใส่ PIN ผู้จัดการ", "info"),
  APPROVAL_INVALID: c("การอนุมัติหมดอายุ", "การอนุมัติใช้ได้ครั้งเดียวภายใน 5 นาที ขออนุมัติใหม่อีกครั้ง", "Approval expired", "Approvals are single-use and last 5 minutes. Please request again.", "request_approval", "ขออนุมัติใหม่"),
  APPROVAL_PIN_INVALID: c("PIN ไม่ถูกต้อง", "ลองใส่ PIN ของผู้จัดการอีกครั้ง", "Wrong PIN", "Please try the manager PIN again.", "fix_input", "ลองอีกครั้ง"),
  APPROVER_NOT_ALLOWED: c("PIN นี้อนุมัติไม่ได้", "เจ้าของ PIN นี้ไม่มีสิทธิ์อนุมัติเรื่องนี้ ให้ผู้จัดการหรือเจ้าของร้านใส่แทน", "This person can't approve", "Ask a manager or the owner to approve instead.", "request_approval", "ใช้ PIN อื่น"),
  PIN_INVALID: c("PIN ไม่ถูกต้อง", "ลองใส่อีกครั้ง ถ้าลืม PIN ให้ผู้จัดการตั้งให้ใหม่ในหน้าทีมงาน", "Wrong PIN", "Try again, or ask a manager to reset your PIN.", "fix_input", "ลองอีกครั้ง"),
  PIN_FORMAT: c("PIN ต้องเป็นตัวเลข 4–6 หลัก", "เช่น 2580 — เลือกเลขที่จำง่ายแต่เดายาก", "PIN must be 4–6 digits", "Pick digits that are easy to remember but hard to guess.", "fix_input", "แก้ไข"),
  PIN_IN_USE: c("PIN นี้มีคนใช้แล้ว", "เลือก PIN อื่นเพื่อไม่ให้สลับตัวผู้ใช้ผิดคน", "PIN already taken", "Choose another PIN so users are never mixed up.", "fix_input", "เลือก PIN ใหม่"),

  // POS
  SHIFT_REQUIRED: c("ยังไม่ได้เปิดกะ", "เปิดกะและนับเงินทอนตั้งต้นก่อน แล้วค่อยรับเงินสด", "No open shift", "Open a shift and count the starting float before taking cash.", "open_shift", "เปิดกะ", "info"),
  SHIFT_ALREADY_OPEN: c("เปิดกะไว้แล้ว", "เครื่องนี้มีกะที่เปิดอยู่ ขายต่อได้เลย", "Shift already open", "This device already has an open shift.", "dismiss", "ขายต่อ", "info"),
  SHIFT_NOT_OPEN: c("กะนี้ปิดไปแล้ว", "เปิดกะใหม่เพื่อขายต่อ", "Shift is closed", "Open a new shift to continue.", "open_shift", "เปิดกะใหม่", "info"),
  ORDER_NOT_OPEN: c("บิลนี้ปิดไปแล้ว", "บิลถูกชำระหรือยกเลิกไปแล้ว ระบบกำลังโหลดข้อมูลล่าสุด", "Order already closed", "It was paid or voided. Refreshing.", "refresh", "โหลดใหม่", "info"),
  ORDER_NOT_PAID: c("บิลนี้ยังไม่ได้ชำระ", "คืนเงินได้เฉพาะบิลที่ชำระแล้ว", "Order not paid", "Only paid orders can be refunded.", "dismiss", "ตกลง"),
  TAX_INVOICE_NOT_AVAILABLE: c("ออกใบกำกับภาษีไม่ได้", "ร้านต้องจดทะเบียน VAT และใส่เลขประจำตัวผู้เสียภาษีของร้านก่อน (ตั้งค่า → ใบเสร็จและเครื่องพิมพ์)", "Tax invoice unavailable", "The shop must be VAT-registered with its taxpayer number on file (Settings → Receipts & printer).", "contact_manager", "ไปที่ตั้งค่า"),
  TAX_INVOICE_ORDER_NOT_PAID: c("บิลนี้ออกใบกำกับภาษีไม่ได้", "ออกใบกำกับภาษีได้เฉพาะบิลที่ชำระแล้วและยังไม่ถูกคืนเงิน", "Can't issue for this bill", "Tax invoices are only for paid bills that have not been refunded.", "dismiss", "ตกลง"),
  TAX_INVOICE_EXISTS: c("บิลนี้ออกใบกำกับภาษีไปแล้ว", (p) => `ใบกำกับภาษีเลขที่ ${p.invoice_no ?? ""} ออกแล้ว พิมพ์ซ้ำได้ แต่ออกใบใหม่ซ้ำบนบิลเดิมไม่ได้`, "Already issued", (p) => `Tax invoice ${p.invoice_no ?? ""} exists. Reprint it; a second one cannot be issued.`, "refresh", "ดูใบกำกับภาษี", "info"),
  ORDER_EMPTY: c("ยังไม่มีรายการในบิล", "เลือกเมนูอย่างน้อย 1 รายการ", "Order is empty", "Add at least one item.", "fix_input", "เลือกเมนู", "info"),
  STALE_VERSION: c("มีคนแก้บิลนี้พร้อมกัน", "ระบบดึงข้อมูลล่าสุดมาให้แล้ว ตรวจดูแล้วทำต่อได้เลย", "Updated by someone else", "We loaded the latest version — check and continue.", "refresh", "ดูข้อมูลล่าสุด", "info"),
  CHANNEL_NOT_FOUND: c("ช่องทางขายนี้ถูกปิดอยู่", "เปิดช่องทางนี้ในหน้าตั้งค่า หรือเลือกช่องทางอื่น", "Channel unavailable", "Enable it in settings or choose another channel.", "fix_input", "เลือกช่องทางอื่น"),
  MENU_ITEM_NOT_FOUND: c("เมนูนี้ถูกปิดขายแล้ว", "เมนูอาจถูกแก้ไขจากเครื่องอื่น ระบบอัปเดตรายการให้แล้ว", "Item no longer available", "It was changed elsewhere; the menu has been refreshed.", "refresh", "โหลดเมนูใหม่"),
  MENU_ITEM_SOLD_OUT: c("ของหมด", (p) => `${p.name ?? "เมนูนี้"} หมดแล้ววันนี้ ลองแนะนำเมนูอื่นให้ลูกค้า`, "Sold out", (p) => `${p.name ?? "This item"} is sold out today.`, "dismiss", "เลือกเมนูอื่น", "info"),
  INVALID_QTY: c("จำนวนไม่ถูกต้อง", "ใส่จำนวนที่มากกว่า 0", "Invalid quantity", "Enter a quantity greater than zero.", "fix_input", "แก้ไข"),
  INVALID_MODIFIER: c("ตัวเลือกไม่ตรงกับเมนู", "ตัวเลือกบางอย่างถูกเปลี่ยนไปแล้ว ลองเลือกใหม่อีกครั้ง", "Option changed", "Some options changed. Please choose again.", "refresh", "เลือกใหม่"),
  MODIFIER_SELECTION: c(
    "เลือกตัวเลือกให้ครบ",
    (p) => `“${p.group ?? "ตัวเลือก"}” ${p.min == null || p.max == null ? "ยังเลือกไม่ครบตามที่กำหนด" : `เลือกได้ ${p.min === p.max ? p.min : `${p.min}–${p.max}`} อย่าง`}`,
    "Check the options",
    (p) => `“${p.group ?? "Options"}”: ${p.min == null || p.max == null ? "please complete the selection" : `choose ${p.min}–${p.max}`}.`,
    "fix_input",
    "เลือกให้ครบ",
    "info",
  ),
  PAYMENT_REQUIRED: c("ยังไม่ได้เลือกวิธีชำระเงิน", "เลือกเงินสด พร้อมเพย์ หรือบัตร", "Choose a payment method", "Pick cash, PromptPay or card.", "fix_input", "เลือก", "info"),
  PAYMENT_METHOD_NOT_FOUND: c("ช่องทางชำระเงินนี้ถูกปิด", "เลือกช่องทางอื่น หรือให้ผู้จัดการเปิดในหน้าตั้งค่า", "Payment method off", "Choose another method or ask a manager to enable it.", "fix_input", "เลือกช่องทางอื่น"),
  PAYMENT_REFERENCE_REQUIRED: c("ใส่เลขอ้างอิงการชำระ", (p) => `${p.method ?? "ช่องทางนี้"} ต้องมีเลขอ้างอิง (เช่น 4 ตัวท้ายบัตร) เพื่อกระทบยอดภายหลัง`, "Reference needed", "Enter the reference (e.g. last 4 digits) for reconciliation.", "fix_input", "ใส่เลขอ้างอิง", "info"),
  PAYMENT_TOTAL_MISMATCH: c("ยอดชำระไม่ตรงกับบิล", (p) => `ยอดบิล ${baht(p.total)} แต่รับมา ${baht(p.paid)} ตรวจจำนวนอีกครั้ง`, "Amount doesn't match", (p) => `Bill is ${baht(p.total)}, received ${baht(p.paid)}.`, "fix_input", "แก้ยอด"),
  INVALID_AMOUNT: c("จำนวนเงินไม่ถูกต้อง", "ใส่จำนวนเงินที่มากกว่า 0", "Invalid amount", "Enter an amount greater than zero.", "fix_input", "แก้ไข"),
  INVALID_PERIOD: c("ช่วงเวลาไม่ถูกต้อง", "ใส่ทั้งวันเริ่มและวันสิ้นสุด และวันสิ้นสุดต้องไม่ก่อนวันเริ่ม (ไม่เกิน 1 ปี)", "Invalid period", "Enter a start and an end date, end on or after start (max 1 year).", "fix_input", "แก้ไข"),
  INVALID_TENDERED: c("รับเงินมาน้อยกว่ายอด", "เงินที่รับมาต้องไม่น้อยกว่ายอดที่ชำระ", "Not enough cash", "Cash received must cover the amount.", "fix_input", "แก้ไข"),
  INVALID_DISCOUNT: c("ส่วนลดไม่ถูกต้อง", "ส่วนลดเป็นเปอร์เซ็นต์ได้ 0–100% หรือเป็นจำนวนเงิน", "Invalid discount", "Use 0–100% or a fixed amount.", "fix_input", "แก้ไข"),
  DISCOUNT_OVER_LIMIT: c("ส่วนลดเกินวงเงินที่อนุมัติได้", "ลดราคาได้ไม่เกินวงเงินของผู้อนุมัติ ให้เจ้าของร้านอนุมัติแทน", "Discount over limit", "Ask the owner to approve this discount.", "request_approval", "ขออนุมัติ"),
  REASON_REQUIRED: c("บอกเหตุผลสั้นๆ", "เหตุผลช่วยให้เจ้าของร้านเข้าใจ และไม่ต้องถามย้อนหลัง", "Add a reason", "A short reason helps the owner understand later.", "fix_input", "ใส่เหตุผล", "info"),
  TICKET_CANCELLED: c("ออเดอร์นี้ถูกยกเลิกแล้ว", "ไม่ต้องทำรายการนี้ต่อ", "Ticket cancelled", "No need to prepare this.", "dismiss", "รับทราบ", "info"),

  // Menu & recipes
  RECIPE_CYCLE: c("สูตรวนกลับมาที่ตัวเอง", "วัตถุดิบนี้ใช้สูตรนี้อยู่แล้ว เลือกวัตถุดิบอื่นแทน", "Recipe loop", "This ingredient already uses this recipe.", "fix_input", "เลือกใหม่"),
  RECIPE_QTY_MUST_BE_POSITIVE: c("ปริมาณต้องมากกว่า 0", "ใส่ปริมาณที่ใช้ต่อ 1 จาน", "Quantity must be positive", "Enter the amount used per portion.", "fix_input", "แก้ไข"),
  INVALID_BASE_UNIT: c("หน่วยนับไม่ถูกต้อง", "เลือกหน่วยพื้นฐาน กรัม มิลลิลิตร หรือชิ้น", "Invalid unit", "Choose grams, millilitres or pieces.", "fix_input", "เลือกหน่วย"),
  UNIT_DIMENSION_MISMATCH: c("หน่วยไม่เข้ากัน", "หน่วยที่แสดงต้องเป็นประเภทเดียวกับหน่วยพื้นฐาน (เช่น กรัม ↔ กิโลกรัม)", "Units don't match", "Display unit must match the base unit type.", "fix_input", "เลือกหน่วย"),

  // Inventory & purchasing
  LINES_REQUIRED: c("ยังไม่มีรายการ", "เพิ่มอย่างน้อย 1 รายการก่อนบันทึก", "No lines yet", "Add at least one line.", "fix_input", "เพิ่มรายการ", "info"),
  PO_NOT_RECEIVABLE: c("ใบสั่งซื้อนี้รับของไม่ได้", "ใบสั่งซื้อต้องได้รับอนุมัติและยังรับของไม่ครบ", "PO can't be received", "It must be approved and not fully received.", "dismiss", "ตกลง"),
  PO_NOT_EDITABLE: c("แก้ใบสั่งซื้อนี้ไม่ได้แล้ว", "ใบสั่งซื้อที่ส่งแล้วแก้ไม่ได้ ยกเลิกแล้วสร้างใหม่แทน", "PO locked", "Sent POs can't be edited; cancel and create a new one.", "dismiss", "ตกลง"),
  INVALID_TRANSITION: c("ทำขั้นตอนนี้ไม่ได้", "สถานะของเอกสารเปลี่ยนไปแล้ว ระบบโหลดข้อมูลล่าสุดให้", "Step not allowed", "The document status changed. Refreshing.", "refresh", "โหลดใหม่"),
  INVALID_REASON: c("เลือกสาเหตุ", "เลือกสาเหตุจากรายการ เช่น หมดอายุ หรือทำหก", "Choose a reason", "Pick a reason from the list.", "fix_input", "เลือกสาเหตุ", "info"),
  COUNT_ALREADY_OPEN: c("มีการนับสต็อกค้างอยู่", "นับต่อจากรอบเดิม หรือให้ผู้จัดการยกเลิกรอบเดิมก่อน", "Count in progress", "Continue the open count first.", "refresh", "นับต่อ", "info"),
  COUNT_NOT_IN_PROGRESS: c("รอบนับนี้ส่งไปแล้ว", "ถ้านับผิด ให้ผู้จัดการตีกลับหรือเริ่มรอบใหม่", "Count already submitted", "Ask a manager to reopen it.", "dismiss", "ตกลง", "info"),
  COUNT_NOT_SUBMITTED: c("ยังนับไม่เสร็จ", "ส่งผลการนับก่อน แล้วจึงอนุมัติได้", "Count not submitted", "Submit the count before approving.", "dismiss", "ตกลง", "info"),
  TRANSFER_NOT_DRAFT: c("ส่งของรายการนี้ไปแล้ว", "ใบโอนนี้ถูกส่งไปแล้ว", "Already sent", "This transfer was already sent.", "refresh", "โหลดใหม่", "info"),
  TRANSFER_NOT_SENT: c("ยังไม่ได้ส่งของ", "รอให้ต้นทางกดส่งของก่อน แล้วจึงกดรับได้", "Not sent yet", "Wait until the sender confirms dispatch.", "dismiss", "ตกลง", "info"),

  // Finance
  PERIOD_CLOSED: c("วันนี้ปิดยอดไปแล้ว", "รายการใหม่จะไปอยู่ในวันถัดไปโดยอัตโนมัติ หากต้องแก้ไขวันเดิมให้ผู้จัดการเปิดวันใหม่", "Day already closed", "New entries go to the next day. A manager can reopen the day.", "contact_manager", "ติดต่อผู้จัดการ", "info"),
  OPEN_ORDERS_EXIST: c("ยังมีบิลค้างอยู่", (p) => `ยังมีบิลที่ยังไม่ชำระ ${p.count ?? ""} บิล ชำระหรือยกเลิกก่อนปิดยอด`, "Open orders remain", (p) => `${p.count ?? "Some"} orders are still open.`, "fix_input", "ดูบิลค้าง"),
  OPEN_SHIFTS_EXIST: c("ยังมีกะที่ยังไม่ปิด", (p) => `ปิดกะและนับเงินสด ${p.count ?? ""} กะก่อน แล้วค่อยปิดยอดวัน`, "Shifts still open", "Close and count all shifts first.", "fix_input", "ไปปิดกะ"),
  DAY_NOT_CLOSED: c("วันนี้ยังไม่ได้ปิดยอด", "ปิดยอดก่อนจึงจะเปิดใหม่ได้", "Day not closed", "Close the day first.", "dismiss", "ตกลง", "info"),
  DAY_ALREADY_RECONCILED: c("วันนี้กระทบยอดไปแล้ว", "ยกเลิกการจับคู่รายการธนาคารของวันนี้ก่อน จึงจะเปิดวันใหม่ได้", "Already reconciled", "Unmatch bank lines for this day first.", "contact_manager", "ติดต่อบัญชี"),
  JOURNAL_UNBALANCED: c("ยอดบัญชีไม่สมดุล", "ระบบยกเลิกรายการนี้เพื่อความถูกต้อง ทีมงานได้รับแจ้งแล้ว", "Books didn't balance", "We cancelled this to keep your books correct.", "contact_manager", "ติดต่อทีมงาน", "error"),
  ACCOUNT_NOT_CONFIGURED: c("ยังไม่ได้ตั้งค่าบัญชี", "ให้เจ้าของร้านหรือนักบัญชีตั้งค่าผังบัญชีส่วนนี้ก่อน", "Account not set up", "Ask the owner or accountant to configure it.", "contact_manager", "ติดต่อผู้ดูแล"),
  SUPPLIER_REQUIRED_FOR_CREDIT: c("เลือกผู้ขายสำหรับซื้อเชื่อ", "ถ้าจ่ายเงินสดแล้ว เลือก “จ่ายแล้ว” ได้เลยไม่ต้องใส่ผู้ขาย", "Pick a supplier", "For credit purchases choose a supplier, or mark it as paid.", "fix_input", "เลือกผู้ขาย", "info"),
  INVALID_EXPENSE_ACCOUNT: c("เลือกหมวดค่าใช้จ่าย", "เลือกหมวด เช่น ค่าเช่า ค่าไฟ หรือวัสดุสิ้นเปลือง", "Pick a category", "Choose an expense category.", "fix_input", "เลือกหมวด", "info"),
  BILL_NOT_PAYABLE: c("บิลนี้จ่ายครบแล้ว", "ไม่ต้องจ่ายซ้ำ", "Bill already paid", "Nothing left to pay.", "dismiss", "ตกลง", "info"),
  INVALID_ACCOUNT: c("เลือกบัญชีที่จ่าย", "เลือกเงินสดหรือบัญชีธนาคาร", "Pick an account", "Choose cash or bank.", "fix_input", "เลือก", "info"),
  LINE_ALREADY_MATCHED: c("รายการนี้จับคู่แล้ว", "รายการธนาคารนี้ถูกจับคู่ไปแล้ว", "Already matched", "This bank line is already matched.", "refresh", "โหลดใหม่", "info"),
  VARIANCE_ACCOUNT_REQUIRED: c("ยอดต่างกันเล็กน้อย", (p) => `เงินเข้าต่างจากที่คาดไว้ ${baht(p.variance)} เลือกสาเหตุ เช่น ค่า GP หรือค่าธรรมเนียม`, "Small difference", (p) => `Received differs by ${baht(p.variance)}. Choose why.`, "fix_input", "เลือกสาเหตุ", "info"),

  // Plan
  PLAN_LIMIT_REACHED: c(
    "ถึงขีดจำกัดของแพ็กเกจ",
    (p) =>
      `แพ็กเกจปัจจุบันรองรับ${p.metric === "branches" ? "สาขา" : p.metric === "staff" ? "พนักงาน" : "อุปกรณ์"}${p.limit != null ? `ได้ ${p.limit} รายการ` : "ครบแล้ว"} อัปเกรดเพื่อเพิ่มได้ทันที`,
    "Plan limit reached",
    (p) => (p.limit != null ? `Your plan allows ${p.limit} ${p.metric ?? "items"}.` : "You've reached your plan's limit."),
    "upgrade",
    "ดูแพ็กเกจ",
    "info",
  ),
  FEATURE_NOT_IN_PLAN: c("ฟีเจอร์นี้อยู่ในแพ็กเกจที่สูงกว่า", "อัปเกรดเพื่อใช้งาน ข้อมูลทั้งหมดของร้านยังอยู่ครบ", "Upgrade to use this", "Your data stays safe; upgrade anytime.", "upgrade", "ดูแพ็กเกจ", "info"),

  // Generic / transport
  LAST_OWNER: c("ต้องมีเจ้าของร้านอย่างน้อย 1 คน", "เพิ่มหรือแต่งตั้งเจ้าของร้านคนใหม่ก่อน แล้วค่อยเปลี่ยนตำแหน่งหรือปิดบัญชีนี้", "At least one owner is required", "Make someone else an owner first.", "fix_input", "เข้าใจแล้ว"),
  CANNOT_DEACTIVATE_SELF: c("ปิดบัญชีของตัวเองไม่ได้", "ให้เจ้าของร้านหรือผู้จัดการอีกคนเป็นผู้ปิดให้", "You can't deactivate yourself", "Ask another owner or manager.", "fix_input", "เข้าใจแล้ว"),
  PROMPTPAY_ID_INVALID: c("หมายเลขพร้อมเพย์ไม่ถูกต้อง", "ใช้เบอร์มือถือ 10 หลัก หรือเลขประจำตัวผู้เสียภาษี/บัตรประชาชน 13 หลัก", "Invalid PromptPay ID", "Use a 10-digit mobile number or a 13-digit tax ID.", "fix_input", "แก้ไข"),
  CASH_REQUIRED: c("ปิดการรับเงินสดไม่ได้", "เงินสดใช้สำหรับทอนและกรณีระบบอื่นขัดข้อง จึงต้องเปิดไว้เสมอ", "Cash can't be turned off", "Cash is needed for change and as a fallback.", "fix_input", "เข้าใจแล้ว"),
  NOT_FOUND: c("ไม่พบข้อมูล", "ข้อมูลอาจถูกลบหรือย้ายไปแล้ว ลองโหลดหน้าใหม่", "Not found", "It may have been removed. Try refreshing.", "refresh", "โหลดใหม่"),
  VALIDATION: c("ข้อมูลยังไม่ครบ", "ตรวจช่องที่มีกรอบสีแดง แล้วลองอีกครั้ง", "Check the form", "Fix the highlighted fields and try again.", "fix_input", "แก้ไข", "info"),
  CONFLICT: c("มีข้อมูลนี้อยู่แล้ว", "ชื่อหรือรหัสนี้ถูกใช้แล้ว ลองใช้ชื่ออื่น", "Already exists", "That name or code is taken.", "fix_input", "แก้ไข"),
  LEDGER_IMMUTABLE: c("แก้รายการย้อนหลังไม่ได้", "เพื่อความถูกต้องของบัญชี ให้บันทึกรายการปรับปรุงแทนการแก้ไข", "Can't edit history", "Record a correcting entry instead.", "dismiss", "ตกลง"),
  RATE_LIMITED: c("ทำรายการถี่เกินไป", "รอสักครู่แล้วลองใหม่อีกครั้ง", "Too many attempts", "Wait a moment and try again.", "retry", "ลองใหม่"),
  NETWORK_OFFLINE: c("อินเทอร์เน็ตหลุด", "ขายต่อได้ตามปกติ ระบบจะส่งข้อมูลให้อัตโนมัติเมื่อกลับมาออนไลน์", "You're offline", "Keep selling — we'll sync automatically when you're back online.", "dismiss", "ขายต่อ", "info"),
  TIMEOUT: c("ระบบตอบช้ากว่าปกติ", "ข้อมูลยังไม่หาย ลองอีกครั้งได้เลย ระบบกันการบันทึกซ้ำให้แล้ว", "Taking too long", "Nothing was lost; retrying is safe.", "retry", "ลองอีกครั้ง"),
  INTERNAL: c("เกิดข้อผิดพลาดชั่วคราว", "ข้อมูลยังไม่หาย ลองอีกครั้ง ถ้ายังไม่ได้ แจ้งรหัสอ้างอิงนี้กับทีมงาน", "Something went wrong", "Nothing was lost. Try again, or share the reference with support.", "retry", "ลองอีกครั้ง", "error"),
} satisfies Record<string, CopyFn>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code);
}

export interface HumanError extends ErrorCopy {
  code: ErrorCode;
  /** Short reference support can search in logs, e.g. "8F2K-Q1". */
  reference?: string;
}

/** Turns any failure into something a person can act on. Never exposes internals. */
export function humanizeError(code: string | undefined | null, params: Params = {}, reference?: string): HumanError {
  const key: ErrorCode = code && isKnownErrorCode(code) ? code : "INTERNAL";
  const copy = ERROR_CATALOG[key](params);
  return { code: key, ...copy, ...(reference ? { reference } : {}) };
}

/** Friendly short reference from a request id (UUID) for staff to read aloud. */
export function shortReference(requestId: string): string {
  const hex = requestId.replace(/-/g, "").slice(-8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** Maps a Postgres/driver error to a domain code. */
export function codeFromDatabaseError(err: { code?: string; message?: string }): ErrorCode {
  if (err.code === "P0001" && err.message && isKnownErrorCode(err.message)) return err.message;
  if (err.code === "23505") return "CONFLICT";
  if (err.code === "23503" || err.code === "23514" || err.code === "22P02" || err.code === "23502") return "VALIDATION";
  if (err.code === "42501") return "PERMISSION_DENIED";
  if (err.code === "57014") return "TIMEOUT";
  return "INTERNAL";
}
