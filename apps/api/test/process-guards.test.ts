import { EventEmitter } from "node:events";
import type { ErrorReporter } from "@sabai/observability";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../src/logger";
import { installProcessGuards } from "../src/process-guards";

function setup(over: { logThrows?: boolean; flush?: () => Promise<void> } = {}) {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  const logged: string[] = [];
  const log: Logger = {
    info: () => {},
    warn: () => {},
    error: (msg) => {
      if (over.logThrows) throw new Error("EPIPE: broken pipe");
      logged.push(msg);
    },
  };
  const captured: unknown[] = [];
  const reporter: ErrorReporter = { enabled: true, capture: (e) => captured.push(e), flush: over.flush ?? (async () => {}) };
  const exit = vi.fn();
  installProcessGuards({ log, reporter, proc: proc as never, exit, hardStopMs: 50 });
  return { proc, logged, captured, exit };
}

describe("what nothing else caught", () => {
  it("logs and reports an unhandled rejection and carries on", () => {
    const { proc, logged, captured, exit } = setup();
    proc.emit("unhandledRejection", new Error("nobody caught this"));
    expect(logged).toEqual(["unhandled_rejection"]);
    expect(captured).toHaveLength(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("logs and reports an uncaught exception, then exits", async () => {
    const { proc, logged, captured, exit } = setup();
    proc.emit("uncaughtException", new Error("boom"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logged).toEqual(["uncaught_exception"]);
    expect(captured).toHaveLength(1);
  });

  it("does not loop when the log is a closed pipe: a second failure while going down just exits", async () => {
    const { proc, logged, captured, exit } = setup({ logThrows: true });
    // What used to happen: the log write fails, which is another uncaught exception, which logs, which fails…
    proc.emit("uncaughtException", new Error("first"));
    proc.emit("uncaughtException", new Error("EPIPE from the log itself"));
    proc.emit("uncaughtException", new Error("and again"));
    expect(exit).toHaveBeenCalled();
    expect(logged).toEqual([]);
    // Reported once, though the log could not be written.
    expect(captured).toHaveLength(1);
  });

  it("does not wait for a report that never finishes", async () => {
    const { proc, exit } = setup({ flush: () => new Promise(() => {}) });
    proc.emit("uncaughtException", new Error("boom"));
    expect(exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 1000 });
  });

  it("does not let a closed stdout or stderr become a crash", () => {
    const { proc } = setup();
    expect(() => proc.stdout.emit("error", new Error("EPIPE"))).not.toThrow();
    expect(() => proc.stderr.emit("error", new Error("EPIPE"))).not.toThrow();
  });
});
