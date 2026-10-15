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

/**
 * The part of a raster island on the page, or null when none is: the browser shows nothing past the
 * edge (a reCAPTCHA badge parked off-screen at the right), so neither does the frame. Rotated islands
 * are left whole.
 */
export function islandOnPage(el: RawElement, page: { width: number; height: number }): RawElement | null {
  if (el.layoutSize) return el;
  const { x, y, width, height } = el.rect;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(page.width, x + width);
  const y1 = Math.min(page.height, y + height);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  if (x0 === x && y0 === y && x1 === x + width && y1 === y + height) return el;
  return { ...el, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

const REPLACED = new Set(["img", "svg", "canvas", "video", "iframe", "embed", "object"]);
const PIXEL_ONLY = ["clip-path", "mask-image", "border-image-source"] as const;

/**
 * Why an element is drawn as a screenshot crop (a "raster island"), or null.
 * Replaced content can't be rebuilt from DOM facts (images and svgs: only when not decoded or too
 * big); clip-path/mask/border-image can't be expressed in Figma. The latter only on leaves (`leaf`:
 * no child nodes), so text inside never becomes pixels.
 */
export function islandReason(
  el: RawElement,
  leaf: boolean,
  hasImage: (key: string) => boolean,
): string | null {
  if (el.style.visibility !== "visible") return null;
  if (el.tag === "img") {
    if (el.image?.state === "failed") return null; // a placeholder: the page shows no image either
    if (el.image?.state === "pending") return "<img> still loading at capture time";
    return el.image && hasImage(el.image.src) ? null : "<img> whose image could not be decoded";
  }
  if (el.tag === "svg") return el.svg ? null : "<svg> markup over the size cap";
  if (REPLACED.has(el.tag)) return `<${el.tag}> content`;
  if (
    el.tag === "input" &&
    /^(checkbox|radio)$/.test(el.attrs.type ?? "") &&
    el.style.appearance !== "none"
  ) {
    return "native checkbox/radio";
  }
  if (!leaf) return null;
  // Icon fonts (Font Awesome's <i class="fa-…">) draw their glyph in ::before; Figma has no such font.
  if (el.pseudo) return "::before/::after content, such as an icon font glyph";
  const prop = PIXEL_ONLY.find((p) => el.style[p] !== "none" && el.style[p] !== "");
  return prop ? prop : null;
}

/** Every raster the converter will ask for, skipping what it won't draw (opacity 0, below the height cap). */
export function rasterPlan(
  raw: RawSnapshot,
  maxHeight: number,
  hasImage: (key: string) => boolean,
): RasterRequest[] {
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
    if (islandReason(n, !parents.has(n.id), hasImage)) {
      skipped.add(n.id); // an island's descendants are inside its pixels
      const shown = islandOnPage(n, snap.documentSize);
      if (shown) out.push({ key: `el:${n.id}`, kind: "element", id: n.id, rect: shown.rect });
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
