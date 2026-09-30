"use client";

import { useEffect } from "react";

/** The screens worth having ready when the line is down. Each is fetched once per visit, after the app has finished loading. */
const WARM_ROUTES = ["/", "/pos", "/kds", "/today", "/orders", "/inventory", "/menu", "/purchasing", "/finance", "/reports", "/team", "/settings", "/setup"];

/**
 * Production only (a service worker in `next dev` would serve stale code): installs the service worker and asks it
 * to keep the main screens, so the till still opens after a reload with no internet.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const start = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const ready = await navigator.serviceWorker.ready;
        if (cancelled) return;
        ready.active?.postMessage({ type: "warm", routes: WARM_ROUTES });
      } catch (e) {
        // A browser that refuses (private window, blocked) just loses the offline start; everything else works.
        console.warn("service worker not available", e);
      }
    };
    // Wait until the page is done, so the worker's downloads never compete with the first paint.
    if (document.readyState === "complete") void start();
    else window.addEventListener("load", () => void start(), { once: true });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
