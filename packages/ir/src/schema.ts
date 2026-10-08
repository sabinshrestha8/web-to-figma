import { z } from "zod";
import { Diagnostic } from "./diagnostics.ts";

/** Current IR version. Minor = additive optional fields; major = breaking, needs a migration. */
export const SCHEMA_VERSION = "1.3";
// 1.1: optional `tileSize` on image paints.
// 1.2: diagnostic code SCROLL_CONTAINER_EXPANDED.
// 1.3: optional `crop` on image paints, optional `fallback` raster on vector nodes.

// All lengths are CSS px. Colors are sRGB floats 0–1.
const num = z.number().finite();
const nonNeg = num.nonnegative();
const unit = num.min(0).max(1);
const int = z.number().int();

export const Rect = z.object({ x: num, y: num, width: nonNeg, height: nonNeg });
export type Rect = z.infer<typeof Rect>;
export const Sides = z.object({ top: nonNeg, right: nonNeg, bottom: nonNeg, left: nonNeg });
export const RGBA = z.object({ r: unit, g: unit, b: unit, a: unit });
export type RGBA = z.infer<typeof RGBA>;
export const Point = z.object({ x: unit, y: unit }); // relative to the node box

/** sha256 hex of the asset bytes; doubles as dedupe key. */
export const AssetId = z.string().regex(/^[0-9a-f]{64}$/, "expected sha256 hex");

const ColorStop = z.object({ position: unit, color: RGBA });

export const Paint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: RGBA }),
  /** angle in degrees, CSS convention: 0 = towards top, clockwise. */
  z.object({ type: z.literal("linear"), angle: num, stops: z.array(ColorStop).min(2) }),
  z.object({
    type: z.literal("radial"),
    center: Point,
    radius: z.object({ x: nonNeg, y: nonNeg }), // fraction of box width/height
    stops: z.array(ColorStop).min(2),
  }),
  z.object({
    type: z.literal("image"),
    assetId: AssetId,
    scale: z.enum(["cover", "contain", "stretch", "tile", "none"]),
    position: Point, // object-position / background-position as a fraction
    /** CSS px size of one tile when scale is "tile" (the asset may be denser, e.g. 2× on retina). */
    tileSize: z.object({ width: num.positive(), height: num.positive() }).optional(),
    /**
     * The part of the image visible in the box, as fractions of the image (x, y, width, height).
     * Set when `scale` alone can't say it: stretch, or cover/none at an off-center position.
     */
    crop: z.object({ x: num, y: num, width: num.positive(), height: num.positive() }).optional(),
  }),
]);
export type Paint = z.infer<typeof Paint>;

export const Stroke = z.object({
  color: RGBA,
  weights: Sides,
  style: z.enum(["solid", "dashed", "dotted"]),
});
export type Stroke = z.infer<typeof Stroke>;

export const Effect = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("shadow"),
    inset: z.boolean(),
    offset: z.object({ x: num, y: num }),
    blur: nonNeg,
    spread: num,
    color: RGBA,
  }),
  z.object({ type: z.literal("layer-blur"), radius: nonNeg }),
  z.object({ type: z.literal("background-blur"), radius: nonNeg }),
]);
export type Effect = z.infer<typeof Effect>;

export const BlendMode = z.enum([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

export const Sizing = z.enum(["fixed", "hug", "fill"]);

/** Verified, target-neutral layout. CSS facts never appear here (see docs/mapping.md). */
export const Layout = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("stack"),
    direction: z.enum(["horizontal", "vertical"]),
    reverse: z.boolean(),
    wrap: z.boolean(),
    gap: nonNeg,
    crossGap: nonNeg,
    padding: Sides,
    justify: z.enum(["start", "center", "end", "space-between"]),
    align: z.enum(["start", "center", "end", "baseline"]),
  }),
  z.object({
    mode: z.literal("grid"),
    columns: z.array(z.object({ size: nonNeg })).min(1),
    rows: z.array(z.object({ size: nonNeg })).min(1),
    columnGap: nonNeg,
    rowGap: nonNeg,
    padding: Sides,
  }),
]);
export type Layout = z.infer<typeof Layout>;

const base = {
  id: z.string().min(1),
  name: z.string(),
  /** Absolute page coordinates of the untransformed box. */
  bounds: Rect,
  /** Degrees, clockwise, around the box center. */
  rotation: num.optional(),
  opacity: unit,
  blendMode: BlendMode,
  effects: z.array(Effect),
  position: z.enum(["flow", "absolute", "fixed"]),
  sizing: z.object({ horizontal: Sizing, vertical: Sizing }),
  /** Only meaningful when the parent layout is grid. 0-based. */
  gridCell: z.object({ row: int.nonnegative(), column: int.nonnegative() }).optional(),
  source: z.object({ tag: z.string(), selector: z.string(), component: z.string().optional() }),
};

export const TextStyle = z.object({
  families: z.array(z.string().min(1)).min(1), // CSS font stack, in priority order
  weight: int.min(1).max(1000),
  italic: z.boolean(),
  size: num.positive(),
  lineHeight: z.union([num.positive(), z.literal("auto")]),
  letterSpacing: num,
  transform: z.enum(["none", "uppercase", "lowercase", "capitalize"]),
  decoration: z.enum(["none", "underline", "line-through"]),
  color: RGBA, // text gradients are unsupported in V1
});
export type TextStyle = z.infer<typeof TextStyle>;

export const TextRun = z.object({ start: int.nonnegative(), end: int.positive(), style: TextStyle });
export type TextRun = z.infer<typeof TextRun>;

export const TextNode = z
  .object({
    ...base,
    type: z.literal("text"),
    characters: z.string().min(1),
    runs: z.array(TextRun).min(1),
    align: z.enum(["left", "center", "right", "justify"]),
    autoResize: z.enum(["width-and-height", "height"]),
    lineCount: int.positive(),
  })
  .superRefine((t, ctx) => {
    // Runs must tile [0, characters.length) exactly, in order.
    let at = 0;
    for (const [i, r] of t.runs.entries()) {
      if (r.start !== at || r.end <= r.start) {
        ctx.addIssue({ code: "custom", path: ["runs", i], message: `run must start at ${at}` });
        return;
      }
      at = r.end;
    }
    if (at !== t.characters.length) {
      ctx.addIssue({ code: "custom", path: ["runs"], message: "runs must cover all characters" });
    }
  });
export type TextNode = z.infer<typeof TextNode>;

export const VectorNode = z.object({
  ...base,
  type: z.literal("vector"),
  svg: z.string().min(1).max(500_000),
  /** PNG of the same markup, built instead if Figma rejects the SVG. */
  fallback: AssetId.optional(),
});
export type VectorNode = z.infer<typeof VectorNode>;

export interface BoxNode extends z.infer<typeof BoxShape> {
  children: Node[];
}
export type Node = BoxNode | TextNode | VectorNode;

const BoxShape = z.object({
  ...base,
  type: z.literal("box"),
  fills: z.array(Paint), // bottom-most first
  stroke: Stroke.optional(),
  radius: z.tuple([nonNeg, nonNeg, nonNeg, nonNeg]), // tl, tr, br, bl
  clip: z.boolean(),
  layout: Layout,
});

export const BoxNode: z.ZodType<BoxNode> = BoxShape.extend({
  children: z.array(z.lazy(() => Node)),
});
export const Node: z.ZodType<Node> = z.union([BoxNode, TextNode, VectorNode]);

export const AssetMeta = z.object({
  mime: z.enum(["image/png", "image/jpeg", "image/gif"]),
  width: int.positive(),
  height: int.positive(),
  byteLength: int.positive(),
});
export type AssetMeta = z.infer<typeof AssetMeta>;

export const Capture = z.object({
  id: z.string().min(1),
  url: z.url(),
  title: z.string(),
  viewport: z.object({ width: int.positive(), height: int.positive(), dpr: num.positive() }),
  root: BoxNode,
  screenshot: AssetId.optional(),
});
export type Capture = z.infer<typeof Capture>;

export const Document = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generator: z.object({ name: z.string(), version: z.string() }),
    captures: z.array(Capture).min(1),
    assets: z.record(AssetId, AssetMeta),
    diagnostics: z.array(Diagnostic),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    const need = (assetId: string, where: string) => {
      if (!(assetId in doc.assets)) {
        ctx.addIssue({ code: "custom", path: ["assets"], message: `${where}: unknown asset ${assetId}` });
      }
    };
    const visit = (n: Node) => {
      if (ids.has(n.id))
        ctx.addIssue({ code: "custom", path: ["captures"], message: `duplicate node id ${n.id}` });
      ids.add(n.id);
      if (n.type === "vector" && n.fallback) need(n.fallback, `node ${n.id}`);
      if (n.type !== "box") return;
      for (const p of n.fills) if (p.type === "image") need(p.assetId, `node ${n.id}`);
      for (const c of n.children) visit(c);
    };
    for (const c of doc.captures) {
      if (c.screenshot) need(c.screenshot, `capture ${c.id}`);
      visit(c.root);
    }
  });
export type Document = z.infer<typeof Document>;
