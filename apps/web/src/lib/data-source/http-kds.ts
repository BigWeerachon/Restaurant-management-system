/** Kitchen commands for the API adapter. */
import { DomainError } from "../demo/engine";
import { useSabai } from "../demo/store";
import { apiFetch } from "./http-client";
import { refresh } from "./http-context";
import type { DataSource } from "./types";

export const kdsCommands = {
  async setTicketStatus(ticketId, status) {
    // The API has no "cancelled" to set: a ticket is cancelled by voiding its order lines.
    if (status === "cancelled") throw new DomainError("INTERNAL", { feature: "setTicketStatus(cancelled)" });
    await apiFetch(`/v1/kds/tickets/${ticketId}/status`, { method: "POST", body: { status } });
    await refresh(["tickets", "orders"]);
  },

  async toggleTicketItem(ticketId, orderItemId) {
    const ticket = useSabai.getState().db.tickets.find((t) => t.id === ticketId);
    const line = ticket?.items.find((i) => i.orderItemId === orderItemId);
    if (!line?.id) throw new DomainError("NOT_FOUND");
    await apiFetch(`/v1/kds/ticket-items/${line.id}/toggle`, { method: "POST" });
    await refresh(["tickets"]);
  },
} satisfies Partial<DataSource>;
