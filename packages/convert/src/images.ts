import type { Paint } from "@w2f/ir";
import { parseLength, round4, splitTop } from "./css.ts";
import { bakeScale } from "./scale.ts";
import type { RawElement, RawRect, RawSnapshot } from "./snapshot.ts";

type ImagePaint = Extract<Paint, { type: "image" }>;

/** An image the capture step decoded: its asset and the source's intrinsic size in px. */
export interface ImageAsset {
  assetId: string;
  width: number;
  height: number;
}

/**
 * Images the capture step must fetch and decode for the converter. `width`/`height` is the largest
 * size it is drawn at (CSS px): vector sources (SVG-as-img, inline svg fallbacks) are rendered there.
 * Keys: the URL for `<img>` and `url()` backgrounds, `svg:<id>` for an inline svg's fallback PNG.
 */
export type ImageRequest =
  | { key: string; kind: "url"; src: string; width: number; height: number }
  | { key: string; kind: "svg"; markup: string; width: number; height: number };

/** `url("…")` layers of a computed background-image, top-most first (null for gradients). */
export function backgroundUrls(value: string): (string | null)[] {
  if (value === "none" || value === "") return [];
  return splitTop(value, ",").map((layer) => /^url\(\s*(["']?)(.*)\1\s*\)$/s.exec(layer.trim())?.[2] ?? null);
}

export function imagePlan(raw: RawSnapshot, maxHeight: number): ImageRequest[] {
  const out = new Map<string, ImageRequest>();
  const want = (src: string, w: number, h: number) => {
    const prev = out.get(src);
    out.set(src, {
      key: src,
      kind: "url",
      src,
      width: Math.max(w, prev?.width ?? 0),
      height: Math.max(h, prev?.height ?? 0),
    });
  };
  for (const n of bakeScale(raw).nodes) {
    if (n.kind !== "element" || n.rect.y >= maxHeight || n.rect.width < 1 || n.rect.height < 1) continue;
    if (n.image?.state === "loaded" && n.image.src) want(n.image.src, n.rect.width, n.rect.height);
    if (n.svg) {
      const key = `svg:${n.id}`;
      out.set(key, { key, kind: "svg", markup: n.svg, width: n.rect.width, height: n.rect.height });
    }
    for (const url of backgroundUrls(n.style["background-image"])) {
      if (url) want(url, n.rect.width, n.rect.height);
    }
  }
  return [...out.values()];
}

/** Where an image is drawn relative to its box (box-relative px). */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EPS = 0.5;

/**
 * `position` resolved against the free space on each axis, as object-position and
 * background-position do: percentages of (box − image), lengths as offsets. Null when unparseable.
 */
function offset(position: string, box: RawRect, w: number, h: number): { x: number; y: number } | null {
  const [px = "50%", py = "50%"] = splitTop(position, " ");
  const x = parseLength(px, box.width - w);
  const y = parseLength(py, box.height - h);
  return x === null || y === null ? null : { x, y };
}

/** object-fit + object-position → the rect the image is drawn in. */
export function objectFitRect(
  fit: string,
  position: string,
  box: RawRect,
  image: { width: number; height: number },
): Placement | null {
  const contain = Math.min(box.width / image.width, box.height / image.height);
  const scale =
    fit === "cover"
      ? Math.max(box.width / image.width, box.height / image.height)
      : fit === "contain"
        ? contain
        : fit === "none"
          ? 1
          : fit === "scale-down"
            ? Math.min(1, contain)
            : null; // fill
  const width = scale === null ? box.width : image.width * scale;
  const height = scale === null ? box.height : image.height * scale;
  const at = offset(position, box, width, height);
  return at && { ...at, width, height };
}

/** background-size (+ position) of one url() layer → the rect of its first tile. */
export function backgroundRect(
  size: string,
  position: string,
  box: RawRect,
  image: { width: number; height: number },
): Placement | null {
  let width: number | null;
  let height: number | null;
  if (size === "cover" || size === "contain") {
    const pick = size === "cover" ? Math.max : Math.min;
    const s = pick(box.width / image.width, box.height / image.height);
    width = image.width * s;
    height = image.height * s;
  } else {
    const [sw = "auto", sh = "auto"] = splitTop(size, " ");
    width = sw === "auto" ? null : parseLength(sw, box.width);
    height = sh === "auto" ? null : parseLength(sh, box.height);
    if (width === null && height === null) [width, height] = [image.width, image.height];
    else if (width === null && sw === "auto" && height !== null)
      width = (height * image.width) / image.height;
    else if (height === null && sh === "auto" && width !== null)
      height = (width * image.height) / image.width;
  }
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  const at = offset(position, box, width, height);
  return at && { ...at, width, height };
}

/**
 * A drawn image rect → an IR image paint for a w×h box, or why it can only be approximated.
 * Figma fills the whole layer: the image may overflow (crop) but never leave part of it empty.
 */
export function placementPaint(
  assetId: string,
  r: Placement,
  w: number,
  h: number,
): { paint: ImagePaint; approximated?: string } {
  const centered = { x: 0.5, y: 0.5 };
  const covers = r.x <= EPS && r.y <= EPS && r.x + r.width >= w - EPS && r.y + r.height >= h - EPS;
  if (covers) {
    const exact = Math.abs(r.width - w) < EPS && Math.abs(r.height - h) < EPS;
    if (exact) return { paint: { type: "image", assetId, scale: "stretch", position: centered } };
    const isCenter =
      Math.abs(r.x - (w - r.width) / 2) < EPS &&
      Math.abs(r.y - (h - r.height) / 2) < EPS &&
      (Math.abs(r.width - w) < EPS || Math.abs(r.height - h) < EPS);
    if (isCenter) return { paint: { type: "image", assetId, scale: "cover", position: centered } };
    const crop = {
      x: round4(-r.x / r.width) + 0, // + 0 turns -0 into 0
      y: round4(-r.y / r.height) + 0,
      width: round4(w / r.width),
      height: round4(h / r.height),
    };
    return { paint: { type: "image", assetId, scale: "cover", position: centered, crop } };
  }
  const paint: ImagePaint = { type: "image", assetId, scale: "contain", position: centered };
  const inside = r.x >= -EPS && r.y >= -EPS && r.x + r.width <= w + EPS && r.y + r.height <= h + EPS;
  const fitsAxis = Math.abs(r.width - w) < EPS || Math.abs(r.height - h) < EPS;
  if (inside && fitsAxis) {
    const centeredHere = Math.abs(r.x - (w - r.width) / 2) < EPS && Math.abs(r.y - (h - r.height) / 2) < EPS;
    return centeredHere ? { paint } : { paint, approximated: "off-center contained image drawn centered" };
  }
  return { paint, approximated: "image that leaves part of its box empty drawn fitted to the box" };
}

/** `<img>` → its image paint (object-fit/position) in the content box. Null when it was not decoded. */
export function imgPaint(
  el: RawElement,
  asset: ImageAsset | undefined,
  box: RawRect,
): { paint: ImagePaint; approximated?: string } | null {
  if (!asset || !el.image) return null;
  // The element's natural size is density-corrected (srcset 2x); the asset's is in image pixels.
  const intrinsic =
    el.image.width > 0 && el.image.height > 0 ? el.image : { width: asset.width, height: asset.height };
  const r = objectFitRect(el.style["object-fit"], el.style["object-position"], box, intrinsic);
  if (!r) {
    return {
      paint: { type: "image", assetId: asset.assetId, scale: "cover", position: { x: 0.5, y: 0.5 } },
      approximated: `object-position "${el.style["object-position"]}" drawn centered`,
    };
  }
  return placementPaint(asset.assetId, r, box.width, box.height);
}
