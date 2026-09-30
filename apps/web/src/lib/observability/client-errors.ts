/**
 * Unexpected errors in the browser, reported to a Sentry-compatible tracker when `NEXT_PUBLIC_ERROR_TRACKING_DSN` is set
 * (and to nobody when it is not — the default, and what the public demo runs with). What is sent is the kind of error,
 * where in the code, and the page's path with ids masked: never the address bar's query, never what was typed, never a name.
 * The errors the app itself raises for a person to read (a plan limit, a wrong PIN) are not faults and are never sent.
 */
import { createErrorReporter, type ErrorReporter } from "@sabai/observability";
import { dataSourceMode } from "../data-source/config";
import { isDomainError } from "../demo/store";

const NOISE = /ResizeObserver loop|Failed to fetch|NetworkError|Load failed|network request failed|The operation was aborted|The user aborted/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Errors that are part of normal use: the app's own messages, a dropped connection, a cancelled request, a printer that is not there. */
export function isExpectedError(err: unknown): boolean {
  if (isDomainError(err)) return true;
  if (err instanceof Error && (err.name === "PrinterError" || err.name === "AbortError")) return true;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return NOISE.test(message);
}

/** `/menu/0190…` → `/menu/:id`: the same page is the same page whichever dish it is about. */
export const maskIds = (path: string): string => path.replace(UUID, ":id");

let shared: ErrorReporter | null = null;

export function clientReporter(): ErrorReporter {
  shared ??= createErrorReporter({
    dsn: process.env.NEXT_PUBLIC_ERROR_TRACKING_DSN,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    service: `sabai-web-${dataSourceMode()}`,
    release: process.env.NEXT_PUBLIC_RELEASE ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
    platform: "javascript",
  });
  return shared;
}

export type ErrorSource = "boundary" | "window" | "promise";

export function reportClientError(err: unknown, source: ErrorSource, opts: { digest?: string; reporter?: ErrorReporter; where?: { origin: string; pathname: string } } = {}): void {
  if (isExpectedError(err)) return;
  const where = opts.where ?? (typeof location !== "undefined" ? { origin: location.origin, pathname: location.pathname } : null);
  const path = where ? maskIds(where.pathname) : undefined;
  (opts.reporter ?? clientReporter()).capture(err, {
    code: `CLIENT_${source.toUpperCase()}`,
    ...(path ? { route: path, url: `${where!.origin}${path}` } : {}),
    extra: { source, ...(opts.digest ? { digest: opts.digest } : {}) },
  });
}

/** Catches what nothing else did. Returns the undo. */
export function installGlobalErrorHandlers(target: Pick<Window, "addEventListener" | "removeEventListener"> = window, reporter?: ErrorReporter): () => void {
  const onError = (e: Event) => reportClientError((e as ErrorEvent).error ?? (e as ErrorEvent).message, "window", { reporter });
  const onRejection = (e: Event) => reportClientError((e as PromiseRejectionEvent).reason, "promise", { reporter });
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
