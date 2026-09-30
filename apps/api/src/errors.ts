import { codeFromDatabaseError, humanizeError, shortReference, type ErrorCode } from "@sabai/domain";
import { ZodError } from "zod";

/** A failure we raise on purpose, with a domain error code. */
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status?: number,
    readonly details: Record<string, unknown> = {},
    readonly fields?: Record<string, string>,
  ) {
    super(code);
  }
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  PERMISSION_DENIED: 403,
  APPROVAL_REQUIRED: 403,
  APPROVAL_INVALID: 403,
  APPROVAL_PIN_INVALID: 403,
  APPROVER_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CHANNEL_NOT_FOUND: 404,
  MENU_ITEM_NOT_FOUND: 404,
  PAYMENT_METHOD_NOT_FOUND: 404,
  STALE_VERSION: 409,
  CONFLICT: 409,
  LINE_ALREADY_MATCHED: 409,
  SHIFT_ALREADY_OPEN: 409,
  TAX_INVOICE_EXISTS: 409,
  COUNT_ALREADY_OPEN: 409,
  PLAN_LIMIT_REACHED: 402,
  BILLING_RESTRICTED: 402,
  BILLING_NOT_CONFIGURED: 503,
  INVOICE_NOT_OPEN: 409,
  FEATURE_NOT_IN_PLAN: 402,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  INTERNAL: 500,
  JOURNAL_UNBALANCED: 500,
};

export interface ErrorBody {
  error: {
    code: string;
    title: string;
    message: string;
    action: string;
    actionLabel: string;
    severity: "info" | "warning" | "error";
    reference: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

function parseDetail(detail: unknown): Record<string, unknown> {
  if (typeof detail !== "string" || !detail.startsWith("{")) return {};
  try {
    return JSON.parse(detail) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Converts anything thrown into a response a person can act on.
 * Internal details (SQL, stack, constraint names) are logged, never returned.
 */
export function toErrorResponse(
  err: unknown,
  requestId: string,
  locale: "th" | "en" = "th",
): { status: number; body: ErrorBody; internal: boolean } {
  let code: ErrorCode = "INTERNAL";
  let details: Record<string, unknown> = {};
  let fields: Record<string, string> | undefined;
  let status: number | undefined;

  if (err instanceof ApiFailure) {
    code = err.code;
    details = err.details;
    fields = err.fields;
    status = err.status;
  } else if (err instanceof ZodError) {
    code = "VALIDATION";
    fields = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
  } else if (err && typeof err === "object" && "code" in err) {
    const pg = err as { code?: string; message?: string; detail?: string };
    code = codeFromDatabaseError(pg);
    details = parseDetail(pg.detail);
  }

  const human = humanizeError(code, details, shortReference(requestId));
  const httpStatus = status ?? STATUS[human.code] ?? (human.code === "INTERNAL" ? 500 : 422);
  return {
    status: httpStatus,
    internal: human.code === "INTERNAL",
    body: {
      error: {
        code: human.code,
        title: locale === "en" ? human.titleEn : human.title,
        message: locale === "en" ? human.messageEn : human.message,
        action: human.action,
        actionLabel: human.actionLabel,
        severity: human.severity,
        reference: human.reference ?? shortReference(requestId),
        ...(fields ? { fields } : {}),
        // Only safe, domain-level parameters (e.g. counts, names) — never raw errors.
        ...(Object.keys(details).length ? { details } : {}),
      },
    },
  };
}
