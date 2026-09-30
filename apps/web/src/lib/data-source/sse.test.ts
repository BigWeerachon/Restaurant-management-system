import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "./sse";

const collect = () => {
  const out: SseMessage[] = [];
  return { out, feed: createSseParser((m) => out.push(m)) };
};

describe("server-sent event reader", () => {
  it("reads one message per blank line, with its event name and data", () => {
    const { out, feed } = collect();
    feed('event: ready\ndata: {"branchId":"b1"}\n\nevent: domain\ndata: {"type":"order.paid"}\n\n');
    expect(out).toEqual([
      { event: "ready", data: '{"branchId":"b1"}' },
      { event: "domain", data: '{"type":"order.paid"}' },
    ]);
  });

  it("reads a message that arrives in pieces, even cut in the middle of a word", () => {
    const { out, feed } = collect();
    for (const piece of ["event: dom", "ain\nda", 'ta: {"type":"ki', 'tchen.ticket_fired"}\n', "\n"]) feed(piece);
    expect(out).toEqual([{ event: "domain", data: '{"type":"kitchen.ticket_fired"}' }]);
  });

  it("copes with \\r\\n line ends, including one split between two chunks", () => {
    const { out, feed } = collect();
    feed("event: ping\r\ndata: {}\r");
    feed("\n\r\n");
    expect(out).toEqual([{ event: "ping", data: "{}" }]);
  });

  it("ignores comment lines and a lone blank line", () => {
    const { out, feed } = collect();
    feed(": keep-alive\n\n\n: another\nevent: ping\ndata: {}\n\n");
    expect(out).toEqual([{ event: "ping", data: "{}" }]);
  });

  it("joins several data lines with a newline, and calls a message without an event name 'message'", () => {
    const { out, feed } = collect();
    feed("data: line one\ndata: line two\n\n");
    expect(out).toEqual([{ event: "message", data: "line one\nline two" }]);
  });

  it("keeps Thai text and a value with no space after the colon intact", () => {
    const { out, feed } = collect();
    feed("event:domain\ndata:บิลใหม่ ลาเต้เย็น\n\n");
    expect(out).toEqual([{ event: "domain", data: "บิลใหม่ ลาเต้เย็น" }]);
  });

  it("does not report a message that has not ended yet", () => {
    const { out, feed } = collect();
    feed("event: domain\ndata: {}\n");
    expect(out).toEqual([]);
  });
});
