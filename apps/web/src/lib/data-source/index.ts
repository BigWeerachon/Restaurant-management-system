import { dataSourceMode } from "./config";
import { demoDataSource } from "./demo-data-source";
import { httpDataSource } from "./http-data-source";
import type { DataSource } from "./types";

export { dataSourceMode } from "./config";

/** The adapter the app was built for (`NEXT_PUBLIC_DATA_SOURCE`). */
export function getDataSource(): DataSource {
  return dataSourceMode() === "api" ? httpDataSource : demoDataSource;
}
