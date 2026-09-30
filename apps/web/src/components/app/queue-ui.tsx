"use client";

import { CloudUpload, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useOfflineQueue } from "@/lib/data-source/offline";
import { cn } from "@/lib/cn";
import { OfflineQueueDialog } from "./offline-queue-dialog";

/**
 * The offline queue as the header and the selling screens show it. Kept apart from `connection-badge.tsx` (which every
 * screen carries) because it needs the queue's storage and the HTTP client, and only an API-mode till has a queue at all;
 * `connection-badge.tsx` fetches this file only in API mode.
 */

/** Sales kept on this device because the line was down: how many are waiting, and whether any was refused. Opens the list. */
export function QueueChip({ compact }: { compact: boolean }) {
  const { pending, failed } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  if (pending + failed === 0) return null;
  const bad = failed > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
          // Phone headers are full: there the same information sits in a strip under the header (`QueueBanner`).
          compact && "max-sm:hidden",
          bad ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
        )}
      >
        {bad ? <TriangleAlert className="h-4 w-4" aria-hidden="true" /> : <CloudUpload className="h-4 w-4" aria-hidden="true" />}
        <span>{bad ? `ส่งไม่สำเร็จ ${failed}` : `รอส่ง ${pending}`}</span>
      </button>
      <OfflineQueueDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Phone version of the queue chip: a strip under the header (the header itself has no room left), on the screens that
 * sell. Shows whenever something is waiting or was refused, online or not; opens the same list.
 */
export function QueueStrip({ className }: { className?: string }) {
  const { pending, failed } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  if (pending + failed === 0) return null;
  const bad = failed > 0;
  return (
    <>
      <div className={cn("flex items-center gap-2 rounded-xl py-0.5 pl-4 pr-1 text-sm font-medium sm:hidden", bad ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning", className)}>
        {bad ? <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" /> : <CloudUpload className="h-5 w-5 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{bad ? `ส่งไม่สำเร็จ ${failed} รายการ` : `รอส่งเข้าระบบ ${pending} รายการ`}</span>
        <button type="button" onClick={() => setOpen(true)} className="h-11 shrink-0 rounded-full px-3 font-semibold underline underline-offset-2">
          ดูรายการ
        </button>
      </div>
      <OfflineQueueDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
