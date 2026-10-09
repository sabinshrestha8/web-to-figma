import type { Layout, Node } from "@w2f/ir";
import { px, round2, splitTop } from "./css.ts";
import type { RawElement } from "./snapshot.ts";

/** Tolerances: a candidate reproduces measured rects within 1 px; gaps must be constant within 0.5 px. */
export const VERIFY_PX = 1;
export const GAP_PX = 0.5;

export interface LayoutItem {
  raw: RawElement | null; // null for merged text nodes
  node: Node;
  /** DOM order among the parent's children (before paint-order sorting). */
  domIndex: number;
}

export interface InferResult {
  layout: Layout;
  /** Children in final IR order (reversed for *-reverse). */
  children: Node[];
  /** nodeId → sizing + position to apply. */
  updates: Map<
    string,
    {
      horizontal: "fixed" | "hug" | "fill";
      vertical: "fixed" | "hug" | "fill";
      position: "flow" | "absolute" | "fixed";
      gridCell?: { row: number; column: number };
    }
  >;
  /** Set when falling back: why no candidate verified. */
  fallbackReason?: string;
}

const num = (v: string | undefined): number => (v === undefined ? 0 : (px(v) ?? 0));
const gapVal = (v: string | undefined): number => {
  if (v === undefined || v === "" || v === "normal") return 0;
  return px(v) ?? 0;
};

const borders = (el: RawElement) => ({
  top: num(el.style["border-top-width"]),
  right: num(el.style["border-right-width"]),
  bottom: num(el.style["border-bottom-width"]),
  left: num(el.style["border-left-width"]),
});

const paddings = (el: RawElement) => ({
  top: num(el.style["padding-top"]),
  right: num(el.style["padding-right"]),
  bottom: num(el.style["padding-bottom"]),
  left: num(el.style["padding-left"]),
});

const outOfFlow = (raw: RawElement | null): boolean =>
  raw !== null && (raw.style.position === "absolute" || raw.style.position === "fixed");

const orderOf = (raw: RawElement | null): number => {
  if (!raw) return 0;
  const n = Number.parseInt(raw.style.order, 10);
  return Number.isFinite(n) ? n : 0;
};

const growOf = (raw: RawElement | null): number => {
  if (!raw) return 0;
  const n = Number.parseFloat(raw.style["flex-grow"]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

type Justify = "start" | "center" | "end" | "space-between";
type Align = "start" | "center" | "end" | "baseline";

const justifyOf = (v: string): Justify | null => {
  const t = v.trim();
  if (t === "flex-start" || t === "start" || t === "left" || t === "normal") return "start";
  if (t === "flex-end" || t === "end" || t === "right") return "end";
  if (t === "center" || t === "safe center") return "center";
  if (t === "space-between") return "space-between";
  return null;
};

const alignOf = (v: string): Align | "stretch" | null => {
  const t = v.trim();
  if (t === "normal" || t === "stretch") return "stretch";
  if (t === "flex-start" || t === "start") return "start";
  if (t === "flex-end" || t === "end") return "end";
  if (t === "center" || t === "safe center") return "center";
  if (t === "baseline" || t === "first baseline" || t === "last baseline") return "baseline";
  return null;
};

const selfOf = (v: string | undefined): string => (v ?? "auto").trim();

/** "12px 12px" (computed) → [12, 12]; anything non-px → null. */
function tracks(value: string | undefined): number[] | null {
  if (!value) return null;
  const t = value.trim();
  if (t === "" || t === "none") return null;
  const parts = splitTop(t, " ");
  const out: number[] = [];
  for (const p of parts) {
    const n = px(p);
    if (n === null) return null;
    out.push(Math.max(0, n));
  }
  return out.length ? out : null;
}

interface Placed {
  item: LayoutItem;
  w: number;
  h: number;
}

/**
 * Figma Auto Layout simulator: given measured child sizes, where would a stack put them?
 * Returns expected top-left per item (border-box, page coordinates), or null when the
 * inputs can't express it (used only to reject, never to fudge positions).
 */
function simulateStack(
  content: { x: number; y: number; width: number; height: number },
  horizontal: boolean,
  items: Placed[],
  opts: { gap: number; crossGap: number; justify: Justify; align: Align | "stretch"; wrap: boolean },
): { x: number; y: number; w: number; h: number }[] | null {
  if (items.length === 0) return [];
  const mainSize = (w: number, h: number) => (horizontal ? w : h);
  const crossSize = (w: number, h: number) => (horizontal ? h : w);
  const sized = items.map((p) => ({ item: p.item, w: p.w, h: p.h, grow: growOf(p.item.raw) }));

  // Figma FILL children split the space left after fixed children equally: unlike CSS flex-grow,
  // ratios and flex-basis don't count. Verification then rejects a browser result that differs.
  const distribute = (line: typeof sized, contentMain: number): boolean => {
    const fills = line.filter((p) => p.grow > 0);
    if (fills.length === 0) return true;
    if (opts.wrap) return false; // ponytail: FILL inside wrapped rows unmodeled; absolute instead
    const fixed = line.filter((p) => p.grow === 0).reduce((s, p) => s + mainSize(p.w, p.h), 0);
    const each = (contentMain - fixed - opts.gap * Math.max(0, line.length - 1)) / fills.length;
    if (each < 0) return false;
    for (const p of fills) {
      if (horizontal) p.w = each;
      else p.h = each;
    }
    return true;
  };

  // Greedy wrap: pack until the next item would overflow the content box.
  const lines: (typeof sized)[] = [];
  if (opts.wrap) {
    let line: typeof sized = [];
    let used = 0;
    for (const p of sized) {
      const m = mainSize(p.w, p.h);
      const need = line.length === 0 ? m : used + opts.gap + m;
      if (line.length > 0 && need > (horizontal ? content.width : content.height) + GAP_PX) {
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(p);
      used = line.length === 1 ? m : used + opts.gap + m;
    }
    if (line.length) lines.push(line);
  } else {
    lines.push([...sized]);
  }

  const out = new Map<LayoutItem, { x: number; y: number; w: number; h: number }>();
  const contentCross = horizontal ? content.height : content.width;
  let crossCursor = horizontal ? content.y : content.x;
  for (const [li, line] of lines.entries()) {
    const contentMain = horizontal ? content.width : content.height;
    if (!distribute(line, contentMain)) return null;
    const total = line.reduce((s, p) => s + mainSize(p.w, p.h), 0);
    const free = contentMain - total - opts.gap * Math.max(0, line.length - 1);
    let step = opts.gap;
    let cursor = horizontal ? content.x : content.y;
    if (opts.justify === "center") cursor += Math.max(0, free) / 2;
    else if (opts.justify === "end") cursor += Math.max(0, free);
    else if (opts.justify === "space-between" && line.length > 1) {
      step = opts.gap + Math.max(0, free) / (line.length - 1);
    }
    // Cross size of the line: without wrap the single line spans the content box, so
    // start/center/end align within the frame; wrapped lines hug their tallest child.
    const lineCross = opts.wrap ? Math.max(...line.map((p) => crossSize(p.w, p.h))) : contentCross;
    for (const [k, p] of line.entries()) {
      const stretch = opts.align === "stretch";
      let crossPos: number;
      if (stretch) crossPos = crossCursor;
      else if (opts.align === "center") crossPos = crossCursor + (lineCross - crossSize(p.w, p.h)) / 2;
      else if (opts.align === "end") crossPos = crossCursor + (lineCross - crossSize(p.w, p.h));
      else crossPos = crossCursor;
      const mainPos = cursor;
      out.set(
        p.item,
        horizontal
          ? { x: mainPos, y: crossPos, w: p.w, h: stretch ? lineCross : p.h }
          : { x: crossPos, y: mainPos, w: stretch ? lineCross : p.w, h: p.h },
      );
      cursor += mainSize(p.w, p.h) + (k < line.length - 1 ? step : 0);
    }
    crossCursor += lineCross + (li < lines.length - 1 ? opts.crossGap : 0);
  }
  return items.map((p) => {
    const e = out.get(p.item);
    if (!e) throw new Error("simulator dropped an item"); // unreachable: every item is placed above
    return e;
  });
}

const within = (a: number, b: number) => Math.abs(a - b) <= VERIFY_PX + 1e-9;

interface Candidate {
  layout: Layout;
  /** In-flow items in visual order. */
  flow: LayoutItem[];
  reverse: boolean;
}

/** Candidate A: from CSS flex intent. Null when the CSS has no Auto Layout equivalent. */
function candidateA(el: RawElement, flow: LayoutItem[]): Candidate | null {
  const display = el.style.display;
  if (display !== "flex" && display !== "inline-flex") return null;
  const dir = el.style["flex-direction"].trim() || "row";
  const reverse = dir === "row-reverse" || dir === "column-reverse";
  const horizontal = dir.startsWith("row");
  if (dir !== "row" && dir !== "row-reverse" && dir !== "column" && dir !== "column-reverse") return null;
  const wrapProp = el.style["flex-wrap"].trim();
  if (wrapProp !== "" && wrapProp !== "nowrap" && wrapProp !== "wrap") return null; // wrap-reverse → B/fallback
  const justify = justifyOf(el.style["justify-content"]);
  if (!justify) return null;
  const alignRaw = alignOf(el.style["align-items"]);
  if (!alignRaw) return null;
  // Figma aligns baselines only in single-line rows; a column's baseline is just start in CSS.
  if (alignRaw === "baseline" && !(horizontal && wrapProp !== "wrap")) return null;
  const align = alignRaw;
  const colGap = gapVal(el.style["column-gap"]);
  const rowGap = gapVal(el.style["row-gap"]);
  const gap = horizontal ? colGap : rowGap;
  const crossGap = horizontal ? rowGap : colGap;
  const pad = paddings(el);
  // Per-item overrides the IR can't express must fail, not silently drop.
  for (const it of flow) {
    const s = selfOf(it.raw?.style["align-self"]);
    if (s !== "auto" && s !== "normal" && s !== "stretch") {
      const want = alignOf(s);
      const containerAlign = align === "stretch" ? "stretch" : align;
      const itemAlign = want === "stretch" ? "stretch" : want;
      if (itemAlign !== containerAlign) return null;
    }
  }
  const ordered = [...flow].sort((a, b) => orderOf(a.raw) - orderOf(b.raw) || a.domIndex - b.domIndex);
  if (reverse) ordered.reverse();
  return {
    layout: {
      mode: "stack",
      direction: horizontal ? "horizontal" : "vertical",
      reverse,
      wrap: wrapProp === "wrap",
      gap: round2(gap),
      crossGap: round2(crossGap),
      padding: {
        top: round2(pad.top),
        right: round2(pad.right),
        bottom: round2(pad.bottom),
        left: round2(pad.left),
      },
      justify,
      align: align === "stretch" ? "start" : align,
    },
    flow: ordered,
    reverse,
  };
}

/** Verify a stack candidate: every in-flow child within 1 px of the simulated rect. */
function verifyStack(el: RawElement, cand: Candidate, sizes: Map<string, { w: number; h: number }>): boolean {
  const horizontal = cand.layout.mode === "stack" && cand.layout.direction === "horizontal";
  const b = borders(el);
  const pad = cand.layout.mode === "stack" ? cand.layout.padding : { top: 0, right: 0, bottom: 0, left: 0 };
  const content = {
    x: el.rect.x + b.left + pad.left,
    y: el.rect.y + b.top + pad.top,
    width: Math.max(0, el.rect.width - b.left - b.right - pad.left - pad.right),
    height: Math.max(0, el.rect.height - b.top - b.bottom - pad.top - pad.bottom),
  };
  const l = cand.layout;
  if (l.mode !== "stack") return false;
  const placed: Placed[] = cand.flow.map((item) => {
    const s = sizes.get(item.node.id) ?? { w: item.node.bounds.width, h: item.node.bounds.height };
    return { item, w: s.w, h: s.h };
  });
  // Stretch is stored as start + fill.
  const sim = simulateStack(content, horizontal, placed, {
    gap: l.gap,
    crossGap: l.crossGap,
    justify: l.justify,
    align: l.align,
    wrap: l.wrap,
  });
  if (!sim) return false;
  return cand.flow.every((item, i) => {
    const e = sim[i];
    if (!e) return false;
    const n = item.node.bounds;
    // ponytail: baselines need font metrics the snapshot doesn't carry, so a baseline row verifies
    // the main axis only and Figma re-derives the cross offsets from its own glyphs.
    const crossOk = l.align === "baseline" || (horizontal ? within(e.y, n.y) : within(e.x, n.x));
    if (!(crossOk && (horizontal ? within(e.x, n.x) : within(e.y, n.y)))) return false;
    // Fill items must also size as simulated (flex-grow distribution).
    if (growOf(item.raw) > 0 && !(within(e.w, n.width) && within(e.h, n.height))) return false;
    return true;
  });
}

/** Candidate B: from measured geometry. Vertical or horizontal block stacking with constant gap. */
function candidateB(el: RawElement, flow: LayoutItem[]): Candidate | null {
  if (flow.length === 0) return null;
  const b = borders(el);
  const inner = {
    x: el.rect.x + b.left,
    y: el.rect.y + b.top,
    width: Math.max(0, el.rect.width - b.left - b.right),
    height: Math.max(0, el.rect.height - b.top - b.bottom),
  };
  const byY = [...flow].sort((a, b2) => a.node.bounds.y - b2.node.bounds.y || a.domIndex - b2.domIndex);
  const vert = stacking(byY, "vertical", inner);
  if (vert) return vert;
  const byX = [...flow].sort((a, b2) => a.node.bounds.x - b2.node.bounds.x || a.domIndex - b2.domIndex);
  return stacking(byX, "horizontal", inner);
}

function stacking(
  items: LayoutItem[],
  axis: "vertical" | "horizontal",
  inner: { x: number; y: number; width: number; height: number },
): Candidate | null {
  const pos = (n: Node) => (axis === "vertical" ? n.bounds.y : n.bounds.x);
  const size = (n: Node) => (axis === "vertical" ? n.bounds.height : n.bounds.width);
  const cross = (n: Node) => (axis === "vertical" ? n.bounds.x : n.bounds.y);
  const crossSize = (n: Node) => (axis === "vertical" ? n.bounds.width : n.bounds.height);
  const innerCross = axis === "vertical" ? inner.x : inner.y;
  const innerCrossSize = axis === "vertical" ? inner.width : inner.height;
  // Monotonic with a constant gap (±0.5 px).
  const gaps: number[] = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]?.node;
    const cur = items[i]?.node;
    if (!prev || !cur) return null;
    if (pos(cur) < pos(prev) + size(prev) - GAP_PX) return null;
    gaps.push(pos(cur) - (pos(prev) + size(prev)));
  }
  const g0 = gaps[0] ?? 0;
  if (!gaps.every((g) => Math.abs(g - g0) <= GAP_PX)) return null;
  const gap = gaps.length ? Math.max(0, g0) : 0;
  // Cross axis: consistent start offsets, centers, or ends, within the verify tolerance (a text
  // box sits ~0.6 px off its button's center from glyph rounding); verifyStack has the final say.
  // Cross padding: start keeps the measured offset (and the far side up to the widest child),
  // center needs none, end keeps the measured end offset; Figma aligns within the padded box.
  const offsets = items.map((it) => cross(it.node) - innerCross);
  const off0 = offsets[0] ?? 0;
  const ends = items.map((it) => innerCross + innerCrossSize - (cross(it.node) + crossSize(it.node)));
  const e0 = ends[0] ?? 0;
  let align: Align;
  let padCross: number;
  let padCrossEnd: number;
  if (offsets.every((o) => within(o, off0))) {
    align = "start";
    padCross = off0;
    padCrossEnd = Math.min(...ends);
  } else if (
    items.every((it) => within(cross(it.node) + crossSize(it.node) / 2, innerCross + innerCrossSize / 2))
  ) {
    align = "center";
    padCross = 0;
    padCrossEnd = 0;
  } else if (ends.every((e) => within(e, e0))) {
    align = "end";
    padCross = 0;
    padCrossEnd = e0;
  } else {
    return null;
  }
  const first = items[0]?.node.bounds;
  const last = items[items.length - 1]?.node.bounds;
  if (!first || !last) return null;
  const padMainStart = Math.max(0, axis === "vertical" ? first.y - inner.y : first.x - inner.x);
  const innerMain = axis === "vertical" ? inner.height : inner.width;
  const lastEnd = axis === "vertical" ? last.y + last.height - inner.y : last.x + last.width - inner.x;
  const padMainEnd = Math.max(0, innerMain - lastEnd);
  const crossStart = round2(Math.max(0, padCross));
  const crossEnd = round2(Math.max(0, padCrossEnd));
  const padding =
    axis === "vertical"
      ? { top: round2(padMainStart), right: crossEnd, bottom: round2(padMainEnd), left: crossStart }
      : { top: crossStart, right: round2(padMainEnd), bottom: crossEnd, left: round2(padMainStart) };
  return {
    layout: {
      mode: "stack",
      direction: axis === "vertical" ? "vertical" : "horizontal",
      reverse: false,
      wrap: false,
      gap: round2(gap),
      crossGap: 0,
      padding,
      justify: "start",
      align,
    },
    flow: items,
    reverse: false,
  };
}

/** Grid: explicit px tracks with single-cell items. */
function candidateGrid(el: RawElement, flow: LayoutItem[]): Candidate | null {
  const display = el.style.display;
  if (display !== "grid" && display !== "inline-grid") return null;
  const cols = tracks(el.style["grid-template-columns"]);
  let rows = tracks(el.style["grid-template-rows"]);
  if (!cols) return null;
  const ordered = [...flow].sort((a, b) => orderOf(a.raw) - orderOf(b.raw) || a.domIndex - b.domIndex);
  const colGap = gapVal(el.style["column-gap"]);
  const rowGap = gapVal(el.style["row-gap"]);
  const b = borders(el);
  const pad = paddings(el);
  const contentX = el.rect.x + b.left + pad.left;
  const contentY = el.rect.y + b.top + pad.top;
  const needRows = Math.ceil(ordered.length / cols.length);
  if (!rows) {
    // Implicit rows: each row takes its tallest child; rows must then be verified cell by cell.
    const heights: number[] = [];
    for (let r = 0; r < needRows; r++) {
      const row = ordered.slice(r * cols.length, (r + 1) * cols.length);
      if (!row.length) break;
      heights.push(Math.max(...row.map((it) => it.node.bounds.height)));
    }
    rows = heights;
  }
  if (rows.length < needRows) return null;
  if (ordered.length > cols.length * rows.length) return null;
  // Single-cell items only: explicit spans fail to B/fallback.
  for (const it of ordered) {
    const s = (p: string | undefined) => (p ?? "auto").trim();
    const cs = s(it.raw?.style["grid-column-start"]);
    const ce = s(it.raw?.style["grid-column-end"]);
    const rs = s(it.raw?.style["grid-row-start"]);
    const re = s(it.raw?.style["grid-row-end"]);
    for (const [a, c] of [
      [cs, ce],
      [rs, re],
    ] as const) {
      if (a !== "auto" && c !== "auto") {
        const span = Number.parseInt(c, 10) - Number.parseInt(a, 10);
        if (!(span === 1 || (Number.isNaN(span) && a === c))) return null;
      } else if ((a === "span" || c.startsWith("span")) && !/span\s+1/.test(`${a} ${c}`)) {
        return null;
      }
    }
  }
  // Verify each child sits in its cell within 1 px and fills it within 1 px.
  let y = contentY;
  for (let r = 0; r < rows.length; r++) {
    let x = contentX;
    const ch = rows[r] ?? 0;
    for (let c = 0; c < cols.length; c++) {
      const it = ordered[r * cols.length + c];
      if (!it) break;
      const n = it.node.bounds;
      const cw = cols[c] ?? 0;
      if (!(within(x, n.x) && within(y, n.y) && within(cw, n.width) && within(ch, n.height))) return null;
      x += cw + colGap;
    }
    y += ch + rowGap;
  }
  return {
    layout: {
      mode: "grid",
      columns: cols.map((size) => ({ size: round2(size) })),
      rows: rows.slice(0, Math.max(needRows, 1)).map((size) => ({ size: round2(size) })),
      columnGap: round2(colGap),
      rowGap: round2(rowGap),
      padding: {
        top: round2(pad.top),
        right: round2(pad.right),
        bottom: round2(pad.bottom),
        left: round2(pad.left),
      },
    },
    flow: ordered,
    reverse: false,
  };
}

/**
 * Children in the verified visual order. Figma positions Auto Layout flow children by list order
 * and ignores their stored coordinates, so flow slots take the candidate's order; absolute children
 * don't take part in the flow and keep their paint-order slot, so a `-z-10` backdrop stays behind
 * the content instead of covering it. Per mapping §3 step 7.
 */
function orderResult(items: LayoutItem[], visualFlow: LayoutItem[]): Node[] {
  const flowIds = new Set(visualFlow.map((it) => it.node.id));
  let k = 0;
  return items.map((it) => (flowIds.has(it.node.id) ? (visualFlow[k++] ?? it).node : it.node));
}

/** Main entry: bottom-up per container. Children must already carry final bounds. */
export function inferLayout(el: RawElement, items: LayoutItem[], nodeId: string): InferResult {
  const updates: InferResult["updates"] = new Map();
  const flow = items.filter((it) => !outOfFlow(it.raw));
  const absolute = items.filter((it) => outOfFlow(it.raw));
  if (flow.length === 0) {
    for (const it of absolute) {
      updates.set(it.node.id, {
        horizontal: it.node.sizing.horizontal,
        vertical: it.node.sizing.vertical,
        position: it.raw?.style.position === "fixed" ? "fixed" : "absolute",
      });
    }
    return { layout: { mode: "none" }, children: items.map((it) => it.node), updates };
  }

  const sizes = new Map<string, { w: number; h: number }>();
  for (const it of flow) sizes.set(it.node.id, { w: it.node.bounds.width, h: it.node.bounds.height });

  // A: flex intent (with fill sizing), then verify.
  const a = candidateA(el, flow);
  if (a && a.layout.mode === "stack") {
    const horizontal = a.layout.direction === "horizontal";
    const stretch =
      el.style["align-items"].trim() === "stretch" || el.style["align-items"].trim() === "normal";
    const b = borders(el);
    const p = a.layout.padding;
    const contentCross = horizontal
      ? el.rect.height - b.top - b.bottom - p.top - p.bottom
      : el.rect.width - b.left - b.right - p.left - p.right;
    for (const it of a.flow) {
      const grow = growOf(it.raw);
      const self = selfOf(it.raw?.style["align-self"]);
      // Stretch only reaches items without an explicit cross size (an h-8 avatar stays 32 px), so
      // FILL only what the browser actually stretched across a single line.
      const itemCross = horizontal ? it.node.bounds.height : it.node.bounds.width;
      const crossFill =
        stretch &&
        !a.layout.wrap &&
        (self === "auto" || self === "normal" || self === "stretch") &&
        within(itemCross, contentCross);
      const mainFill = grow > 0;
      updates.set(it.node.id, {
        horizontal: (horizontal ? mainFill : crossFill) ? "fill" : it.node.sizing.horizontal,
        vertical: (horizontal ? crossFill : mainFill) ? "fill" : it.node.sizing.vertical,
        position: "flow",
      });
    }
    if (verifyStack(el, a, sizes)) {
      for (const it of absolute) {
        updates.set(it.node.id, {
          horizontal: it.node.sizing.horizontal,
          vertical: it.node.sizing.vertical,
          position: it.raw?.style.position === "fixed" ? "fixed" : "absolute",
        });
      }
      return { layout: a.layout, children: orderResult(items, a.flow), updates };
    }
  }

  // Grid before B: a grid's rows are not monotonic in one axis.
  const g = candidateGrid(el, flow);
  if (g && g.layout.mode === "grid") {
    const cols = g.layout.columns.length;
    g.flow.forEach((it, i) => {
      updates.set(it.node.id, {
        horizontal: it.node.sizing.horizontal,
        vertical: it.node.sizing.vertical,
        position: "flow",
        gridCell: { row: Math.floor(i / cols), column: i % cols },
      });
    });
    for (const it of absolute) {
      updates.set(it.node.id, {
        horizontal: it.node.sizing.horizontal,
        vertical: it.node.sizing.vertical,
        position: it.raw?.style.position === "fixed" ? "fixed" : "absolute",
      });
    }
    return { layout: g.layout, children: orderResult(items, g.flow), updates };
  }

  // B: measured block stacking, then verify.
  const bCand = candidateB(el, flow);
  if (bCand && verifyStack(el, bCand, sizes)) {
    for (const it of bCand.flow) {
      updates.set(it.node.id, {
        horizontal: it.node.sizing.horizontal,
        vertical: it.node.sizing.vertical,
        position: "flow",
      });
    }
    for (const it of absolute) {
      updates.set(it.node.id, {
        horizontal: it.node.sizing.horizontal,
        vertical: it.node.sizing.vertical,
        position: it.raw?.style.position === "fixed" ? "fixed" : "absolute",
      });
    }
    const children = orderResult(items, bCand.flow);
    return { layout: bCand.layout, children, updates };
  }

  // Fallback: absolute at measured coordinates.
  for (const it of items) {
    updates.set(it.node.id, {
      horizontal: it.node.sizing.horizontal,
      vertical: it.node.sizing.vertical,
      position: it.raw?.style.position === "fixed" ? "fixed" : "absolute",
    });
  }
  const reason = `no stack or grid candidate verified for display ${el.style.display || "block"}`;
  void nodeId;
  return { layout: { mode: "none" }, children: items.map((it) => it.node), updates, fallbackReason: reason };
}
