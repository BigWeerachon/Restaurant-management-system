import { dataSourceMode } from "./config";
import { demoDataSource } from "./demo-data-source";
import type { DataSource } from "./types";

export { dataSourceMode } from "./config";

/**
 * The HTTP adapter — with the client, the mappers and everything else it needs — is a download of its own, fetched the
 * first time the app talks to the server. The demo never does, so it never carries any of it (which is most of what
 * made the first screen heavier once the app could use a real API). Every `DataSource` method answers with a promise,
 * which is what lets a stand-in wait for that download without the callers noticing.
 */
let http: Promise<DataSource> | null = null;
const loadHttp = (): Promise<DataSource> =>
  (http ??= import("./http-data-source").then(
    (m) => m.httpDataSource,
    (error) => {
      // A download that failed (line down at the wrong moment) must not be remembered: the next call tries again.
      http = null;
      throw error;
    },
  ));

const lazyHttp = new Proxy({} as DataSource, {
  get(_target, name) {
    // Not a method: without this an `await` on the stand-in itself would wait for a `then` that never comes.
    if (typeof name !== "string" || name === "then") return undefined;
    return async (...args: unknown[]) => {
      const ds = (await loadHttp()) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return ds[name]!(...args);
    };
  },
});

/** The adapter the app was built for (`NEXT_PUBLIC_DATA_SOURCE`). */
export function getDataSource(): DataSource {
  return dataSourceMode() === "api" ? lazyHttp : demoDataSource;
}
