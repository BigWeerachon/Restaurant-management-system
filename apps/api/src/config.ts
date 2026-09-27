export interface Config {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  /** Lifetime of a PIN-switched staff token on a shared device. */
  staffTokenTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV ?? "development") as Config["env"];
  const jwtSecret = env.JWT_SECRET ?? (mode === "production" ? "" : "dev-only-secret-change-me-32-characters!!");
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  const databaseUrl = env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sabai_dev";
  return {
    env: mode,
    port: Number(env.PORT ?? 8787),
    databaseUrl,
    jwtSecret,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
    staffTokenTtlSeconds: Number(env.STAFF_TOKEN_TTL ?? 12 * 3600),
  };
}
