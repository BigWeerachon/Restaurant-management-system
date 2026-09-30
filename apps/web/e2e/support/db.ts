import { execFileSync } from "node:child_process";
import { DATABASE_URL } from "./env";

/** Runs one SQL statement against the API mode's database as its owner (to set a scene, or to look at what the app wrote). Returns the first column of the rows, one per line. */
export function sql(statement: string): string {
  return execFileSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-tAqc", statement], { encoding: "utf8" }).trim();
}
