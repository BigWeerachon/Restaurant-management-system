"use client";

import { ArrowLeft, ClipboardList, Lock, ShoppingBag, UserRoundCog, Utensils } from "lucide-react";
import Link from "next/link";
import { ConnectionBadge } from "@/components/app/connection-badge";
import { usePos } from "@/components/pos/pos-store";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import { useAccess, useUi } from "@/hooks/use-sabai";
import { cn } from "@/lib/cn";
import type { Channel, Order } from "@/lib/demo/types";

const CHANNEL_ICON: Record<string, typeof Utensils> = { dine_in: Utensils, takeaway: ShoppingBag };

/** Top bar: back to the home screen, sales channel, table, open bills, shift, connection and who is signed in. */
export function PosHeader({
  channels,
  channel,
  existing,
  table,
  openCount,
  shiftOpen,
  onTables,
  onOrders,
  onShift,
}: {
  channels: Channel[];
  channel?: Channel;
  existing?: Order;
  table?: { name: string };
  openCount: number;
  shiftOpen: boolean;
  onTables: () => void;
  onOrders: () => void;
  onShift: () => void;
}) {
  const { member, can, nav } = useAccess();
  const pos = usePos();
  const openSwitch = useUi((s) => s.setSwitchUserOpen);
  const home = nav.primary.find((n) => n.key !== "pos");

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-3 backdrop-blur-xl backdrop-saturate-150 sm:gap-3 sm:px-4">
      {/* The till has no page title on screen; a screen reader still needs to be told which page this is. */}
      <h1 className="sr-only">ขายหน้าร้าน</h1>
      {home ? (
        <Link href={home.href ?? "/"} className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="กลับหน้าหลัก">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      ) : null}
      <div role="radiogroup" aria-label="ช่องทางขาย" className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {channels.map((c) => {
          const Ico = CHANNEL_ICON[c.kind];
          const on = c.id === channel?.id;
          return (
            <button
              key={c.id}
              role="radio"
              aria-checked={on}
              disabled={!!existing && !on}
              onClick={() => pos.setChannel(c.id)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[15px] font-medium transition-colors disabled:opacity-40",
                on ? "border-transparent bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong",
              )}
            >
              {Ico ? <Ico className="h-4 w-4" aria-hidden="true" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />}
              {c.short}
            </button>
          );
        })}
      </div>
      {channel?.kind === "dine_in" && !existing && (
        <Button variant="secondary" onClick={onTables} className="shrink-0">
          {table ? `โต๊ะ ${table.name}` : "เลือกโต๊ะ"}
        </Button>
      )}
      <Button variant="secondary" onClick={onOrders} className="relative shrink-0" icon={<ClipboardList className="h-5 w-5" />}>
        <span className="sr-only md:not-sr-only">บิลค้าง</span>
        {openCount > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-on-accent">
            {openCount}
            <span className="sr-only"> บิล</span>
          </span>
        )}
      </Button>
      {can("pos.pay") && (
        <button onClick={onShift} className={cn("hidden h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium lg:flex", shiftOpen ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {shiftOpen ? <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
          {shiftOpen ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
        </button>
      )}
      <ConnectionBadge compact className="shrink-0" />
      <button onClick={() => openSwitch(true)} className="flex h-11 shrink-0 items-center gap-2 rounded-xl px-1.5 hover:bg-surface-2" aria-label={`ผู้ใช้ ${member?.name} แตะเพื่อสลับผู้ใช้`}>
        <Avatar name={member?.name ?? "?"} color={member?.color} size={34} />
        <UserRoundCog className="hidden h-4 w-4 text-ink-3 sm:block" aria-hidden="true" />
      </button>
    </header>
  );
}
