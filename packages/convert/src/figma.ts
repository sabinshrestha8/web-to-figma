import type { BoxNode, Effect, Layout, Node, Paint, Stroke, TextNode } from "@w2f/ir";

type FigmaColor = { r: number; g: number; b: number; a: number };
interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientStops?: { position: number; color: FigmaColor }[];
  /** Normalized to the node box: start, end, and the second (width) handle. */
  gradientHandlePositions?: { x: number; y: number }[];
  scaleMode?: string;
}

/** Minimal subset of a Figma REST `nodes` response used for drift comparison. */
export interface FigmaRestNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  strokeDashes?: number[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  clipsContent?: boolean;
  effects?: {
    type: string;
    visible?: boolean;
    radius?: number;
    spread?: number;
    color?: FigmaColor;
    offset?: { x: number; y: number };
  }[];
  blendMode?: string;
  opacity?: number;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
    textDecoration?: string;
  };
  children?: FigmaRestNode[];
  layoutMode?: string;
  layoutWrap?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutPositioning?: string;
  gridColumnCount?: number;
  gridRowCount?: number;
  gridColumnGap?: number;
  gridRowGap?: number;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const rgba = (c: FigmaColor, opacity = 1) => ({ r: c.r, g: c.g, b: c.b, a: (c.a ?? 1) * opacity });
const visible = <T extends { visible?: boolean }>(xs: T[] | undefined): T[] =>
  (xs ?? []).filter((x) => x.visible !== false);

const SCALE: Record<string, Extract<Paint, { type: "image" }>["scale"]> = {
  FILL: "cover",
  FIT: "contain",
  TILE: "tile",
  STRETCH: "stretch",
};

type Stop = { position: number; color: { r: number; g: number; b: number; a: number } };

/**
 * Drops the sub-stops the plugin adds to emulate CSS's premultiplied blending (paint.ts
 * premultipliedStops), so drift compares the stops the page declared. A stop is a sub-stop when it
 * lies on the premultiplied line between its neighbors. ponytail: a declared stop that happens to
 * lie on that line is dropped too (reported as fill drift).
 */
export function collapseStops(stops: Stop[]): Stop[] {
  const pre = (s: Stop) => [s.color.r * s.color.a, s.color.g * s.color.a, s.color.b * s.color.a, s.color.a];
  return stops.filter((s, i) => {
    const prev = stops[i - 1];
    const next = stops[i + 1];
    if (!prev || !next || next.position <= prev.position) return true;
    const t = (s.position - prev.position) / (next.position - prev.position);
    const [p, n, c] = [pre(prev), pre(next), pre(s)];
    return !c.every((v, k) => Math.abs((p[k] ?? 0) + ((n[k] ?? 0) - (p[k] ?? 0)) * t - v) <= 0.003);
  });
}

/** Figma paints → IR paints, as far as drift needs them. Image bytes are unknown: `assetId` is "". */
function paintOf(f: FigmaPaint, box: { width: number; height: number }): Paint | null {
  const opacity = f.opacity ?? 1;
  if (f.type === "SOLID" && f.color) return { type: "solid", color: rgba(f.color, opacity) };
  if (f.type === "IMAGE") {
    return {
      type: "image",
      assetId: "",
      scale: SCALE[f.scaleMode ?? ""] ?? "cover",
      position: { x: 0.5, y: 0.5 },
    };
  }
  const [h0, h1, h2] = f.gradientHandlePositions ?? [];
  const stops = collapseStops(
    (f.gradientStops ?? []).map((s) => ({ position: s.position, color: rgba(s.color, opacity) })),
  );
  if (!h0 || !h1 || stops.length < 2) return null;
  if (f.type === "GRADIENT_LINEAR") {
    // The handle direction in px is the CSS gradient direction: 0° = up, clockwise.
    const deg = (Math.atan2((h1.x - h0.x) * box.width, -(h1.y - h0.y) * box.height) * 180) / Math.PI;
    return { type: "linear", angle: Math.round(((deg % 360) + 360) % 360), stops };
  }
  if (f.type === "GRADIENT_RADIAL" && h2) {
    return {
      type: "radial",
      center: { x: h0.x, y: h0.y },
      radius: { x: Math.hypot(h1.x - h0.x, h1.y - h0.y), y: Math.hypot(h2.x - h0.x, h2.y - h0.y) },
      stops,
    };
  }
  return null;
}

function fillsOf(n: FigmaRestNode): Paint[] {
  const box = { width: n.absoluteBoundingBox?.width ?? 0, height: n.absoluteBoundingBox?.height ?? 0 };
  return visible(n.fills).flatMap((f) => paintOf(f, box) ?? []);
}

/** Inverse of the plugin's strokeProps: dash = 3× weight is dashed, 1× is dotted. */
function strokeOf(n: FigmaRestNode): Stroke | undefined {
  const s = visible(n.strokes).find((p) => p.type === "SOLID" && p.color);
  if (!s?.color) return undefined;
  const w = num(n.strokeWeight, 0);
  const weights = n.individualStrokeWeights ?? { top: w, right: w, bottom: w, left: w };
  if (weights.top + weights.right + weights.bottom + weights.left === 0) return undefined;
  const dash = n.strokeDashes?.[0];
  const max = Math.max(weights.top, weights.right, weights.bottom, weights.left);
  const style = dash === undefined ? "solid" : dash <= max + 0.01 ? "dotted" : "dashed";
  return { color: rgba(s.color, s.opacity ?? 1), weights, style };
}

function effectsOf(n: FigmaRestNode): Effect[] {
  return visible(n.effects).flatMap((e): Effect[] => {
    if ((e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.color) {
      return [
        {
          type: "shadow",
          inset: e.type === "INNER_SHADOW",
          offset: { x: e.offset?.x ?? 0, y: e.offset?.y ?? 0 },
          blur: num(e.radius, 0),
          spread: num(e.spread, 0),
          color: rgba(e.color),
        },
      ];
    }
    if (e.type === "LAYER_BLUR") return [{ type: "layer-blur", radius: num(e.radius, 0) }];
    if (e.type === "BACKGROUND_BLUR") return [{ type: "background-blur", radius: num(e.radius, 0) }];
    return [];
  });
}

const blendOf = (v: string | undefined): Node["blendMode"] =>
  !v || v === "NORMAL" || v === "PASS_THROUGH"
    ? "normal"
    : (v.toLowerCase().replace(/_/g, "-") as Node["blendMode"]);

function sizingOf(v: unknown): "fixed" | "hug" | "fill" {
  return v === "FILL" ? "fill" : v === "HUG" ? "hug" : "fixed";
}

function stackLayout(n: FigmaRestNode): Layout {
  const justify =
    n.primaryAxisAlignItems === "CENTER"
      ? "center"
      : n.primaryAxisAlignItems === "MAX"
        ? "end"
        : n.primaryAxisAlignItems === "SPACE_BETWEEN"
          ? "space-between"
          : "start";
  const align =
    n.counterAxisAlignItems === "CENTER"
      ? "center"
      : n.counterAxisAlignItems === "MAX"
        ? "end"
        : n.counterAxisAlignItems === "BASELINE"
          ? "baseline"
          : "start";
  return {
    mode: "stack",
    direction: n.layoutMode === "VERTICAL" ? "vertical" : "horizontal",
    reverse: false,
    wrap: n.layoutWrap === "WRAP",
    gap: num(n.itemSpacing, 0),
    crossGap: num(n.counterAxisSpacing, 0),
    padding: {
      top: num(n.paddingTop, 0),
      right: num(n.paddingRight, 0),
      bottom: num(n.paddingBottom, 0),
      left: num(n.paddingLeft, 0),
    },
    justify,
    align,
  };
}

function gridLayout(n: FigmaRestNode): Layout {
  const cols = Math.max(1, Math.floor(num(n.gridColumnCount, 1)));
  const rows = Math.max(1, Math.floor(num(n.gridRowCount, 1)));
  return {
    mode: "grid",
    columns: Array.from({ length: cols }, () => ({ size: 0 })),
    rows: Array.from({ length: rows }, () => ({ size: 0 })),
    columnGap: num(n.gridColumnGap, 0),
    rowGap: num(n.gridRowGap, 0),
    padding: {
      top: num(n.paddingTop, 0),
      right: num(n.paddingRight, 0),
      bottom: num(n.paddingBottom, 0),
      left: num(n.paddingLeft, 0),
    },
  };
}

const base = (n: FigmaRestNode, dx: number, dy: number) => ({
  id: `figma:${n.id}`,
  name: n.name,
  bounds: {
    x: (n.absoluteBoundingBox?.x ?? 0) + dx,
    y: (n.absoluteBoundingBox?.y ?? 0) + dy,
    width: Math.max(0, n.absoluteBoundingBox?.width ?? 0),
    height: Math.max(0, n.absoluteBoundingBox?.height ?? 0),
  },
  opacity: n.opacity ?? 1,
  blendMode: blendOf(n.blendMode),
  effects: effectsOf(n),
  position: (n.layoutPositioning === "ABSOLUTE" ? "absolute" : "flow") as "flow" | "absolute",
  sizing: { horizontal: sizingOf(n.layoutSizingHorizontal), vertical: sizingOf(n.layoutSizingVertical) },
  source: { tag: n.type === "TEXT" ? "#text" : "div", selector: n.name },
});

function convertText(n: FigmaRestNode, dx: number, dy: number): TextNode {
  const characters = n.characters ?? "";
  const fill = visible(n.fills).find((f) => f.type === "SOLID" && f.color);
  const alignRaw = n.style?.textAlignHorizontal;
  return {
    ...base(n, dx, dy),
    type: "text",
    characters: characters === "" ? " " : characters,
    runs: [
      {
        start: 0,
        end: Math.max(1, characters.length),
        style: {
          families: [n.style?.fontFamily ?? "Inter"],
          weight: Math.min(1000, Math.max(1, Math.round(num(n.style?.fontWeight, 400)))),
          italic: false,
          size: Math.max(1, num(n.style?.fontSize, 16)),
          lineHeight: "auto" as const,
          letterSpacing: num(n.style?.letterSpacing, 0),
          transform: "none" as const,
          decoration:
            n.style?.textDecoration === "UNDERLINE"
              ? ("underline" as const)
              : n.style?.textDecoration === "STRIKE_THROUGH"
                ? ("line-through" as const)
                : ("none" as const),
          color: fill?.color ? rgba(fill.color, fill.opacity ?? 1) : { r: 0, g: 0, b: 0, a: 1 },
        },
      },
    ],
    align:
      alignRaw === "CENTER"
        ? "center"
        : alignRaw === "RIGHT"
          ? "right"
          : alignRaw === "JUSTIFIED"
            ? "justify"
            : "left",
    autoResize: "width-and-height",
    lineCount: 1,
  };
}

function convertBox(n: FigmaRestNode, dx: number, dy: number): BoxNode {
  const stroke = strokeOf(n);
  const r = num(n.cornerRadius, 0);
  return {
    ...base(n, dx, dy),
    type: "box",
    fills: fillsOf(n),
    ...(stroke ? { stroke } : {}),
    radius: n.rectangleCornerRadii ?? [r, r, r, r],
    clip: n.clipsContent ?? false,
    layout:
      n.layoutMode === "GRID"
        ? gridLayout(n)
        : n.layoutMode === "HORIZONTAL" || n.layoutMode === "VERTICAL"
          ? stackLayout(n)
          : { mode: "none" },
    children: (n.children ?? []).map((c) => convertNode(c, dx, dy)),
  };
}

/**
 * A Figma REST subtree → IR nodes comparable with a production capture. TEXT becomes text;
 * everything else becomes a box (icons arrive as boxes with their fills: compared geometrically).
 * Coordinates are rebased by (dx, dy) so the frame origin coincides with the capture origin.
 */
export function convertNode(n: FigmaRestNode, dx = 0, dy = 0): Node {
  return n.type === "TEXT" ? convertText(n, dx, dy) : convertBox(n, dx, dy);
}
