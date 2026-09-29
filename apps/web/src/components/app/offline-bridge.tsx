"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { dataSourceMode } from "@/lib/data-source/config";
import { refresh } from "@/lib/data-source/http-context";
import { offlineQueue, onQueueSettled, useOfflineQueue } from "@/lib/data-source/offline";
import { useRealtimeStatus } from "@/lib/data-source/realtime";
import { useSabai } from "@/lib/demo/store";

/** How often to try again while something is waiting and the line is not known to be back. */
const RETRY_MS = 20_000;

/** Sends what is waiting and says what happened: good news in a toast, and a warning if a command was refused for good. */
export async function drainAndAnnounce(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const queue = offlineQueue();
  const failedBefore = queue.snapshot().failed;
  const { sent } = await queue.drain();
  if (sent > 0) toast.success("ส่งข้อมูลที่ค้างเข้าระบบแล้ว", { description: `${sent} รายการ ตัดสต็อกและขึ้นจอครัวเรียบร้อย` });
  if (queue.snapshot().failed > failedBefore) {
    toast.error("มีรายการที่ระบบรับไม่ได้", { description: "แตะป้าย “ส่งไม่สำเร็จ” มุมบนของจอเพื่อดูรายละเอียดและเลือกว่าจะทำอย่างไรต่อ" });
  }
}

/**
 * API mode only: replays what the till kept while the line was down (checklist 5.2). It reads the saved commands
 * when someone signs in, and tries to send them when the browser says it is online again, when the live line comes
 * back, and every so often while any are waiting. Nothing to see here; `ConnectionBadge` shows the queue.
 */
export function OfflineBridge() {
  const hydrated = useSabai((s) => s.hydrated);
  const memberId = useSabai((s) => s.session.memberId);
  const status = useRealtimeStatus();
  const { pending } = useOfflineQueue();
  const active = dataSourceMode() === "api" && hydrated && !!memberId;

  // The queue changed the server: read again what a sale touches.
  useEffect(() => {
    if (!active) return;
    return onQueueSettled(() => void refresh(["orders", "tickets", "shifts", "stock"]));
  }, [active]);

  // Signing in (or coming back to the page): pick up what an earlier visit left behind, and send it.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const queue = offlineQueue();
    queue
      .ensureLoaded()
      .then(() => {
        queue.refreshView();
        if (!cancelled) return drainAndAnnounce();
      })
      .catch((e) => console.warn("offline queue could not start", e));
    const onOnline = () => void drainAndAnnounce().catch((e) => console.warn("offline queue drain failed", e));
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [active, memberId]);

  // The live line came back: a good moment, since the server is clearly reachable.
  useEffect(() => {
    if (active && status === "live") void drainAndAnnounce().catch((e) => console.warn("offline queue drain failed", e));
  }, [active, status]);

  // Still waiting: try again now and then, in case neither of the above fired.
  useEffect(() => {
    if (!active || pending === 0) return;
    const id = setInterval(() => void drainAndAnnounce().catch((e) => console.warn("offline queue drain failed", e)), RETRY_MS);
    return () => clearInterval(id);
  }, [active, pending]);

  return null;
}
