"use client";

import { create } from "zustand";
import { newId } from "@/lib/demo/engine";

export interface CartLine {
  id: string;
  menuItemId: string;
  qty: number;
  modifierOptionIds: string[];
  note?: string;
}

interface PosState {
  channelId: string;
  tableId?: string;
  guestCount?: number;
  /** Continuing an open bill (dine-in tab) instead of a new one. */
  orderId?: string;
  lines: CartLine[];
  lastAddedId?: string;
  setChannel(id: string): void;
  setTable(id?: string, guests?: number): void;
  add(line: Omit<CartLine, "id">): void;
  inc(id: string, delta: number): void;
  remove(id: string): void;
  setNote(id: string, note: string): void;
  resume(orderId: string, channelId: string, tableId?: string): void;
  clear(keepChannel?: boolean): void;
}

const sameLine = (a: Omit<CartLine, "id">, b: CartLine) =>
  a.menuItemId === b.menuItemId && !a.note && !b.note && a.modifierOptionIds.slice().sort().join() === b.modifierOptionIds.slice().sort().join();

export const usePos = create<PosState>((set, get) => ({
  channelId: "ch-dine",
  lines: [],
  setChannel: (channelId) => set({ channelId, ...(channelId !== "ch-dine" ? { tableId: undefined, guestCount: undefined } : {}) }),
  setTable: (tableId, guestCount) => set({ tableId, guestCount }),
  add: (line) => {
    // Tapping the same item again bumps the quantity instead of adding a row.
    const existing = get().lines.find((l) => sameLine(line, l));
    if (existing) {
      set({ lines: get().lines.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + line.qty } : l)), lastAddedId: existing.id });
      return;
    }
    const id = newId("line");
    set({ lines: [...get().lines, { ...line, id }], lastAddedId: id });
  },
  inc: (id, delta) =>
    set({
      lines: get()
        .lines.map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    }),
  remove: (id) => set({ lines: get().lines.filter((l) => l.id !== id) }),
  setNote: (id, note) => set({ lines: get().lines.map((l) => (l.id === id ? { ...l, note } : l)) }),
  resume: (orderId, channelId, tableId) => set({ orderId, channelId, tableId, lines: [] }),
  clear: (keepChannel = true) => set({ orderId: undefined, tableId: undefined, guestCount: undefined, lines: [], ...(keepChannel ? {} : { channelId: "ch-dine" }) }),
}));
