import { newId } from "../demo/engine";
import { dataSourceMode } from "./config";

/** Ids the browser makes up before sending (a new order, a cart line): a UUID for the API, the demo's readable id otherwise. */
export function newClientId(prefix: string): string {
  return dataSourceMode() === "api" ? crypto.randomUUID() : newId(prefix);
}
