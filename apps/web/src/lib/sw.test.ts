import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `public/sw.js` is plain JavaScript that runs in a browser worker. Here it runs against a fake `self`, `caches` and
 * `fetch`, to check what it keeps and — as important — what it leaves alone.
 */
const SOURCE = readFileSync(join(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://shop.test";

class FakeCache {
  entries = new Map<string, Response>();
  async match(req: Request | string) {
    const key = typeof req === "string" ? req : req.url;
    return this.entries.get(key)?.clone();
  }
  async put(req: Request | string, res: Response) {
    this.entries.set(typeof req === "string" ? req : req.url, res);
  }
  async add(req: Request) {
    const res = await (globalThis as any).__net(req);
    if (!res.ok) throw new Error("bad response");
    await this.put(req, res);
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(req: Request | string) {
    return this.entries.delete(typeof req === "string" ? req : req.url);
  }
}

interface Net {
  (req: Request | { url: string }): Promise<Response>;
}

function boot(net: Net) {
  const listeners: Record<string, (e: any) => void> = {};
  const stores = new Map<string, FakeCache>();
  const caches = {
    open: async (name: string) => stores.get(name) ?? stores.set(name, new FakeCache()).get(name)!,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: any) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const requests: string[] = [];
  const fetchFn = async (req: Request | string) => {
    const url = typeof req === "string" ? new URL(req, ORIGIN).toString() : req.url;
    requests.push(url);
    return net({ url } as any);
  };
  (globalThis as any).__net = (req: Request) => fetchFn(req);
  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchFn, Request, Response, URL, Promise, setTimeout, console });

  /** Fires a fetch event; returns what the worker answered with, or `undefined` if it left the request alone. */
  const fire = async (url: string, init: { method?: string; mode?: string } = {}) => {
    let answer: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.fetch!({
      request: { url: new URL(url, ORIGIN).toString(), method: init.method ?? "GET", mode: init.mode ?? "no-cors" },
      respondWith: (p: Promise<Response>) => {
        answer = Promise.resolve(p);
        answer.catch(() => undefined); // the test decides what to do with a failure; it is not "unhandled"
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    return { answer, settle: () => Promise.allSettled([answer, ...waits]), handled: !!answer };
  };
  return { listeners, stores, self, fire, requests, caches };
}

const html = (body = "<html></html>", init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const js = (body = "console.log(1)") => new Response(body, { status: 200, headers: { "content-type": "text/javascript" } });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("service worker", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    delete (globalThis as any).__net;
  });

  it("keeps the offline page when installed, and takes over at once", async () => {
    const w = boot(async (req) => (req.url.endsWith("/offline.html") ? html("<p>ออฟไลน์</p>") : new Response("", { status: 404 })));
    const waits: Promise<unknown>[] = [];
    w.listeners.install!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(await (await w.stores.get("sabai-shell-v1")!.match(`${ORIGIN}/offline.html`))!.text()).toContain("ออฟไลน์");
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  it("on activation removes its own old caches, leaves other people's alone, and claims the open pages", async () => {
    const w = boot(offline);
    await w.caches.open("sabai-shell-v0");
    await w.caches.open("sabai-assets-v0");
    await w.caches.open("sabai-shell-v1");
    await w.caches.open("someone-elses");
    const waits: Promise<unknown>[] = [];
    w.listeners.activate!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect([...w.stores.keys()].sort()).toEqual(["sabai-shell-v1", "someone-elses"]);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  describe("what it leaves alone", () => {
    it.each([
      ["a POST (a sale, a payment)", `${ORIGIN}/pos`, { method: "POST" }],
      ["another address (the API)", "https://api.shop.test/v1/shop", {}],
      ["the API on the same address", "/v1/orders?branchId=1", {}],
      ["the live event stream", "/v1/events?branchId=1", {}],
      ["in-app page payloads", "/pos?_rsc=abc", {}],
      ["anything else", "/anything/else.json", {}],
    ])("%s", async (_label, url, init) => {
      const w = boot(async () => html());
      const r = await w.fire(url, init);
      expect(r.handled).toBe(false);
      expect(w.requests).toEqual([]);
      expect([...w.stores.keys()]).toEqual([]);
    });
  });

  describe("pages", () => {
    it("shows the fresh page when online, and keeps a copy under the path alone", async () => {
      const w = boot(async () => html("<p>v2</p>"));
      const r = await w.fire("/pos?utm=1", { mode: "navigate" });
      expect(await r.answer!.then((x) => x.text())).toBe("<p>v2</p>");
      await r.settle();
      expect(await (await w.stores.get("sabai-shell-v1")!.match(`${ORIGIN}/pos`))!.text()).toBe("<p>v2</p>");
    });

    it("opens the last copy when the line is down", async () => {
      let net: Net = async () => html("<p>ขาย</p>");
      const w = boot((r) => net(r));
      await (await w.fire("/pos", { mode: "navigate" })).settle();
      net = offline;
      const r = await w.fire("/pos", { mode: "navigate" });
      expect(await r.answer!.then((x) => x.text())).toBe("<p>ขาย</p>");
    });

    it("says so, kindly, on a page never opened before when the line is down", async () => {
      const w = boot(offline);
      await w.caches.open("sabai-shell-v1").then((c) => c.put(`${ORIGIN}/offline.html`, html("<h1>เปิดหน้านี้ตอนออฟไลน์ไม่ได้</h1>")));
      const r = await w.fire("/finance", { mode: "navigate" });
      expect(await r.answer!.then((x) => x.text())).toContain("เปิดหน้านี้ตอนออฟไลน์ไม่ได้");
    });

    it("does not let an error page or a redirect replace a good copy", async () => {
      let net: Net = async () => html("<p>ดี</p>");
      const w = boot((r) => net(r));
      await (await w.fire("/pos", { mode: "navigate" })).settle();
      net = async () => new Response("<p>พัง</p>", { status: 500, headers: { "content-type": "text/html" } });
      await (await w.fire("/pos", { mode: "navigate" })).settle();
      const redirected = html("<p>อื่น</p>");
      Object.defineProperty(redirected, "redirected", { value: true });
      net = async () => redirected;
      await (await w.fire("/pos", { mode: "navigate" })).settle();
      expect(await (await w.stores.get("sabai-shell-v1")!.match(`${ORIGIN}/pos`))!.text()).toBe("<p>ดี</p>");
    });

    it("does not wait for a hung connection when it already has the page", async () => {
      vi.useFakeTimers();
      let net: Net = async () => html("<p>เก่า</p>");
      const w = boot((r) => net(r));
      const first = await w.fire("/pos", { mode: "navigate" });
      await first.settle();
      net = () => new Promise(() => undefined); // never answers
      const pending = w.fire("/pos", { mode: "navigate" });
      await vi.advanceTimersByTimeAsync(10); // let the worker get as far as waiting
      await vi.advanceTimersByTimeAsync(3100);
      expect(await (await pending).answer!.then((x) => x.text())).toBe("<p>เก่า</p>");
    });
  });

  describe("files", () => {
    it("takes a build file from the cache once it has it, whatever deploy suffix is on the address", async () => {
      const net = vi.fn(async () => js("chunk"));
      const w = boot(net);
      expect(await (await w.fire("/_next/static/chunks/app-1a2b.js?dpl=one")).answer!.then((x) => x.text())).toBe("chunk");
      expect(net).toHaveBeenCalledTimes(1);
      expect(await (await w.fire("/_next/static/chunks/app-1a2b.js?dpl=two")).answer!.then((x) => x.text())).toBe("chunk");
      expect(net).toHaveBeenCalledTimes(1); // the hashed name is the version: no second download
    });

    it("keeps working offline for files it has seen, and fails for ones it has not", async () => {
      let net: Net = async () => js("chunk");
      const w = boot((r) => net(r));
      await (await w.fire("/_next/static/chunks/seen.js")).settle();
      net = offline;
      expect(await (await w.fire("/_next/static/chunks/seen.js")).answer!.then((x) => x.text())).toBe("chunk");
      await expect((await w.fire("/_next/static/chunks/unseen.js")).answer).rejects.toThrow();
    });

    it("shows a logo at once and checks for a new one in the background", async () => {
      let version = "old";
      const w = boot(async () => new Response(version, { status: 200, headers: { "content-type": "image/png" } }));
      expect(await (await w.fire("/brand/paakin-icon.png")).answer!.then((x) => x.text())).toBe("old");
      version = "new";
      const second = await w.fire("/brand/paakin-icon.png");
      expect(await second.answer!.then((x) => x.text())).toBe("old");
      await second.settle();
      expect(await (await w.fire("/brand/paakin-icon.png")).answer!.then((x) => x.text())).toBe("new");
    });

    it("keeps optimised images by their full address, since the size is in the query", async () => {
      const w = boot(async (r) => new Response(new URL(r.url).searchParams.get("w"), { status: 200 }));
      expect(await (await w.fire("/_next/image?url=%2Fbrand%2Fx.png&w=64&q=75")).answer!.then((x) => x.text())).toBe("64");
      expect(await (await w.fire("/_next/image?url=%2Fbrand%2Fx.png&w=128&q=75")).answer!.then((x) => x.text())).toBe("128");
    });

    it("does not keep a failed download", async () => {
      const w = boot(async () => new Response("nope", { status: 404 }));
      await w.fire("/_next/static/chunks/missing.js");
      expect((await w.stores.get("sabai-assets-v1")!.keys()).length).toBe(0);
    });

    it("drops the oldest files past the limit", async () => {
      const w = boot(async () => js());
      for (let i = 0; i < 503; i++) await (await w.fire(`/_next/static/chunks/f${i}.js`)).settle();
      const keys = (await w.stores.get("sabai-assets-v1")!.keys()).map((k) => new URL(k.url).pathname);
      expect(keys.length).toBe(500);
      expect(keys).not.toContain("/_next/static/chunks/f0.js");
      expect(keys).toContain("/_next/static/chunks/f502.js");
    });
  });

  describe("warming the main screens", () => {
    const pages: Record<string, string> = {
      "/pos": '<script src="/_next/static/chunks/pos-aaa.js?dpl=x"></script><link href="/_next/static/css/app-bbb.css"><script>self.__next_f.push([1,"/_next/static/chunks/lazy-ccc.js"])</script>',
      "/kds": '<script src="/_next/static/chunks/kds-ddd.js"></script><script src="/_next/static/chunks/pos-aaa.js"></script>',
    };

    it("keeps each page and every build file it names, once", async () => {
      const w = boot(async (r) => {
        const path = new URL(r.url).pathname;
        if (pages[path]) return html(pages[path]);
        if (path.startsWith("/_next/static/")) return js(path);
        return new Response("", { status: 404 });
      });
      const waits: Promise<unknown>[] = [];
      w.listeners.message!({ data: { type: "warm", routes: ["/pos", "/kds", "/missing"] }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);

      const shell = w.stores.get("sabai-shell-v1")!;
      expect(await shell.match(`${ORIGIN}/pos`)).toBeTruthy();
      expect(await shell.match(`${ORIGIN}/kds`)).toBeTruthy();
      expect(await shell.match(`${ORIGIN}/missing`)).toBeUndefined();
      const kept = (await w.stores.get("sabai-assets-v1")!.keys()).map((k) => new URL(k.url).pathname).sort();
      expect(kept).toEqual(["/_next/static/chunks/kds-ddd.js", "/_next/static/chunks/lazy-ccc.js", "/_next/static/chunks/pos-aaa.js", "/_next/static/css/app-bbb.css"]);
      // pos-aaa.js is named by both pages and downloaded once.
      expect(w.requests.filter((u) => u.includes("pos-aaa.js")).length).toBe(1);
    });

    it("does nothing harmful with no line, and keeps what it already had", async () => {
      let net: Net = async () => html(pages["/pos"]!);
      const w = boot((r) => (new URL(r.url).pathname.startsWith("/_next/") ? Promise.resolve(js()) : net(r)));
      const ask = async () => {
        const waits: Promise<unknown>[] = [];
        w.listeners.message!({ data: { type: "warm", routes: ["/pos"] }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
        await Promise.all(waits);
      };
      await ask();
      net = offline;
      await expect(ask()).resolves.toBeUndefined();
      expect(await w.stores.get("sabai-shell-v1")!.match(`${ORIGIN}/pos`)).toBeTruthy();
    });

    it("ignores messages it does not know, and routes on other addresses", async () => {
      const w = boot(async () => html());
      const waits: Promise<unknown>[] = [];
      w.listeners.message!({ data: { type: "something-else" }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      w.listeners.message!({ data: { type: "warm", routes: ["https://evil.test/x"] }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
      expect(w.requests).toEqual([]);
    });
  });
});
