/*
 * Service worker (checklist 5.3): lets the till open when the line is down.
 *
 * It keeps two things and nothing else:
 *   - the app's pages (HTML) — network first, so a deploy shows up straight away, with the last copy as the fallback;
 *   - the files those pages need (scripts, styles, fonts, the logo) — cache first, since their names carry a hash.
 *
 * It never touches the API, a POST, or anything that belongs to a signed-in person: shop data lives in the app's
 * own local storage, and sales made offline wait in its IndexedDB queue (`offline-queue.ts`). A cached response
 * of `/v1/...` could show one person another's data on a shared till, so those calls are simply not handled here.
 *
 * Plain JavaScript with no build step: it must run as it is. `src/lib/sw.test.ts` runs this file against a fake
 * `self` / `caches` and checks what it handles and what it leaves alone.
 */
const VERSION = "v1";
const SHELL = `sabai-shell-${VERSION}`;
const ASSETS = `sabai-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
/** A slow line is as bad as none for someone standing at the till: past this, a page we already have is shown instead. */
const PAGE_WAIT_MS = 3000;
/** Old files pile up over deploys; past this many, the oldest go. */
const MAX_ASSETS = 500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.add(new Request(new URL(OFFLINE_URL, self.location.origin).href, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("sabai-") && key !== SHELL && key !== ASSETS) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** Pages are stored by path alone: `/pos?x=1` and `/pos` are the same screen. */
const pageKey = (url) => new Request(url.origin + url.pathname);

/** Hashed build files are stored by path (a `?dpl=` suffix changes per deploy, the file does not); optimised images vary by query. */
function assetKey(url) {
  return new Request(url.pathname === "/_next/image" ? url.origin + url.pathname + url.search : url.origin + url.pathname);
}

function isAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/_next/image" ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/icon.png" ||
    url.pathname === "/manifest.webmanifest"
  );
}

const isHtml = (res) => (res.headers.get("content-type") || "").includes("text/html");
const isImmutable = (url) => url.pathname.startsWith("/_next/static/");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // The API and anything else on another address is not ours to keep.
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") return void event.respondWith(page(event, request, url));
  if (isAsset(url)) return void event.respondWith(asset(event, request, url));
  // Everything else (live data, page payloads for in-app navigation, ...) goes straight to the network.
});

async function page(event, request, url) {
  const shell = await caches.open(SHELL);
  const key = pageKey(url);
  const cached = await shell.match(key, { ignoreVary: true });
  const fresh = fetch(request).then(async (res) => {
    // A redirect or an error page must not replace a good copy.
    if (res.ok && !res.redirected && isHtml(res)) await shell.put(key, res.clone());
    return res;
  });
  if (!cached) {
    try {
      return await fresh;
    } catch {
      return (await shell.match(new Request(new URL(OFFLINE_URL, self.location.origin).href), { ignoreVary: true })) || new Response("ออฟไลน์ — เปิดหน้านี้ไม่ได้", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
  // We have a copy: use the fresh page if it comes quickly, otherwise the copy — and let the fetch finish, so the next visit is fresh.
  event.waitUntil(fresh.catch(() => undefined));
  return Promise.race([fresh.catch(() => cached), sleep(PAGE_WAIT_MS).then(() => cached)]);
}

async function asset(event, request, url) {
  const cache = await caches.open(ASSETS);
  const key = assetKey(url);
  const hit = await cache.match(key);
  const load = async () => {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(key, res.clone());
      await trim(cache);
    }
    return res;
  };
  if (hit) {
    // A logo can change under the same name; a hashed file cannot.
    if (!isImmutable(url)) event.waitUntil(load().catch(() => undefined));
    return hit;
  }
  return load();
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

// The app asks, after it has loaded online, for the main screens to be kept: their pages and every file they name.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "warm" && Array.isArray(data.routes)) event.waitUntil(warm(data.routes));
});

async function warm(routes) {
  const shell = await caches.open(SHELL);
  const assets = await caches.open(ASSETS);
  const wanted = new Set();
  for (const route of routes) {
    try {
      const url = new URL(route, self.location.origin);
      if (url.origin !== self.location.origin) continue;
      const res = await fetch(url.pathname);
      if (!res.ok || res.redirected || !isHtml(res)) continue;
      const html = await res.clone().text();
      await shell.put(pageKey(url), res);
      for (const m of html.matchAll(/\/_next\/static\/[\w\-./%]+\.(?:js|css|woff2?|png|svg|webp)/g)) wanted.add(m[0]);
    } catch {
      // No line right now: what is already kept stays.
    }
  }
  for (const path of wanted) {
    const url = new URL(path, self.location.origin);
    const key = assetKey(url);
    if (await assets.match(key)) continue;
    try {
      const res = await fetch(path);
      if (res.ok) await assets.put(key, res);
    } catch {
      // Try again at the next visit.
    }
  }
  await trim(assets);
}
