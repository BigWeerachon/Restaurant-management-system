import { trace } from "@opentelemetry/api";
import { redactFields } from "@sabai/observability";

/** Structured JSON logs (one line per event) — ready for any log pipeline. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * One JSON line per event. Anything under a sensitive key (a token, a PIN, a header that authenticates) is dropped and
 * text that looks like a secret is masked, so a careless `log.info("x", { headers })` cannot put a credential in the
 * logs. While a trace is active every line carries its ids, so a log line can be found from a trace and back.
 */
export function createLogger(opts: { silent?: boolean; service?: string; sink?: (line: string) => void } = {}): Logger {
  const sink = opts.sink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    if (opts.silent) return;
    const span = trace.getActiveSpan()?.spanContext();
    sink(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg,
        ...(opts.service ? { service: opts.service } : {}),
        ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
        ...(fields ? (redactFields(fields) as Record<string, unknown>) : {}),
      }),
    );
  };
  return {
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
  };
}
