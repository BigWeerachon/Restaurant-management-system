import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, clearApiSession, setApiSession } from "./http-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("apiFetch", () => {
  beforeEach(() => {
    clearApiSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed body on success and attaches the token, tenant, and an idempotency key", async () => {
    setApiSession({ token: "tok-123", tenantId: "tenant-1" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/v1/orders", { method: "POST", body: { id: "o1" } });
    expect(result).toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["X-Tenant-Id"]).toBe("tenant-1");
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("turns a JSON error envelope into a DomainError with the same code, and never retries it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: "PERMISSION_DENIED", reference: "AAAA-1111" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/v1/reports/summary")).rejects.toMatchObject({ name: "DomainError", code: "PERMISSION_DENIED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to INTERNAL for a code the catalog doesn't know", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: "SOMETHING_A_PROXY_MADE_UP" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/v1/orders")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("retries a request that never reached the server, then gives up as NETWORK_OFFLINE", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/v1/orders", { timeoutMs: 50 })).rejects.toMatchObject({ code: "NETWORK_OFFLINE" });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("succeeds on a later attempt after a transient network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/v1/orders");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
