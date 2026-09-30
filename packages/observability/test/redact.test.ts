import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactFields, redactText, REDACTED, scrubUrl } from "../src/redact";

describe("what never leaves the system", () => {
  it("knows a secret's name when it sees one, and leaves ordinary names alone", () => {
    for (const k of ["authorization", "Authorization", "cookie", "x-device-token", "accessToken", "refresh_token", "pin", "pinHash", "pin_hash", "password", "promptpay_secret", "apiKey", "x-sabai-signature", "dsn", "tokenHash"]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
    for (const k of ["shipping", "mapping", "pinned", "tenantId", "requestId", "orderId", "total", "planCode", "name", "path", "status"]) {
      expect(isSensitiveKey(k), k).toBe(false);
    }
  });

  it("drops the value under a sensitive key, at any depth, and masks text that looks like a secret", () => {
    const out = redactFields({
      requestId: "abc",
      headers: { authorization: "Bearer abc.def.ghi", "x-device-token": "sbd_abcdefghijklmnopqrstuvwxyz", accept: "application/json" },
      body: { pin: "1234", items: [{ name: "ลาเต้", note: "โทร 0891234567 หรือ a@b.com" }] },
    }) as any;
    expect(out.requestId).toBe("abc");
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers["x-device-token"]).toBe(REDACTED);
    expect(out.headers.accept).toBe("application/json");
    expect(out.body.pin).toBe(REDACTED);
    expect(out.body.items[0].name).toBe("ลาเต้");
    expect(out.body.items[0].note).toBe("โทร [number] หรือ [email]");
  });

  it("masks bearer tokens, JWTs, device secrets, emails and long numbers in free text", () => {
    expect(redactText("failed for Bearer abc.DEF-123_x on a@b.co with eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM and sbd_abcdefghijklmnopqrstu, tax 1101700230708")).toBe(
      "failed for Bearer [redacted] on [email] with [jwt] and [device-token], tax [number]",
    );
    expect(redactText("ok 12345678")).toBe("ok 12345678");
    expect(redactText("x".repeat(600)).length).toBe(501);
  });

  it("stops at a sensible depth and size, and copes with what is not JSON", () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 10; i++) cur = cur.n = {};
    expect(JSON.stringify(redactFields(deep))).toContain("[truncated]");
    expect(redactFields(Array.from({ length: 100 }, (_, i) => i))).toHaveLength(20);
    expect(redactFields(10n)).toBe("10");
    expect(redactFields(new Error("boom for a@b.com"))).toEqual({ name: "Error", message: "boom for [email]" });
    expect(redactFields(undefined)).toBeUndefined();
  });

  it("removes the query string, the fragment and credentials from a URL", () => {
    expect(scrubUrl("https://app.example.com/settings?tab=plan&token=abc#x")).toBe("https://app.example.com/settings");
    expect(scrubUrl("https://user:pw@app.example.com/a/b?c=1")).toBe("https://app.example.com/a/b");
    expect(scrubUrl("/relative/path?token=abc")).toBe("/relative/path");
  });
});
