import { ApiFailure } from "./errors";
import type { Sql } from "./db";

/**
 * Idempotency-Key handling: a request sent again with the key it first used (a double tap, flaky shop Wi-Fi, the offline
 * queue replaying) must be answered with the first result and must not run its command a second time.
 *
 * The key is claimed BEFORE the command runs, with one atomic insert. Checking first and storing afterwards lets two
 * requests that arrive together both find nothing, both run, and both save (four expenses from one tap sent four times).
 *
 * A claim is a row in `app.api_idempotency` whose `status` is `PENDING`; it becomes the stored answer when the command
 * finishes, and is removed when the command fails (errors are not stored, so a retry runs the command again).
 */

/** `status` of a claimed key whose command has not finished. (Real answers are HTTP statuses, never 0.) */
export const PENDING = 0;
/** Length of an Idempotency-Key the store accepts (the table's check constraint). */
export const MIN_KEY_LENGTH = 8;
export const MAX_KEY_LENGTH = 128;
/** How long a stored answer is replayed. */
const KEEP_ANSWER = "24 hours";
/**
 * A claim older than this is taken over: its request died (the process stopped) without finishing or letting go. This assumes no
 * command runs this long — they take milliseconds; if one ever could, its claim would have to be renewed while it runs.
 */
const ABANDONED_AFTER = "2 minutes";
/** How long a request that finds its key being worked on waits for the first one before giving up. */
const WAIT_FOR_FIRST_MS = 10_000;
const POLL_MS = 40;

export type Claim = { owner: true } | { owner: false; status: number; response: unknown };

interface Stored {
  request_hash: string;
  status: number;
  response: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Takes the key if it is free, else answers with what the first request made of it (waiting for it if it is still running). */
export async function claimKey(sql: Sql, scope: string, key: string, method: string, path: string, requestHash: string): Promise<Claim> {
  const giveUpAt = Date.now() + WAIT_FOR_FIRST_MS;
  for (;;) {
    const claimed = await sql`
      insert into app.api_idempotency as k (tenant_id, key, method, path, request_hash, status, response)
      values (${scope}, ${key}, ${method}, ${path}, ${requestHash}, ${PENDING}, 'null'::jsonb)
      on conflict (tenant_id, key) do update
        set method = excluded.method, path = excluded.path, request_hash = excluded.request_hash,
            status = ${PENDING}, response = 'null'::jsonb, created_at = now()
        where k.created_at <= now() - ${KEEP_ANSWER}::interval
           or (k.status = ${PENDING} and k.created_at <= now() - ${ABANDONED_AFTER}::interval)
      returning 1 as ok`;
    if (claimed.length > 0) return { owner: true };

    const [first] = await sql<Stored[]>`select request_hash, status, response from app.api_idempotency where tenant_id = ${scope} and key = ${key}`;
    // Let go in the meantime (its command failed): the key is free again.
    if (!first) continue;
    if (first.request_hash !== requestHash) throw new ApiFailure("CONFLICT", 409, { reason: "idempotency_key_reused" });
    if (first.status !== PENDING) return { owner: false, status: first.status, response: first.response };
    if (Date.now() >= giveUpAt) throw new ApiFailure("REQUEST_IN_PROGRESS", 409);
    await sleep(POLL_MS);
  }
}

/** The command finished: keep its answer for replays. */
export async function storeAnswer(sql: Sql, scope: string, key: string, status: number, response: unknown): Promise<void> {
  const answer = response == null ? sql`'null'::jsonb` : sql.json(response as never);
  await sql`update app.api_idempotency set status = ${status}, response = ${answer} where tenant_id = ${scope} and key = ${key}`;
}

/** The command failed, or has no answer to keep: free the key so a retry can run. */
export async function releaseKey(sql: Sql, scope: string, key: string): Promise<void> {
  await sql`delete from app.api_idempotency where tenant_id = ${scope} and key = ${key} and status = ${PENDING}`;
}
