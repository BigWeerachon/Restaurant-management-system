export const IS_API = process.env.E2E_MODE === "api";
export const MODE = IS_API ? "api" : "demo";
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8787);
export const API_URL = `http://localhost:${API_PORT}`;
export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sabai_dev";

/** What the API is started with: the billing spec runs on `BILLING_PROVIDER=manual` and signs its payments with the same secret. */
export const BILLING_WEBHOOK_SECRET = "e2e-billing-webhook-secret-32-chars-long!!";
export const BILLING_JOB_SECRET = "e2e-billing-job-secret-at-least-32-chars!!!";
export const API_ENV = {
  BILLING_PROVIDER: "manual",
  BILLING_WEBHOOK_SECRET,
  BILLING_JOB_SECRET,
  BILLING_PROMPTPAY_ID: "0105536001239",
  BILLING_BANK_NAME: "ธนาคารตัวอย่าง",
  BILLING_BANK_ACCOUNT_NO: "123-4-56789-0",
  BILLING_BANK_ACCOUNT_NAME: "บริษัท สบาย จำกัด",
  // The spec calls the job itself, at moments it chooses.
  BILLING_JOB_INTERVAL_MINUTES: "0",
  // The suite signs in with a PIN dozens of times a minute; the real limit (10) is what keeps PINs from being guessed.
  PIN_ATTEMPTS_PER_MINUTE: "1000",
};
