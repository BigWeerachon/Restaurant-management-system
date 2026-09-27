/** Structured JSON logs (one line per event) — ready for any log pipeline. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(opts: { silent?: boolean } = {}): Logger {
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    if (opts.silent) return;
    process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })}\n`);
  };
  return {
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
  };
}
