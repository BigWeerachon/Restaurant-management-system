import { describe, expect, it } from "vitest";
import { paintLayout, type Ctx2D } from "./raster";
import { layoutBlocks } from "./layout";

function recorder() {
  const calls: string[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    lineWidth: 1,
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillText: (t: string, x: number, y: number) => calls.push(`text "${t}" @${x},${y} [${ctx.font}]`),
    fillRect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x},${y} ${w}x${h} ${ctx.fillStyle}`),
    setLineDash: (d: number[]) => calls.push(`dash ${d.join(",")}`),
    beginPath: () => calls.push("begin"),
    moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
    stroke: () => calls.push("stroke"),
  } satisfies Ctx2D;
  return { ctx, calls };
}

describe("painting a slip", () => {
  const layout = layoutBlocks([{ t: "text", text: "ครัว", bold: true }, { t: "rule", ch: "=" }, { t: "rule" }], { width: 384, measure: (t) => t.length * 10 });

  it("clears to white first, then draws black text in the slip font", () => {
    const { ctx, calls } = recorder();
    paintLayout(ctx, layout);
    expect(calls[0]).toBe(`rect 0,0 384x${layout.height} #fff`);
    expect(calls.find((c) => c.startsWith("text"))).toMatch(/^text "ครัว" @4,10 \[700 24px "IBM Plex Sans Thai"/);
    expect(ctx.textBaseline).toBe("top");
  });

  it("draws a double rule for = and a dashed line for -", () => {
    const { ctx, calls } = recorder();
    paintLayout(ctx, layout);
    expect(calls.filter((c) => c === "stroke")).toHaveLength(3);
    expect(calls.filter((c) => c.startsWith("dash"))).toEqual(["dash ", "dash 8,5"]);
  });
});
