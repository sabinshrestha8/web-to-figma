import type { BoxNode, Layout, Node, TextNode } from "@w2f/ir";

/** Minimal subset of a Figma REST `nodes` response used for drift comparison. */
export interface FigmaRestNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: { type: string; color?: { r: number; g: number; b: number; a: number }; opacity?: number }[];
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

function fillsOf(n: FigmaRestNode) {
  const out: { type: "solid"; color: { r: number; g: number; b: number; a: number } }[] = [];
  for (const f of n.fills ?? []) {
    if (f.type !== "SOLID" || !f.color) continue;
    out.push({
      type: "solid",
      color: { r: f.color.r, g: f.color.g, b: f.color.b, a: f.opacity ?? f.color.a ?? 1 },
    });
  }
  return out;
}

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
  blendMode: "normal" as const,
  effects: [],
  position: (n.layoutPositioning === "ABSOLUTE" ? "absolute" : "flow") as "flow" | "absolute",
  sizing: { horizontal: sizingOf(n.layoutSizingHorizontal), vertical: sizingOf(n.layoutSizingVertical) },
  source: { tag: n.type === "TEXT" ? "#text" : "div", selector: n.name },
});

function convertText(n: FigmaRestNode, dx: number, dy: number): TextNode {
  const characters = n.characters ?? "";
  const fill = (n.fills ?? []).find((f) => f.type === "SOLID" && f.color);
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
          color: fill?.color
            ? { r: fill.color.r, g: fill.color.g, b: fill.color.b, a: fill.opacity ?? fill.color.a ?? 1 }
            : { r: 0, g: 0, b: 0, a: 1 },
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
  return {
    ...base(n, dx, dy),
    type: "box",
    fills: fillsOf(n),
    radius: [0, 0, 0, 0],
    clip: false,
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
