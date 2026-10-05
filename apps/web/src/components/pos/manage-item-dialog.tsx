"use client";

import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { useAccess } from "@/hooks/use-sabai";
import { useDsAction } from "@/hooks/use-data-source";
import type { MenuItem } from "@/lib/demo/types";

/** Long-press style menu for one dish: switch it off for the day, or look at its recipe and cost. */
export function ManageItemDialog({ item, onClose }: { item: MenuItem | null; onClose: () => void }) {
  const { branch, can } = useAccess();
  const { exec } = useDsAction();

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()} title={item?.name ?? ""} description="จัดการเมนูนี้ที่สาขา" size="sm">
      {item && (
        <div className="space-y-2 pb-3">
          <Button
            block
            size="lg"
            variant={item.soldOut[branch.id] ? "primary" : "secondary"}
            onClick={async () => {
              const next = !item.soldOut[branch.id];
              const r = await exec((ds) => ds.setSoldOut(item.id, next), {
                success: next ? `ปิดขาย “${item.name}” แล้ว` : `เปิดขาย “${item.name}” อีกครั้ง`,
                successDetail: next ? "ทุกเครื่องในสาขาจะเห็นว่าหมด" : undefined,
              });
              if (r.ok) onClose();
            }}
          >
            {item.soldOut[branch.id] ? "เปิดขายอีกครั้ง" : "ของหมด — ปิดขายชั่วคราว"}
          </Button>
          {can("menu.manage") && (
            <Link href={`/menu/${item.id}`} className="flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-medium text-ink-2 hover:bg-surface-2">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" /> ดูสูตรและต้นทุน
            </Link>
          )}
        </div>
      )}
    </Dialog>
  );
}
