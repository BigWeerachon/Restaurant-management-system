/**
 * A reader for server-sent events over a plain `fetch` body. The browser's own `EventSource` cannot send the
 * `Authorization` and `X-Tenant-Id` headers the API needs, so the stream is read by hand.
 */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Feed it text as it arrives, in whatever pieces it arrives in; it calls `onMessage` once per complete message.
 * Handles `\n`, `\r\n` and `\r` line ends, comment lines (": keep-alive"), several `data:` lines in one message,
 * and a message that is cut in the middle of a chunk.
 */
export function createSseParser(onMessage: (m: SseMessage) => void): (chunk: string) => void {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  const flush = () => {
    // A message with neither an event nor data (a blank line after a comment) is nothing.
    if (data.length > 0 || event) onMessage({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (l: string) => {
    if (l === "") return flush();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    // One optional space after the colon belongs to the syntax, not the value.
    const value = i === -1 ? "" : l.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  return (chunk) => {
    buffer += chunk;
    let cut: number;
    // A "\r" at the very end may be the first half of "\r\n": wait for the next chunk before counting it as a line end.
    while ((cut = buffer.search(/\r\n|\n|\r(?!$)/)) !== -1) {
      const l = buffer.slice(0, cut);
      buffer = buffer.slice(cut + (buffer.startsWith("\r\n", cut) ? 2 : 1));
      line(l);
    }
  };
}
