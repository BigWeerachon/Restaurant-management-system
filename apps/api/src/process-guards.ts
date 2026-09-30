import type { ErrorReporter } from "@sabai/observability";
import type { Logger } from "./logger";

interface Proc {
  on(event: string, listener: (...args: never[]) => void): unknown;
  stdout: { on(event: "error", listener: () => void): unknown };
  stderr: { on(event: "error", listener: () => void): unknown };
}

const describe = (e: unknown) => (e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e));

/**
 * What to do with what nothing else caught.
 *
 * A rejection is logged and reported and the server carries on. An exception leaves it in an unknown state, so it is
 * reported and the process exits for the platform to start a fresh one — within seconds, whatever the report does.
 *
 * A closed log pipe (a supervisor that stopped reading, a shell that went away) must neither take the server down nor make
 * these handlers loop: logging from a crash handler into a broken pipe fails again, which is another uncaught exception,
 * which logs again… (That loop was real: 100% of a CPU and gigabytes of memory, until it was killed.)
 */
export function installProcessGuards(opts: { log: Logger; reporter: ErrorReporter; proc?: Proc; exit?: (code: number) => void; hardStopMs?: number }): void {
  const { log, reporter } = opts;
  const proc = opts.proc ?? (process as unknown as Proc);
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  proc.stdout.on("error", () => {});
  proc.stderr.on("error", () => {});

  proc.on("unhandledRejection", (reason: unknown) => {
    try {
      log.error("unhandled_rejection", { error: describe(reason) });
    } catch {
      // Nowhere to say it; carry on.
    }
    reporter.capture(reason, { code: "UNHANDLED_REJECTION" });
  });

  let crashing = false;
  proc.on("uncaughtException", (error: Error) => {
    // A second failure while going down: do not try to report that too, just go.
    if (crashing) return exit(1);
    crashing = true;
    // Whatever happens to the report, the process is gone in a few seconds.
    const hardStop = setTimeout(() => exit(1), opts.hardStopMs ?? 3000);
    hardStop.unref?.();
    try {
      log.error("uncaught_exception", { error: describe(error) });
    } catch {
      // The log is gone (a closed pipe): report anyway.
    }
    try {
      reporter.capture(error, { code: "UNCAUGHT_EXCEPTION" });
    } finally {
      void reporter.flush().finally(() => exit(1));
    }
  });
}
