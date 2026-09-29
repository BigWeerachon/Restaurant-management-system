import { describe, expect, it } from "vitest";
import type { Ticket } from "../demo/types";
import { ticketsToPrint } from "./kitchen";

const now = Date.parse("2026-09-29T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  branchId: "b1",
  orderId: "o-" + id,
  stationId: "s1",
  ticketNo: id,
  status: "new",
  firedAt: ago(1),
  items: [{ orderItemId: "i-" + id, name: "ข้าวผัด", qty: 1, modifiers: "", status: "pending" }],
  channelName: "ทานที่ร้าน",
  channelKind: "dine_in",
  ...over,
});

describe("which tickets need a kitchen slip", () => {
  const pick = (tickets: Ticket[], printed: string[] = []) => ticketsToPrint(tickets, new Set(printed), { branchId: "b1", now }).map((t) => t.id);

  it("takes new tickets of this branch, oldest first", () => {
    expect(pick([ticket("b", { firedAt: ago(1) }), ticket("a", { firedAt: ago(3) })])).toEqual(["a", "b"]);
  });

  it("skips what was printed, other branches, started and cancelled tickets", () => {
    expect(pick([ticket("done"), ticket("other", { branchId: "b2" }), ticket("cooking", { status: "in_progress" }), ticket("gone", { status: "cancelled" }), ticket("ok")], ["done"])).toEqual(["ok"]);
  });

  it("skips a ticket with nothing left to cook, and one too old to matter", () => {
    expect(pick([ticket("void", { items: [{ orderItemId: "x", name: "ข้าว", qty: 1, modifiers: "", status: "voided" }] }), ticket("old", { firedAt: ago(45) }), ticket("edge", { firedAt: ago(30) })])).toEqual(["edge"]);
  });
});
