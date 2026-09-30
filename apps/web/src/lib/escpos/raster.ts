import { packBitmap, type Bitmap } from "./encoder";
import { layoutBlocks, type Block, type DrawOp, type FontSpec, type Layout } from "./layout";

/** The app's own Thai font, then whatever Thai the system has: a picture drawn with a missing font would be boxes. */
const FAMILY = '"IBM Plex Sans Thai", "Noto Sans Thai", "Sarabun", sans-serif';

const fontString = (f: FontSpec) => `${f.bold ? "700" : "400"} ${f.px}px ${FAMILY}`;

/** The slice of the canvas API this needs — so painting can be checked without a browser. */
export interface Ctx2D {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textBaseline: CanvasTextBaseline;
  lineWidth: number;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash?(segments: number[]): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
}

export function paintLayout(ctx: Ctx2D, layout: Layout) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  for (const op of layout.ops as DrawOp[]) {
    if (op.type === "text") {
      ctx.font = fontString(op.font);
      ctx.fillText(op.text, op.x, op.y);
    } else {
      ctx.lineWidth = 2;
      ctx.setLineDash?.(op.ch === "-" ? [8, 5] : []);
      const line = (y: number) => {
        ctx.beginPath();
        ctx.moveTo(4, y);
        ctx.lineTo(layout.width - 4, y);
        ctx.stroke();
      };
      if (op.ch === "=") (line(op.y - 2), line(op.y + 3));
      else line(op.y);
    }
  }
}

function makeCanvas(width: number, height: number): { ctx: CanvasRenderingContext2D; read: () => Uint8ClampedArray } {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d", { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
    return { ctx, read: () => ctx.getImageData(0, 0, width, height).data };
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return { ctx, read: () => ctx.getImageData(0, 0, width, height).data };
}

/**
 * Draws a slip as the printer will print it: `widthDots` wide (384 for a 58 mm roll, 576 for 80 mm), black on white,
 * ready to send as a picture. Drawing it ourselves means Thai comes out right on any printer — no code page to guess.
 */
export async function renderBlocksToBitmap(blocks: Block[], widthDots: number): Promise<Bitmap> {
  // The font must be on hand before measuring, or the widths are those of the fallback font.
  if (typeof document !== "undefined" && document.fonts) {
    // The sample text names both faces of the family the font is split into (Thai and Latin letters, digits and ฿).
    const sample = "กขค 0123456789 Aa฿";
    await Promise.all([document.fonts.load(`400 24px "IBM Plex Sans Thai"`, sample), document.fonts.load(`700 24px "IBM Plex Sans Thai"`, sample)]).catch(() => undefined);
  }
  const probe = makeCanvas(8, 8).ctx;
  const layout = layoutBlocks(blocks, {
    width: widthDots,
    measure: (text, font) => {
      probe.font = fontString(font);
      return probe.measureText(text).width;
    },
  });
  const { ctx, read } = makeCanvas(layout.width, layout.height);
  paintLayout(ctx as unknown as Ctx2D, layout);
  return packBitmap(read(), layout.width, layout.height);
}
