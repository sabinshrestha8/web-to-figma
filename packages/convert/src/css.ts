import type { TextStyle } from "@w2f/ir";

type RGBA = TextStyle["color"];

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** "16px" → 16; anything that isn't a px length ("normal", "auto", "") → null. */
export function px(value: string): number | null {
  const m = /^(-?[\d.]+(?:e[+-]?\d+)?)px$/i.exec(value.trim()); // Tailwind's rounded-full is 3.40282e+38px
  return m ? Number(m[1]) : null;
}

/**
 * Parse a computed color. The collector normalizes every color to rgb()/rgba(), so only those
 * forms (legacy comma or modern space syntax) are accepted. Fully transparent → null.
 */
export function parseColor(value: string): RGBA | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!m?.[1]) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (s: string | undefined, max: number) => {
    if (s === undefined) return 1;
    const n = s.endsWith("%") ? Number.parseFloat(s) / 100 : Number.parseFloat(s) / max;
    return Number.isFinite(n) ? round4(Math.min(1, Math.max(0, n))) : Number.NaN;
  };
  const [r, g, b, a] = [
    channel(parts[0], 255),
    channel(parts[1], 255),
    channel(parts[2], 255),
    channel(parts[3], 1),
  ];
  if ([r, g, b, a].some(Number.isNaN) || a === 0) return null;
  return { r, g, b, a };
}

/** Split a CSS font-family list, honoring quotes: `"Inter Var", system-ui` → ["Inter Var", "system-ui"]. */
export function parseFontFamilies(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/\s*("([^"]*)"|'([^']*)'|[^,]+)\s*(?:,|$)/g)) {
    const name = (m[2] ?? m[3] ?? m[1] ?? "").trim();
    if (name) out.push(name);
  }
  return out.length ? out : ["sans-serif"];
}

export function textTransform(value: string): TextStyle["transform"] {
  return value === "uppercase" || value === "lowercase" || value === "capitalize" ? value : "none";
}

export function textAlign(value: string): "left" | "center" | "right" | "justify" {
  if (value === "center" || value === "justify") return value;
  return value === "right" || value === "end" ? "right" : "left";
}

/** Split on `sep` outside parentheses and quotes: "rgb(0, 0, 0) 1px, red 2px" → ["rgb(0, 0, 0) 1px", "red 2px"]. */
export function splitTop(value: string, sep: "," | " "): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch))) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const ANGLE_UNITS: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

/** "45deg" | "0.25turn" | "1rad" | "100grad" → degrees; anything else → null. */
export function parseAngle(value: string): number | null {
  const m = /^(-?[\d.]+(?:e[+-]?\d+)?)(deg|grad|rad|turn)$/i.exec(value.trim());
  return m?.[1] && m[2] ? Number(m[1]) * (ANGLE_UNITS[m[2]] ?? 1) : null;
}

/** "12px" → 12, "50%" → 50% of `basis`; anything else → null. */
export function parseLength(value: string, basis: number): number | null {
  const v = value.trim();
  if (v.endsWith("%")) {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * basis : null;
  }
  return v === "0" ? 0 : px(v);
}
