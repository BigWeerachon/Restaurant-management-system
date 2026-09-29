"use client";

import { humanizeError } from "@sabai/domain";
import { CircleAlert, Clock, RefreshCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { offlineQueue, useOfflineQueue } from "@/lib/data-source/offline";
import type { QueuedCommand } from "@/lib/data-source/offline-queue";
import { drainAndAnnounce } from "./offline-bridge";

const time = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

/**
 * What the till is holding because the line was down: what is still waiting to be sent, and anything the server
 * refused — with the choice to try again or to let it go.
 */
export function OfflineQueueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { items, pending, failed } = useOfflineQueue();
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const failedOrders = new Set(items.filter((c) => c.state === "failed").map((c) => c.orderId));

  const sendNow = async () => {
    setSending(true);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) toast.info("ยังไม่มีอินเทอร์เน็ต", { description: "ระบบจะส่งให้เองเมื่อกลับมาออนไลน์" });
      else await drainAndAnnounce();
    } finally {
      setSending(false);
    }
  };
  const retry = async (c: QueuedCommand) => {
    setSending(true);
    try {
      await offlineQueue().retry(c.id);
    } finally {
      setSending(false);
    }
  };
  const discard = async (c: QueuedCommand) => {
    await offlineQueue().discard(c.id);
    setConfirming(null);
    toast.success("ลบรายการที่ส่งไม่สำเร็จแล้ว");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="รายการที่รอส่งเข้าระบบ"
      description="เก็บไว้ในเครื่องนี้ตอนอินเทอร์เน็ตหลุด และจะส่งตามลำดับที่ขาย"
      size="lg"
      footer={
        pending > 0 ? (
          <Button loading={sending} icon={<RefreshCcw className="h-4 w-4" />} onClick={sendNow}>
            ส่งตอนนี้
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-3">ไม่มีรายการค้างส่ง ทุกอย่างเข้าระบบแล้ว</p>
      ) : (
        <ul className="space-y-2 pb-2">
          {items.map((c) => {
            const held = c.state === "pending" && failedOrders.has(c.orderId);
            const why = c.state === "failed" ? humanizeError(c.errorCode, c.errorParams) : null;
            return (
              <li key={c.id} className={c.state === "failed" ? "rounded-2xl bg-danger-soft p-4" : "rounded-2xl bg-surface-2 p-4"}>
                <div className="flex items-start gap-3">
                  {c.state === "failed" ? <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" /> : <Clock className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {c.summary} <span className="font-normal text-ink-3">· {time(c.createdAt)}</span>
                    </p>
                    {why ? (
                      <>
                        <p className="mt-1 text-sm font-medium text-danger">ส่งไม่สำเร็จ: {why.title}</p>
                        <p className="text-sm text-ink-2">{why.message}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-warning">{held ? "รอ · ต้องจัดการรายการก่อนหน้าของบิลนี้ก่อน" : "รอส่งเข้าระบบ"}</p>
                    )}
                    {c.state === "failed" &&
                      (confirming === c.id ? (
                        <div className="mt-3 rounded-xl bg-surface p-3 text-sm">
                          <p className="text-ink">
                            {c.kind === "payOrder"
                              ? "ลูกค้าจ่ายเงินไปแล้ว ถ้าลบ ยอดนี้จะไม่เข้าระบบ ตรวจกับลูกค้าหรือยอดเงินสดในลิ้นชักก่อนนะ"
                              : "ถ้าลบ ออเดอร์นี้จะไม่ขึ้นจอครัวและไม่ถูกบันทึก"}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => discard(c)}>
                              ยืนยัน ลบรายการนี้
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                              ยกเลิก
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" loading={sending} icon={<RefreshCcw className="h-4 w-4" />} onClick={() => retry(c)}>
                            ลองส่งอีกครั้ง
                          </Button>
                          <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirming(c.id)}>
                            ลบรายการนี้
                          </Button>
                        </div>
                      ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {failed > 0 && <p className="pb-2 text-xs text-ink-3">รายการที่ส่งไม่สำเร็จจะหยุดรายการหลังมันของบิลเดียวกันไว้ จนกว่าจะลองส่งใหม่หรือลบทิ้ง</p>}
    </Dialog>
  );
}
