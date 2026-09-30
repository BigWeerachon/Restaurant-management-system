import type { Sql } from "./db";

export interface EventPing {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  type: string;
  aggregate_id: string;
}

/**
 * Fans Postgres NOTIFY pings out to SSE subscribers (KDS screens, POS devices).
 * Every API instance runs its own hub, so this scales horizontally with no
 * extra infrastructure; payloads carry ids only and clients re-read via RLS.
 */
export class EventHub {
  private readonly subscribers = new Set<(e: EventPing) => void>();
  private stop: (() => Promise<void>) | null = null;

  async start(sql: Sql): Promise<void> {
    const listener = await sql.listen("sabai_events", (payload) => {
      let event: EventPing;
      try {
        event = JSON.parse(payload) as EventPing;
      } catch {
        return;
      }
      for (const fn of this.subscribers) fn(event);
    });
    this.stop = () => listener.unlisten();
  }

  subscribe(fn: (e: EventPing) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  get size(): number {
    return this.subscribers.size;
  }

  async close(): Promise<void> {
    await this.stop?.();
    this.subscribers.clear();
  }
}
