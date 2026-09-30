export interface BillingConfig {
  /**
   * "none": no online billing yet — choosing a plan applies it at once (how the app has worked until now).
   * "manual": choosing a paid plan issues an invoice; the shop pays by PromptPay or bank transfer and the payment is
   * confirmed through the signed webhook. Real card providers (Omise, Stripe) come with 8.2, when there are keys.
   */
  provider: "none" | "manual";
  /** Signs what a provider (or the person confirming a transfer) sends to /v1/billing/webhook/{provider}. */
  webhookSecret: string;
  /** Where a "manual" invoice is paid: shown to the shop with the invoice number as the reference. */
  payTo: { promptpayId: string | null; bankName: string | null; accountNo: string | null; accountName: string | null };
  /** Minutes between runs of the nightly job inside this process. 0 = not here (a scheduler calls /v1/billing/run). */
  jobIntervalMinutes: number;
  /** Lets an outside scheduler call /v1/billing/run. Unset = that route does not exist. */
  jobSecret: string | null;
}

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  /** Lifetime of a PIN-switched staff token on a shared device. */
  staffTokenTtlSeconds: number;
  billing: BillingConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV ?? "development") as Config["env"];
  const jwtSecret = env.JWT_SECRET ?? (mode === "production" ? "" : "dev-only-secret-change-me-32-characters!!");
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  const databaseUrl = env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sabai_dev";
  const provider = (env.BILLING_PROVIDER ?? "none").toLowerCase();
  if (provider !== "none" && provider !== "manual") {
    throw new Error(`BILLING_PROVIDER must be "none" or "manual" (got "${provider}"); card providers come with checklist item 8.2`);
  }
  const webhookSecret = env.BILLING_WEBHOOK_SECRET ?? "";
  const payTo = {
    promptpayId: env.BILLING_PROMPTPAY_ID?.trim() || null,
    bankName: env.BILLING_BANK_NAME?.trim() || null,
    accountNo: env.BILLING_BANK_ACCOUNT_NO?.trim() || null,
    accountName: env.BILLING_BANK_ACCOUNT_NAME?.trim() || null,
  };
  if (provider === "manual") {
    if (webhookSecret.length < 32) throw new Error("BILLING_WEBHOOK_SECRET must be at least 32 characters when BILLING_PROVIDER=manual");
    if (!payTo.promptpayId && !payTo.accountNo) throw new Error("BILLING_PROVIDER=manual needs BILLING_PROMPTPAY_ID or BILLING_BANK_ACCOUNT_NO: the shop has to know where to pay");
  }
  return {
    env: mode,
    port: Number(env.PORT ?? 8787),
    databaseUrl,
    jwtSecret,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
    staffTokenTtlSeconds: Number(env.STAFF_TOKEN_TTL ?? 12 * 3600),
    billing: {
      provider,
      webhookSecret,
      payTo,
      jobIntervalMinutes: Number(env.BILLING_JOB_INTERVAL_MINUTES ?? (mode === "test" ? 0 : 60)),
      jobSecret: env.BILLING_JOB_SECRET && env.BILLING_JOB_SECRET.length >= 32 ? env.BILLING_JOB_SECRET : null,
    },
  };
}
