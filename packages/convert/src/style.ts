import { BlendMode, type BoxNode, type Effect, type Paint } from "@w2f/ir";
import { parseBorder, parseBoxShadow, parseFilter, parseRadius, parseTransform } from "./box.ts";
import { parseColor, px, round2 } from "./css.ts";
import { elementLayers, paintSize } from "./rasters.ts";
import type { Report } from "./report.ts";
import type { RawElement, StyleProp } from "./snapshot.ts";

type BoxStyle = Pick<
  BoxNode,
  "bounds" | "fills" | "stroke" | "radius" | "effects" | "blendMode" | "clip" | "rotation"
>;

export interface StyleContext {
  nodeId: string;
  report: Report;
  /** Raster key → asset id, from the capture step (see rasterPlan). */
  rasters: Record<string, string>;
}

const rect = (x: number, y: number, width: number, height: number) => ({
  x: round2(x),
  y: round2(y),
  width: round2(Math.max(0, width)),
  height: round2(Math.max(0, height)),
});

const styleOf = (el: RawElement) => (p: string) => el.style[p as StyleProp] ?? "";

function blendMode(el: RawElement, ctx: StyleContext): BoxNode["blendMode"] {
  const v = el.style["mix-blend-mode"];
  const parsed = BlendMode.safeParse(v);
  if (parsed.success) return parsed.data;
  if (v) ctx.report.add("UNSUPPORTED_CSS", `mix-blend-mode ${v}`, ctx.nodeId, "skipped");
  return "normal";
}

/** background-color + background-image layers → fills, bottom-most first. */
function fills(el: RawElement, ctx: StyleContext, withColor: boolean): Paint[] {
  const out: Paint[] = [];
  const color = withColor ? parseColor(el.style["background-color"]) : null;
  if (color) out.push({ type: "solid", color });
  const layers = elementLayers(el);
  // CSS lists layers top-most first; walk bottom-up so `out` stays bottom-most first.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer) continue;
    if (layer.kind === "unsupported") {
      ctx.report.add("UNSUPPORTED_CSS", layer.reason, ctx.nodeId, "skipped");
      continue;
    }
    if (layer.approximated) ctx.report.add("UNSUPPORTED_CSS", layer.approximated, ctx.nodeId, "approximated");
    if (layer.kind === "paint") {
      out.push(layer.paint);
      continue;
    }
    const assetId = ctx.rasters[`tile:${el.id}:${i}`];
    if (!assetId) {
      ctx.report.add(
        "UNSUPPORTED_CSS",
        "tiled gradient pattern (no tile was rendered)",
        ctx.nodeId,
        "skipped",
      );
      continue;
    }
    out.push({
      type: "image",
      assetId,
      scale: "tile",
      position: { x: 0, y: 0 },
      tileSize: { width: round2(layer.width), height: round2(layer.height) },
    });
  }
  return out;
}

function effects(el: RawElement, ctx: StyleContext): Effect[] {
  const layer = parseFilter(el.style.filter, "layer");
  const backdrop = parseFilter(el.style["backdrop-filter"], "backdrop");
  for (const u of [...layer.unsupported, ...backdrop.unsupported]) {
    ctx.report.add("UNSUPPORTED_CSS", u, ctx.nodeId, "skipped");
  }
  return [...parseBoxShadow(el.style["box-shadow"]), ...layer.effects, ...backdrop.effects];
}

/**
 * Geometry and paint of one element's box. `leaf`: the box has no children in the IR (only then can
 * it carry a rotation — a rotated frame would rotate children Figma already has at measured spots).
 */
export function boxStyle(
  el: RawElement,
  ctx: StyleContext,
  opts: { leaf: boolean; visible: boolean; withColor: boolean },
): BoxStyle {
  const style = styleOf(el);
  const size = paintSize(el);
  const { radius, elliptical } = parseRadius(style, size.width, size.height);
  const clip = el.style["overflow-x"] !== "visible" || el.style["overflow-y"] !== "visible";
  if (clip && (el.style["overflow-x"] === "visible") !== (el.style["overflow-y"] === "visible")) {
    ctx.report.add(
      "UNSUPPORTED_CSS",
      "overflow clipped on one axis only; both axes clip",
      ctx.nodeId,
      "approximated",
    );
  }

  let bounds = rect(el.rect.x, el.rect.y, el.rect.width, el.rect.height);
  let rotation: number | undefined;
  const t = parseTransform(el.style.transform, el.style.rotate, el.style.scale);
  if (t.unsupported) ctx.report.add("UNSUPPORTED_CSS", t.unsupported, ctx.nodeId, "approximated");
  if (Math.abs(t.scaleX - t.scaleY) > 0.01) {
    ctx.report.add(
      "UNSUPPORTED_CSS",
      "non-uniform scale transform: borders, radii, shadows and text use the mean scale",
      ctx.nodeId,
      "approximated",
    );
  }
  if (t.rotation !== 0) {
    if (opts.leaf && el.layoutSize) {
      // The measured rect is the rotated box's bounding box; the box itself shares its center.
      const { width: w, height: h } = el.layoutSize; // scale already baked in (bakeScale)
      const cx = el.rect.x + el.rect.width / 2;
      const cy = el.rect.y + el.rect.height / 2;
      bounds = rect(cx - w / 2, cy - h / 2, w, h);
      rotation = t.rotation;
    } else {
      ctx.report.add(
        "UNSUPPORTED_CSS",
        "rotated element with children drawn unrotated",
        ctx.nodeId,
        "approximated",
      );
    }
  }

  const base = { bounds, radius, clip, ...(rotation !== undefined ? { rotation } : {}) };
  if (!opts.visible) return { ...base, fills: [], effects: [], blendMode: "normal" };

  if (elliptical)
    ctx.report.add("UNSUPPORTED_CSS", "elliptical border-radius drawn circular", ctx.nodeId, "approximated");
  const border = parseBorder(style);
  if (border.mixedColors) {
    ctx.report.add(
      "BORDER_COLORS_MIXED",
      "per-side border colors; the widest side's color is used",
      ctx.nodeId,
      "approximated",
    );
  }
  if (border.approximated) ctx.report.add("UNSUPPORTED_CSS", border.approximated, ctx.nodeId, "approximated");
  if (el.style["outline-style"] !== "none" && (px(el.style["outline-width"]) ?? 0) > 0) {
    ctx.report.add("UNSUPPORTED_CSS", "outline", ctx.nodeId, "skipped");
  }
  return {
    ...base,
    fills: fills(el, ctx, opts.withColor),
    ...(border.stroke ? { stroke: border.stroke } : {}),
    effects: effects(el, ctx),
    blendMode: blendMode(el, ctx),
  };
}

/**
 * A raster island: the element's screenshot crop as an image fill. The crop already contains its
 * background, border, inset shadows, filters and opacity; only what lies outside the box is kept.
 */
export function islandStyle(el: RawElement, ctx: StyleContext, reason: string): BoxStyle {
  const { radius } = parseRadius(styleOf(el), el.rect.width, el.rect.height);
  const outer = parseBoxShadow(el.style["box-shadow"]).filter((e) => e.type === "shadow" && !e.inset);
  const assetId = ctx.rasters[`el:${el.id}`];
  const base = {
    bounds: rect(el.rect.x, el.rect.y, el.rect.width, el.rect.height),
    radius,
    clip: false,
    effects: outer,
    blendMode: "normal" as const,
  };
  if (!assetId) {
    ctx.report.add(
      "IMAGE_FAILED",
      `${reason}: no pixels were captured; grey placeholder`,
      ctx.nodeId,
      "placeholder",
    );
    return { ...base, fills: [{ type: "solid", color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } }] };
  }
  ctx.report.add("RASTERIZED", `${reason} drawn as an image`, ctx.nodeId, "rasterized");
  return { ...base, fills: [{ type: "image", assetId, scale: "stretch", position: { x: 0.5, y: 0.5 } }] };
}
