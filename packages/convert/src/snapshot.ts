/**
 * RawSnapshot: the contract between the in-page collector (packages/capture/src/collector)
 * and snapshotToIR. The collector only records facts; every interpretation happens in convert.
 * This module must stay dependency-free: it is bundled into the page.
 */

export interface RawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Computed-style properties the collector records (kebab-case, as getPropertyValue expects). */
export const STYLE_PROPS = [
  "display",
  "visibility",
  "opacity",
  "position",
  "white-space",
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "vertical-align",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "border-image-source",
  "box-shadow",
  "text-shadow",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "mix-blend-mode",
  "overflow-x",
  "overflow-y",
  "filter",
  "backdrop-filter",
  "transform",
  "rotate",
  "scale",
  "translate",
  "z-index",
  "outline-style",
  "outline-width",
  "clip-path",
  "mask-image",
  "appearance",
  "object-fit",
  "object-position",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-content",
  "column-gap",
  "row-gap",
  "order",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column-start",
  "grid-column-end",
  "grid-row-start",
  "grid-row-end",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "box-sizing",
  "width",
  "height",
] as const;
export type StyleProp = (typeof STYLE_PROPS)[number];

/** Recorded as `rgba(r, g, b, a)` in sRGB after in-page normalization (handles oklch, lab, color()). */
export const COLOR_PROPS = [
  "background-color",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
] as const satisfies readonly StyleProp[];

/** Properties with colors embedded in a larger value; each color function inside is normalized the same way. */
export const EMBEDDED_COLOR_PROPS = [
  "box-shadow",
  "text-shadow",
  "background-image",
] as const satisfies readonly StyleProp[];

/** Same cap as the IR's VectorNode.svg. */
export const MAX_SVG_CHARS = 500_000;

export interface RawElement {
  kind: "element";
  id: number;
  parent: number | null;
  tag: string;
  /** Border box in page coordinates (scroll offset applied). */
  rect: RawRect;
  style: Record<StyleProp, string>;
  attrs: { id?: string; className?: string; ariaLabel?: string; testId?: string; type?: string };
  /** Untransformed layout size (offsetWidth/Height); only recorded when transform/rotate/scale is set. */
  layoutSize?: { width: number; height: number };
  /** `<img>`: the source the browser picked (currentSrc) and its intrinsic size in CSS px. */
  image?: { src: string; width: number; height: number; state: "loaded" | "failed" | "pending" };
  /** Inline `<svg>`: sanitized markup with computed paint inlined. Absent when over `MAX_SVG_CHARS`. */
  svg?: string;
}

export interface RawText {
  kind: "text";
  id: number;
  parent: number;
  /**
   * Text after white-space collapsing per the parent's `white-space`, not trimmed: whether a space
   * separates it from its inline neighbors matters once a paragraph is merged into one text node.
   */
  text: string;
  /**
   * One rect per line fragment (Range.getClientRects), page coordinates. Empty only for a
   * whitespace-only node between inline siblings (a space at a line wrap has no rect).
   */
  lines: RawRect[];
}

export type RawNode = RawElement | RawText;

export interface RawSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number };
  documentSize: { width: number; height: number };
  /** Pre-order: every parent precedes its children. */
  nodes: RawNode[];
  /** True when the collector stopped at its node cap. */
  truncated: boolean;
}
