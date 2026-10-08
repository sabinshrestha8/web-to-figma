import { backgroundLayers } from "./paint.ts";
import { bakeScale } from "./scale.ts";
import type { RawElement, RawRect, RawSnapshot } from "./snapshot.ts";

/**
 * Pixels the capture step must produce for the converter. Keys are stable for a given snapshot, so
 * the converter finds each result again: `el:<id>` for raster islands, `tile:<id>:<layer>` for tiles.
 */
export type RasterRequest =
  | { key: string; kind: "element"; id: number; rect: RawRect }
  | { key: string; kind: "tile"; css: string; width: number; height: number };

/** The untransformed box size: backgrounds, radii and percentages resolve in this space. */
export const paintSize = (el: RawElement) =>
  el.layoutSize ?? { width: el.rect.width, height: el.rect.height };

const REPLACED = new Set(["img", "svg", "canvas", "video", "iframe", "embed", "object"]);
const PIXEL_ONLY = ["clip-path", "mask-image", "border-image-source"] as const;

/**
 * Why an element is drawn as a screenshot crop (a "raster island"), or null.
 * Replaced content can't be rebuilt from DOM facts; clip-path/mask/border-image can't be expressed in
 * Figma. The latter only on leaves (`leaf`: no child nodes), so text inside never becomes pixels.
 */
export function islandReason(el: RawElement, leaf: boolean): string | null {
  if (el.style.visibility !== "visible") return null;
  if (el.tag === "img" || el.tag === "svg") return `<${el.tag}> (real images and vectors arrive in Phase 5)`;
  if (REPLACED.has(el.tag)) return `<${el.tag}> content`;
  if (
    el.tag === "input" &&
    /^(checkbox|radio)$/.test(el.attrs.type ?? "") &&
    el.style.appearance !== "none"
  ) {
    return "native checkbox/radio";
  }
  if (!leaf) return null;
  const prop = PIXEL_ONLY.find((p) => el.style[p] !== "none" && el.style[p] !== "");
  return prop ? prop : null;
}

/** Every raster the converter will ask for, skipping what it won't draw (opacity 0, below the height cap). */
export function rasterPlan(raw: RawSnapshot, maxHeight: number): RasterRequest[] {
  const snap = bakeScale(raw);
  const parents = new Set(snap.nodes.map((n) => n.parent));
  const skipped = new Set<number>();
  const out: RasterRequest[] = [];
  for (const n of snap.nodes) {
    if (n.kind !== "element") continue;
    if ((n.parent !== null && skipped.has(n.parent)) || Number.parseFloat(n.style.opacity) === 0) {
      skipped.add(n.id);
      continue;
    }
    if (n.rect.y >= maxHeight || n.rect.width < 1 || n.rect.height < 1) continue;
    if (islandReason(n, !parents.has(n.id))) {
      skipped.add(n.id); // an island's descendants are inside its pixels
      out.push({ key: `el:${n.id}`, kind: "element", id: n.id, rect: n.rect });
      continue;
    }
    if (n.style.visibility !== "visible") continue;
    elementLayers(n).forEach((l, i) => {
      if (l.kind === "tile")
        out.push({ key: `tile:${n.id}:${i}`, kind: "tile", css: l.css, width: l.width, height: l.height });
    });
  }
  return out;
}

export function elementLayers(el: RawElement) {
  const { width, height } = paintSize(el);
  const s = el.style;
  return backgroundLayers(
    {
      image: s["background-image"],
      size: s["background-size"],
      repeat: s["background-repeat"],
      position: s["background-position"],
    },
    width,
    height,
  );
}
