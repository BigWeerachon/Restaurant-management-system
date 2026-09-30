export type DataSourceMode = "demo" | "api";

/** `NEXT_PUBLIC_DATA_SOURCE=api` switches the app to the real API; anything else keeps the offline demo (ADR-0009). */
export function dataSourceMode(): DataSourceMode {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "api" ? "api" : "demo";
}
