"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLoad } from "@/hooks/use-data-source";
import { useSabai } from "@/lib/demo/store";
import type { Ticket } from "@/lib/demo/types";
import { ticketsToPrint } from "@/lib/escpos/kitchen";
import { initPrinter, loadPrinterSend, usePrinter } from "@/lib/escpos/printer";
import { getPaperWidth } from "@/lib/print";

/** Prints one ticket's slip; on failure says so and offers to try again, because a missed slip means a missed order. */
export async function printTicketSlip(t: Ticket) {
  const { stations } = useSabai.getState().db;
  const station = stations.length > 1 ? stations.find((s) => s.id === t.stationId)?.name : undefined;
  try {
    // The drawing and encoding code is fetched the first time a slip is printed (ahead of time when a printer is set up, see below).
    const [{ printKitchenDirect }, { slipFromTicket }] = await Promise.all([loadPrinterSend(), import("@/lib/escpos/layout")]);
    await printKitchenDirect(slipFromTicket(t, station), { widthMm: getPaperWidth() });
    return true;
  } catch (e) {
    toast.error(`พิมพ์ใบครัว #${t.ticketNo} ไม่สำเร็จ`, {
      id: `kitchen-slip-${t.id}`,
      description: usePrinter.getState().error ?? "ตรวจเครื่องพิมพ์แล้วลองอีกครั้ง",
      action: { label: "ลองอีกครั้ง", onClick: () => void printTicketSlip(t) },
    });
    return false;
  }
}

/**
 * Keeps this device's printer connected — picking up one already allowed, and noticing a USB or serial printer
 * plugged in or pulled out while the till is open — and prints kitchen slips when asked to. Renders nothing.
 */
export function PrinterBridge() {
  const autoKitchen = usePrinter((s) => s.settings.autoKitchen);
  const transport = usePrinter((s) => s.settings.transport);

  useEffect(() => {
    initPrinter();
    // A till with a printer prints on every sale: have the code for it ready now, and kept for when the line is down.
    if (usePrinter.getState().settings.transport) void loadPrinterSend().catch(() => undefined);
    void usePrinter.getState().reconnect();
    const nav = navigator as unknown as { usb?: EventTarget; serial?: EventTarget };
    const targets = [nav.usb, nav.serial].filter((t): t is EventTarget => !!t);
    const onConnect = () => void usePrinter.getState().reconnect();
    const onDisconnect = () => void usePrinter.getState().disconnect();
    for (const t of targets) {
      t.addEventListener("connect", onConnect);
      t.addEventListener("disconnect", onDisconnect);
    }
    return () => {
      for (const t of targets) {
        t.removeEventListener("connect", onConnect);
        t.removeEventListener("disconnect", onDisconnect);
      }
    };
  }, []);

  return autoKitchen && transport ? <KitchenPrinting /> : null;
}

/**
 * Mounted only while "print kitchen slips" is on. It keeps the tickets fresh (the kitchen screen may not be open on
 * this device) and prints each new one once. What is already on the screen when it starts is not new, and is not printed.
 */
function KitchenPrinting() {
  const { loading } = useLoad(["tickets"], { everyMs: 20_000 });
  const hydrated = useSabai((s) => s.hydrated);
  const tickets = useSabai((s) => s.db.tickets);
  const branchId = useSabai((s) => s.session.branchId);
  const status = usePrinter((s) => s.status);
  const settled = usePrinter((s) => s.settled);
  /** Tickets this device has dealt with. `null` until the first look at a loaded screen. */
  const printed = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!hydrated || loading || !branchId) return;
    if (printed.current === null) {
      printed.current = new Set(tickets.map((t) => t.id));
      return;
    }
    const seen = printed.current;
    const fresh = ticketsToPrint(tickets, seen, { branchId, now: Date.now() });
    if (fresh.length === 0) {
      toast.dismiss("kitchen-printer-down");
      return;
    }
    if (status !== "ready") {
      // Not marked as dealt with: they print as soon as the printer is back (slips older than half an hour are dropped).
      if (settled) toast.warning(`เครื่องพิมพ์ครัวยังไม่พร้อม มีใบครัวรอพิมพ์ ${fresh.length} ใบ`, { id: "kitchen-printer-down", description: "เชื่อมต่อเครื่องพิมพ์ที่ ตั้งค่า → ใบเสร็จและเครื่องพิมพ์ ใบครัวจะพิมพ์ออกมาเอง", duration: 15_000 });
      return;
    }
    toast.dismiss("kitchen-printer-down");
    for (const t of fresh) seen.add(t.id);
    void (async () => {
      for (const t of fresh) await printTicketSlip(t);
    })();
  }, [tickets, branchId, hydrated, loading, status, settled]);

  return null;
}
