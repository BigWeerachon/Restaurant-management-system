/**
 * Units. Stock is stored in a base unit per dimension (g, ml, pcs); people
 * enter and read quantities in whatever is natural (กก., ลิตร, ช้อนโต๊ะ…).
 * Mirrors the `app.units` catalog.
 */
export type Dimension = "mass" | "volume" | "count";
export type BaseUnit = "g" | "ml" | "pcs";

export interface UnitDef {
  code: string;
  dimension: Dimension;
  factorToBase: number;
  nameTh: string;
  shortTh: string;
  nameEn: string;
  isBase: boolean;
}

export const UNITS: readonly UnitDef[] = [
  { code: "g", dimension: "mass", factorToBase: 1, nameTh: "กรัม", shortTh: "ก.", nameEn: "gram", isBase: true },
  { code: "kg", dimension: "mass", factorToBase: 1000, nameTh: "กิโลกรัม", shortTh: "กก.", nameEn: "kilogram", isBase: false },
  { code: "ml", dimension: "volume", factorToBase: 1, nameTh: "มิลลิลิตร", shortTh: "มล.", nameEn: "millilitre", isBase: true },
  { code: "l", dimension: "volume", factorToBase: 1000, nameTh: "ลิตร", shortTh: "ล.", nameEn: "litre", isBase: false },
  { code: "tsp", dimension: "volume", factorToBase: 5, nameTh: "ช้อนชา", shortTh: "ชช.", nameEn: "teaspoon", isBase: false },
  { code: "tbsp", dimension: "volume", factorToBase: 15, nameTh: "ช้อนโต๊ะ", shortTh: "ชต.", nameEn: "tablespoon", isBase: false },
  { code: "cup", dimension: "volume", factorToBase: 240, nameTh: "ถ้วยตวง", shortTh: "ถ้วย", nameEn: "cup", isBase: false },
  { code: "pcs", dimension: "count", factorToBase: 1, nameTh: "ชิ้น", shortTh: "ชิ้น", nameEn: "piece", isBase: true },
  { code: "dozen", dimension: "count", factorToBase: 12, nameTh: "โหล", shortTh: "โหล", nameEn: "dozen", isBase: false },
];

const byCode = new Map(UNITS.map((u) => [u.code, u]));

export function unit(code: string): UnitDef {
  const u = byCode.get(code);
  if (!u) throw new RangeError(`Unknown unit: ${code}`);
  return u;
}

export function baseUnitOf(code: string): BaseUnit {
  const d = unit(code).dimension;
  return d === "mass" ? "g" : d === "volume" ? "ml" : "pcs";
}

export function unitsFor(dimension: Dimension): UnitDef[] {
  return UNITS.filter((u) => u.dimension === dimension);
}

export function convert(qty: number, from: string, to: string): number {
  const a = unit(from);
  const b = unit(to);
  if (a.dimension !== b.dimension) {
    throw new RangeError(`Cannot convert ${a.code} to ${b.code}`);
  }
  return (qty * a.factorToBase) / b.factorToBase;
}

export function toBase(qty: number, from: string): number {
  return convert(qty, from, baseUnitOf(from));
}

/** Rounds to 4 decimals (database precision) without float artefacts. */
export function roundQty(qty: number): number {
  return Math.round(qty * 10_000) / 10_000;
}

const qtyFormat = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });

/**
 * Human-friendly quantity: picks the larger unit when it reads better
 * (1500 g → "1.5 กก.", 250 ml → "250 มล."). `preferred` forces a unit.
 */
export function formatQty(baseQty: number, base: BaseUnit, preferred?: string | null): string {
  let code: string = base;
  if (preferred && unit(preferred).dimension === unit(base).dimension) {
    code = preferred;
  } else if (base === "g" && Math.abs(baseQty) >= 1000) {
    code = "kg";
  } else if (base === "ml" && Math.abs(baseQty) >= 1000) {
    code = "l";
  }
  const value = convert(baseQty, base, code);
  return `${qtyFormat.format(value)} ${unit(code).shortTh}`;
}
