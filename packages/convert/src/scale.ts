import { parseTransform } from "./box.ts";
import type { RawElement, RawSnapshot, StyleProp } from "./snapshot.ts";

/** Computed-style values that are lengths (or hold lengths) and so shrink/grow with a scale transform. */
const LENGTH_PROPS: StyleProp[] = [
  "font-size",
  "line-height",
  "letter-spacing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "text-shadow",
  "background-image",
  "background-size",
  "background-position",
  "filter",
  "backdrop-filter",
  "outline-width",
];

const PX = /(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px/gi;

/** Multiply every `<n>px` in a computed value by `k`, leaving `url(...)` contents alone. */
export function scalePx(value: string, k: number): string {
  return value
    .split(/(url\([^)]*\))/)
    .map((part, i) =>
      i % 2 ? part : part.replace(PX, (_, n: string) => `${Math.round(Number(n) * k * 1e4) / 1e4}px`),
    )
    .join("");
}

/**
 * Rects are measured after transforms, computed lengths are not: inside `transform: scale(.9)` a
 * 22px background tile or 16px font is drawn at 19.8px / 14.4px. Bake each element's accumulated
 * scale (its ancestors' and its own) into its length styles, and its ancestors' plus its own scale
 * into `layoutSize`, so the converter sees what was painted. Non-uniform scale uses the geometric
 * mean for lengths (the converter reports it).
 */
export function bakeScale(snap: RawSnapshot): RawSnapshot {
  const scaleOf = new Map<number, number>();
  let changed = false;
  const nodes = snap.nodes.map((n) => {
    if (n.kind !== "element") return n;
    const inherited = (n.parent !== null && scaleOf.get(n.parent)) || 1;
    const t = parseTransform(n.style.transform, n.style.rotate, n.style.scale);
    const k = inherited * Math.sqrt(t.scaleX * t.scaleY);
    scaleOf.set(n.id, k);
    const own = Math.abs(t.scaleX - 1) > 1e-3 || Math.abs(t.scaleY - 1) > 1e-3;
    if (Math.abs(k - 1) < 1e-3 && !(own && n.layoutSize)) return n;
    changed = true;
    const out: RawElement = { ...n, style: { ...n.style } };
    if (Math.abs(k - 1) >= 1e-3) for (const p of LENGTH_PROPS) out.style[p] = scalePx(n.style[p], k);
    if (n.layoutSize) {
      out.layoutSize = {
        width: n.layoutSize.width * inherited * t.scaleX,
        height: n.layoutSize.height * inherited * t.scaleY,
      };
    }
    return out;
  });
  return changed ? { ...snap, nodes } : snap;
}
