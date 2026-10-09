import {
  type BoxNode,
  type Capture,
  type Diagnostic,
  diag,
  type Layout,
  type Node,
  type Paint,
  type VectorNode,
} from "@w2f/ir";
import { parseColor, round2 } from "./css.ts";
import type { ImageAsset } from "./images.ts";
import { inferLayout, type LayoutItem } from "./layout.ts";
import { islandReason } from "./rasters.ts";
import { createReport } from "./report.ts";
import { bakeScale } from "./scale.ts";
import type { RawElement, RawSnapshot, RawText } from "./snapshot.ts";
import { boxStyle, islandStyle, type StyleContext } from "./style.ts";
import { decorationResolver, type InlineGroup, inlineGroups, inlineText } from "./text.ts";

export interface ConvertOptions {
  captureId: string;
  /** Captures taller than this are clipped (PAGE_HEIGHT_CLIPPED). */
  maxHeight: number;
  screenshot?: string;
  /** Raster key → asset id for the requests from `rasterPlan` that the capture step fulfilled. */
  rasters?: Record<string, string>;
  /** Image key → decoded image for the requests from `imagePlan` that the capture step fulfilled. */
  images?: Record<string, ImageAsset>;
}

export interface ConvertResult {
  capture: Capture;
  diagnostics: Diagnostic[];
}

const solid = (css: string): Paint[] => {
  const color = parseColor(css);
  return color ? [{ type: "solid", color }] : [];
};

function nameOf(el: RawElement): string {
  const { ariaLabel, testId, id, className } = el.attrs;
  const label = ariaLabel ?? testId ?? (id ? `#${id}` : undefined);
  if (label) return `${el.tag} ${label}`;
  const cls = className?.split(/\s+/)[0];
  return cls ? `${el.tag}.${cls}` : el.tag;
}

function selectorOf(el: RawElement): string {
  const cls = el.attrs.className?.split(/\s+/).filter(Boolean).slice(0, 3) ?? [];
  return `${el.tag}${el.attrs.id ? `#${el.attrs.id}` : ""}${cls.map((c) => `.${c}`).join("")}`;
}

/** Stacking bucket per CSS painting order: negative z, in-flow, positioned (z auto/0), positive z. */
export function stackKey(n: RawElement | { kind: "text" | "inline" }, parent: RawElement): [number, number] {
  if (n.kind !== "element") return [1, 0];
  const positioned = n.style.position !== "static";
  const zApplies = positioned || /(flex|grid)$/.test(parent.style.display);
  const z = zApplies && n.style["z-index"] !== "auto" ? Number.parseInt(n.style["z-index"], 10) || 0 : null;
  if (z !== null && z < 0) return [0, z];
  if (!positioned && z === null) return [1, 0];
  return z === null || z === 0 ? [2, 0] : [3, z];
}

/** Children in paint order, bottom-most first. Stable, so DOM order breaks ties. */
export function paintOrder<T extends RawElement | { kind: "text" | "inline" }>(
  kids: T[],
  parent: RawElement,
): T[] {
  const keyed = kids.map((n) => ({ n, k: stackKey(n, parent) }));
  keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]);
  return keyed.map((x) => x.n);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/**
 * A wrapper that paints nothing around a single same-sized child is noise: keep only the child.
 * So is one around a single line of text whose line box stands up to 2 px proud of it (an inherited
 * line-height taller than the span): kept, no stack verifies the overhang and the span stays a FIXED
 * frame, so Figma's wider glyphs spill over the next item ("03:09:05" over "AM") instead of pushing it.
 */
export function flatten(box: BoxNode): Node {
  const [only] = box.children;
  const paintless =
    box.fills.length === 0 &&
    !box.stroke &&
    box.effects.length === 0 &&
    !box.clip &&
    box.opacity === 1 &&
    box.blendMode === "normal" &&
    box.rotation === undefined;
  if (!only || box.children.length !== 1 || !paintless) return box;
  const a = box.bounds;
  const b = only.bounds;
  const sameX = near(a.x, b.x) && near(a.width, b.width);
  const same = sameX && near(a.y, b.y) && near(a.height, b.height);
  const textLine =
    only.type === "text" &&
    only.lineCount === 1 &&
    sameX &&
    Math.abs(a.height - b.height) <= 2 &&
    Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <= 1;
  if (!same && !textLine) return box;
  // FILL meant "fill the wrapper", which is going away: the new parent's layout decides again.
  const keep = (s: "fixed" | "hug" | "fill") => (s === "fill" ? "fixed" : s);
  return {
    ...only,
    sizing: { horizontal: keep(only.sizing.horizontal), vertical: keep(only.sizing.vertical) },
    position: box.position === "flow" ? only.position : box.position,
  };
}

/**
 * Boxes carry borders, radii, gradients, shadows, blurs, blend modes, clipping and leaf rotation;
 * replaced content becomes raster islands; each run of inline content becomes one text node with
 * style runs. Containers get a verified stack/grid layout when a candidate reproduces the measured
 * child rects within 1 px, else absolute positioning with LAYOUT_ABSOLUTE_FALLBACK.
 */
export function snapshotToIR(raw: RawSnapshot, opts: ConvertOptions): ConvertResult {
  const snap = bakeScale(raw);
  const diagnostics: Diagnostic[] = [];
  const { captureId } = opts;
  const report = createReport(captureId);
  const rasters = opts.rasters ?? {};
  const images = opts.images ?? {};
  const hasImage = (key: string) => key in images;
  const children = new Map<number, (RawElement | RawText)[]>();
  const elements = new Map<number, RawElement>();
  let rootEl: RawElement | undefined;
  for (const n of snap.nodes) {
    if (n.kind === "element") {
      elements.set(n.id, n);
      if (n.parent === null) rootEl ??= n;
    }
    if (n.parent !== null) {
      const list = children.get(n.parent) ?? [];
      list.push(n);
      children.set(n.parent, list);
    }
  }
  if (!rootEl) throw new Error("snapshot has no root element");

  const height = Math.min(snap.documentSize.height, opts.maxHeight);
  if (snap.documentSize.height > opts.maxHeight) {
    diagnostics.push(
      diag(
        "PAGE_HEIGHT_CLIPPED",
        `page is ${snap.documentSize.height}px tall; captured the top ${height}px`,
        {
          captureId,
          detail: { documentHeight: snap.documentSize.height, capturedHeight: height },
        },
      ),
    );
  }

  // CSS canvas background: html's background, else body's (which is then not painted on body).
  const body = (children.get(rootEl.id) ?? []).find(
    (n): n is RawElement => n.kind === "element" && n.tag === "body",
  );
  const htmlFill = solid(rootEl.style["background-color"]);
  const bodyPropagates = htmlFill.length === 0 && body !== undefined;
  const canvasFill = htmlFill.length ? htmlFill : body ? solid(body.style["background-color"]) : [];

  const kidsOf = (el: RawElement) => children.get(el.id) ?? [];
  const decorationOf = decorationResolver(elements);
  const pendingLayouts = new Map<number, Layout>();
  const convertAll = (parent: RawElement): Node[] => {
    const ordered = paintOrder(inlineGroups(kidsOf(parent), parent, kidsOf), parent);
    const pairs: { raw: RawElement | null; node: Node; domIndex: number }[] = [];
    ordered.forEach((c, domIndex) => {
      const node = convert(c, parent);
      if (node) pairs.push({ raw: c.kind === "inline" ? null : c, node, domIndex });
    });
    const items: LayoutItem[] = pairs.map((p) => ({ raw: p.raw, node: p.node, domIndex: p.domIndex }));
    const inferred = inferLayout(parent, items, `${captureId}:${parent.id}`);
    for (const p of pairs) {
      const u = inferred.updates.get(p.node.id);
      if (!u) continue;
      p.node.sizing = { horizontal: u.horizontal, vertical: u.vertical };
      p.node.position = u.position;
      if (u.gridCell) p.node.gridCell = u.gridCell;
    }
    if (inferred.fallbackReason) {
      report.add(
        "LAYOUT_ABSOLUTE_FALLBACK",
        inferred.fallbackReason,
        `${captureId}:${parent.id}`,
        "absolute",
      );
    }
    // stash the inferred layout for `convert` to pick up (parent box, built by the caller)
    pendingLayouts.set(parent.id, inferred.layout);
    return inferred.children;
  };

  const convert = (n: RawElement | InlineGroup, parent: RawElement): Node | null => {
    if (n.kind === "inline") {
      const selector = selectorOf(parent);
      return inlineText(n, parent, { captureId, report, kidsOf, decorationOf, selector, maxY: height });
    }
    if (n.rect.y >= height) return null;
    if (Number.parseFloat(n.style.opacity) === 0) return null;

    const nodeId = `${captureId}:${n.id}`;
    const ctx = { nodeId, report, rasters, images };
    const visible = n.style.visibility === "visible";
    const rawKids = children.get(n.id) ?? [];
    const island =
      n.rect.width >= 1 && n.rect.height >= 1 ? islandReason(n, rawKids.length === 0, hasImage) : null;
    if (!island && visible && rawKids.length > 0) {
      for (const p of ["clip-path", "mask-image", "border-image-source"] as const) {
        if (n.style[p] !== "none" && n.style[p] !== "") {
          report.add("UNSUPPORTED_CSS", `${p} on an element with children`, nodeId, "skipped");
        }
      }
    }
    if (n.svg && !island) return vector(n, n.svg, ctx, visible);
    const kids = island ? [] : convertAll(n);
    const layout: Layout = island ? { mode: "none" } : (pendingLayouts.get(n.id) ?? { mode: "none" });
    const style = island
      ? islandStyle(n, ctx, island)
      : boxStyle(n, ctx, { leaf: kids.length === 0, visible, withColor: !(bodyPropagates && n === body) });
    const paints = style.fills.length > 0 || style.stroke !== undefined || style.effects.length > 0;
    if (kids.length === 0 && !paints) return null;

    const box: BoxNode = {
      id: nodeId,
      type: "box",
      name: nameOf(n),
      opacity: island ? 1 : Math.min(1, Math.max(0, Number.parseFloat(n.style.opacity) || 1)),
      position: n.style.position === "absolute" || n.style.position === "fixed" ? n.style.position : "flow",
      sizing: { horizontal: "fixed", vertical: "fixed" },
      source: { tag: n.tag, selector: selectorOf(n) },
      ...style,
      layout,
      children: kids,
    };
    return flatten(box);
  };

  /** Inline svg → an editable vector, with a PNG of the same markup if Figma rejects it. */
  const vector = (n: RawElement, svg: string, ctx: StyleContext, visible: boolean): VectorNode | null => {
    if (!visible) return null;
    const style = boxStyle(n, ctx, { leaf: true, visible, withColor: true });
    if (style.fills.length > 0 || style.stroke) {
      report.add("UNSUPPORTED_CSS", "background or border on an <svg> element", ctx.nodeId, "skipped");
    }
    const fallback = images[`svg:${n.id}`]?.assetId;
    return {
      id: ctx.nodeId,
      type: "vector",
      name: nameOf(n),
      bounds: style.bounds,
      ...(style.rotation !== undefined ? { rotation: style.rotation } : {}),
      opacity: Math.min(1, Math.max(0, Number.parseFloat(n.style.opacity) || 1)),
      blendMode: style.blendMode,
      effects: style.effects,
      position: n.style.position === "absolute" || n.style.position === "fixed" ? n.style.position : "flow",
      sizing: { horizontal: "fixed", vertical: "fixed" },
      source: { tag: n.tag, selector: selectorOf(n) },
      svg,
      ...(fallback ? { fallback } : {}),
    };
  };

  const root: BoxNode = {
    id: `${captureId}:root`,
    type: "box",
    name: snap.title || snap.url,
    bounds: { x: 0, y: 0, width: snap.viewport.width, height: round2(height) },
    opacity: 1,
    blendMode: "normal",
    effects: [],
    position: "flow",
    sizing: { horizontal: "fixed", vertical: "fixed" },
    source: { tag: "html", selector: "html" },
    fills: canvasFill.length ? canvasFill : [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 } }],
    radius: [0, 0, 0, 0],
    clip: true,
    layout: { mode: "none" },
    children: convertAll(rootEl),
  };

  // A blank result is never silent: usually a loading, blank or mid-navigation page.
  const hasContent = (n: Node): boolean =>
    n.type !== "box" || !["html", "body"].includes(n.source.tag) || n.children.some(hasContent);
  if (!root.children.some(hasContent)) {
    diagnostics.push(
      diag("EMPTY_CAPTURE", `${snap.url} has no visible text or elements; check the reference screenshot`),
    );
  }

  return {
    capture: {
      id: captureId,
      url: snap.url,
      title: snap.title,
      viewport: snap.viewport,
      root,
      ...(opts.screenshot ? { screenshot: opts.screenshot } : {}),
    },
    diagnostics: [...diagnostics, ...report.list()],
  };
}
