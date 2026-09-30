import { createErrorReporter } from "@sabai/observability";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../demo/engine";
import { installGlobalErrorHandlers, isExpectedError, maskIds, reportClientError } from "./client-errors";

const DSN = "https://pub@errors.example.com/9";
const setup = () => {
  const fetch = vi.fn(async () => new Response("ok"));
  const reporter = createErrorReporter({ dsn: DSN, environment: "test", service: "sabai-web-demo", platform: "javascript", fetch: fetch as never });
  return { fetch, reporter };
};
const sentEvent = (fetch: ReturnType<typeof vi.fn>, n = 0) => JSON.parse(String((fetch.mock.calls[n]![1] as RequestInit).body).split("\n")[2]!);

describe("what the browser reports", () => {
  it("does not report the app's own messages, a dropped connection, a cancelled request or a missing printer", () => {
    const printer = Object.assign(new Error("เครื่องพิมพ์ไม่ตอบสนอง"), { name: "PrinterError" });
    for (const e of [new DomainError("PLAN_LIMIT_REACHED"), new DomainError("PIN_INVALID"), new TypeError("Failed to fetch"), new TypeError("Load failed"), new Error("NetworkError when attempting to fetch resource"), new DOMException("x", "AbortError"), printer, "ResizeObserver loop completed with undelivered notifications."]) {
      expect(isExpectedError(e), String(e)).toBe(true);
    }
    for (const e of [new TypeError("Cannot read properties of undefined (reading 'name')"), new RangeError("x"), "something else"]) expect(isExpectedError(e), String(e)).toBe(false);
  });

  it("reports the rest with the kind of error and the page — with ids masked and no query string", async () => {
    const { fetch, reporter } = setup();
    reportClientError(new TypeError("Cannot read properties of undefined (reading 'name')"), "boundary", { reporter, digest: "d123", where: { origin: "https://app.example.com", pathname: "/menu/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" } });
    await reporter.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const ev = sentEvent(fetch);
    expect(ev.platform).toBe("javascript");
    expect(ev.tags).toMatchObject({ service: "sabai-web-demo", code: "CLIENT_BOUNDARY", route: "/menu/:id" });
    expect(ev.request).toEqual({ url: "https://app.example.com/menu/:id" });
    expect(ev.extra).toEqual({ source: "boundary", digest: "d123" });
    expect(ev.exception.values[0].type).toBe("TypeError");
    expect(JSON.stringify(ev)).not.toContain("0190a1b2");
  });

  it("catches an error and an unhandled rejection anywhere on the page, and stops when told", async () => {
    const { fetch, reporter } = setup();
    const handlers = new Map<string, (e: Event) => void>();
    const target = { addEventListener: (t: string, h: (e: Event) => void) => void handlers.set(t, h), removeEventListener: (t: string) => void handlers.delete(t) };
    const off = installGlobalErrorHandlers(target as never, reporter);
    handlers.get("error")!({ error: new RangeError("boom in a handler") } as unknown as Event);
    handlers.get("unhandledrejection")!({ reason: new Error("a promise nobody caught") } as unknown as Event);
    handlers.get("unhandledrejection")!({ reason: new DomainError("VALIDATION") } as unknown as Event);
    await reporter.flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sentEvent(fetch, 0).tags.code).toBe("CLIENT_WINDOW");
    expect(sentEvent(fetch, 1).tags.code).toBe("CLIENT_PROMISE");
    off();
    expect(handlers.size).toBe(0);
  });

  it("masks ids in a path", () => {
    expect(maskIds("/orders/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/pay")).toBe("/orders/:id/pay");
    expect(maskIds("/settings")).toBe("/settings");
  });

  it("reports nothing at all without a DSN", async () => {
    const fetch = vi.fn();
    const off = createErrorReporter({ dsn: undefined, environment: "test", service: "x", fetch: fetch as never });
    reportClientError(new TypeError("x"), "window", { reporter: off, where: { origin: "https://a", pathname: "/" } });
    await off.flush();
    expect(fetch).not.toHaveBeenCalled();
  });
});
