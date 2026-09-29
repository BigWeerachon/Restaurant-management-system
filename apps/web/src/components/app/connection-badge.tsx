"use client";

import { CloudCheck, CloudUpload, RefreshCcw, TriangleAlert, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { dataSourceMode } from "@/lib/data-source/config";
import { useOfflineQueue } from "@/lib/data-source/offline";
import { useRealtimeStatus } from "@/lib/data-source/realtime";
import { cn } from "@/lib/cn";
import { OfflineQueueDialog } from "./offline-queue-dialog";

/** Sales kept on this device because the line was down: how many are waiting, and whether any was refused. Opens the list. */
function QueueChip({ compact }: { compact: boolean }) {
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
 * Whether this screen is up to date. Status is never colour alone: an icon and words go with it.
 * Demo mode keeps everything on this device, so it says that instead.
 */
export function ConnectionBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const api = dataSourceMode() === "api";
  if (!api) return <ConnectionStatus compact={compact} className={className} />;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <QueueChip compact={compact} />
      <ConnectionStatus compact={compact} className={className} />
    </span>
  );
}

function ConnectionStatus({ compact, className }: { compact: boolean; className?: string }) {
  const status = useRealtimeStatus();
  const api = dataSourceMode() === "api";

  if (!api) {
    return (
      <span className={cn("flex items-center gap-1.5 text-xs text-ink-3", className)} title="ข้อมูลบันทึกในเครื่องนี้อัตโนมัติ">
        <CloudCheck className="h-4 w-4 text-success" aria-hidden="true" />
        <span className={compact ? "sr-only" : undefined}>บันทึกอัตโนมัติ</span>
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span role="status" className={cn("flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning", className)} title="ต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่ให้เอง">
        <WifiOff className="h-4 w-4" aria-hidden="true" />
        <span className={compact ? "sr-only" : undefined}>ออฟไลน์ กำลังต่อใหม่</span>
      </span>
    );
  }
  if (status === "live") {
    return (
      <span role="status" className={cn("flex items-center gap-1.5 text-xs text-ink-3", className)} title="ข้อมูลอัปเดตทันทีที่มีการเปลี่ยนแปลง">
        <CloudCheck className="h-4 w-4 text-success" aria-hidden="true" />
        <span className={compact ? "sr-only" : undefined}>อัปเดตสด</span>
      </span>
    );
  }
  return (
    <span role="status" className={cn("flex items-center gap-1.5 text-xs text-ink-3", className)}>
      <RefreshCcw className="h-4 w-4" aria-hidden="true" />
      <span className={compact ? "sr-only" : undefined}>กำลังเชื่อมต่อ</span>
    </span>
  );
}

/**
 * A bar across the top of a screen that must not be trusted blindly (the kitchen, the till) while the line is down.
 * Says what it means for that screen; nothing at all while everything is fine, and nothing in demo mode.
 */
export function ConnectionBanner({ children, className }: { children?: ReactNode; className?: string }) {
  const status = useRealtimeStatus();
  if (dataSourceMode() !== "api" || status !== "offline") return null;
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-warning-soft px-4 py-2.5 text-sm font-medium text-warning", className)}>
      <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="shrink-0">ออฟไลน์ กำลังต่อใหม่ให้เอง</span>
      {children && <span className="min-w-0 basis-full font-normal text-ink-2 sm:basis-auto sm:before:mr-2 sm:before:content-['—']">{children}</span>}
    </div>
  );
}

/**
 * Phone version of the queue chip: a strip under the header (the header itself has no room left), on the screens that
 * sell. Shows whenever something is waiting or was refused, online or not; opens the same list.
 */
export function QueueBanner({ className }: { className?: string }) {
  const { pending, failed } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  if (dataSourceMode() !== "api" || pending + failed === 0) return null;
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
