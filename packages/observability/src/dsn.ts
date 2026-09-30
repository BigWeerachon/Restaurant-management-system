export interface ParsedDsn {
  /** Where envelopes are posted. */
  endpoint: string;
  publicKey: string;
  projectId: string;
}

/** `https://<key>@<host>[:port][/prefix]/<project>` (the Sentry DSN shape, which GlitchTip and others accept too). `null` if it is not one. */
export function parseDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !projectId || !/^https?:$/.test(u.protocol)) return null;
    const prefix = u.pathname.split("/").filter(Boolean).slice(0, -1).join("/");
    return { endpoint: `${u.protocol}//${u.host}${prefix ? `/${prefix}` : ""}/api/${projectId}/envelope/`, publicKey: u.username, projectId };
  } catch {
    return null;
  }
}
