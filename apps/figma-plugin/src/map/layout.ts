import type { Layout } from "@w2f/ir";

/** IR stack → Figma Auto Layout frame props (applied in build.ts, which owns node creation). */
export interface StackProps {
  layoutMode: "HORIZONTAL" | "VERTICAL";
  layoutWrap: "NO_WRAP" | "WRAP";
  itemSpacing: number;
  counterAxisSpacing: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems: "MIN" | "CENTER" | "MAX" | "BASELINE";
  itemReverseZIndex: boolean;
  strokesIncludedInLayout: boolean;
}

export function stackProps(l: Extract<Layout, { mode: "stack" }>, hasStroke: boolean): StackProps {
  return {
    layoutMode: l.direction === "horizontal" ? "HORIZONTAL" : "VERTICAL",
    layoutWrap: l.wrap ? "WRAP" : "NO_WRAP",
    itemSpacing: l.gap,
    counterAxisSpacing: l.crossGap,
    paddingTop: l.padding.top,
    paddingRight: l.padding.right,
    paddingBottom: l.padding.bottom,
    paddingLeft: l.padding.left,
    primaryAxisAlignItems:
      l.justify === "center"
        ? "CENTER"
        : l.justify === "end"
          ? "MAX"
          : l.justify === "space-between"
            ? "SPACE_BETWEEN"
            : "MIN",
    counterAxisAlignItems:
      l.align === "center"
        ? "CENTER"
        : l.align === "end"
          ? "MAX"
          : l.align === "baseline"
            ? "BASELINE"
            : "MIN",
    itemReverseZIndex: l.reverse,
    strokesIncludedInLayout: hasStroke,
  };
}

/** IR grid → Figma GRID frame props. Track sizes apply as FIXED in build.ts. */
export interface GridProps {
  columnCount: number;
  rowCount: number;
  columnSizes: number[];
  rowSizes: number[];
  columnGap: number;
  rowGap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

export function gridProps(l: Extract<Layout, { mode: "grid" }>): GridProps {
  return {
    columnCount: l.columns.length,
    rowCount: l.rows.length,
    columnSizes: l.columns.map((c) => c.size),
    rowSizes: l.rows.map((r) => r.size),
    columnGap: l.columnGap,
    rowGap: l.rowGap,
    paddingTop: l.padding.top,
    paddingRight: l.padding.right,
    paddingBottom: l.padding.bottom,
    paddingLeft: l.padding.left,
  };
}

export type SizingProp = "FIXED" | "HUG" | "FILL";

/** IR sizing → Figma layoutSizing (set after appendChild). */
export function sizingProp(s: "fixed" | "hug" | "fill"): SizingProp {
  return s === "fill" ? "FILL" : s === "hug" ? "HUG" : "FIXED";
}

/** What a child needs inside an Auto Layout parent. Null under `none`: those children are already
 * placed at absolute coordinates, and Figma rejects layout props there (FIGMA_BUILD_FAILED). */
export function childLayout(
  child: {
    sizing: { horizontal: "fixed" | "hug" | "fill"; vertical: "fixed" | "hug" | "fill" };
    position: string;
    /** Text only: its IR resize mode. */
    autoResize?: "width-and-height" | "height";
  },
  parentMode: "none" | "stack" | "grid",
): {
  horizontal: SizingProp;
  vertical: SizingProp;
  absolute: boolean;
  fixWidth: boolean;
  fixHeight: boolean;
} | null {
  if (parentMode === "none") return null;
  // Text keeps its own resize mode: Figma's glyphs run a pixel or two wider than the browser's, so
  // FIXED at the measured width wraps the last letter into a clipped second line ("Attendanc").
  // Single-line text hugs; multi-line text keeps its width and grows in height.
  const text = child.autoResize !== undefined;
  const horizontal =
    text && child.sizing.horizontal === "fixed" && child.autoResize === "width-and-height"
      ? "hug"
      : child.sizing.horizontal;
  const vertical = text && child.sizing.vertical === "fixed" ? "hug" : child.sizing.vertical;
  return {
    horizontal: sizingProp(horizontal),
    vertical: sizingProp(vertical),
    absolute: child.position === "absolute" || child.position === "fixed",
    fixWidth: horizontal === "fixed",
    fixHeight: vertical === "fixed",
  };
}
