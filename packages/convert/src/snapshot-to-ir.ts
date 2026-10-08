import { type BoxNode, type Capture, type Diagnostic, diag, type Node, type Paint } from "@w2f/ir";
import { parseColor, round2 } from "./css.ts";
import { islandReason } from "./rasters.ts";
import { createReport } from "./report.ts";
import { bakeScale } from "./scale.ts";
import type { RawElement, RawSnapshot, RawText } from "./snapshot.ts";
import { boxStyle, islandStyle } from "./style.ts";
import { decorationResolver, type InlineGroup, inlineGroups, inlineText } from "./text.ts";

export interface ConvertOptions {
  captureId: string;
  /** Captures taller than this are clipped (PAGE_HEIGHT_CLIPPED). */
  maxHeight: number;
  screenshot?: string;
  /** Raster key → asset id for the requests from `rasterPlan` that the capture step fulfilled. */
  rasters?: Record<string, string>;
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

/** A wrapper that paints nothing around a single same-sized child is noise: keep only the child. */
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
  if (!(near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height))) return box;
  return box.position === "flow" ? only : { ...only, position: box.position };
}

/**
 * Boxes carry borders, radii, gradients, shadows, blurs, blend modes, clipping and leaf rotation;
 * replaced content becomes raster islands; each run of inline content becomes one text node with
 * style runs. Every box is still absolutely positioned (layout "none") until Phase 6.
 */
export function snapshotToIR(raw: RawSnapshot, opts: ConvertOptions): ConvertResult {
  const snap = bakeScale(raw);
  const diagnostics: Diagnostic[] = [];
  const { captureId } = opts;
  const report = createReport(captureId);
  const rasters = opts.rasters ?? {};
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
  const convertAll = (parent: RawElement): Node[] =>
    paintOrder(inlineGroups(kidsOf(parent), parent, kidsOf), parent)
      .map((c) => convert(c, parent))
      .filter((c): c is Node => c !== null);

  const convert = (n: RawElement | InlineGroup, parent: RawElement): Node | null => {
    if (n.kind === "inline") {
      const selector = selectorOf(parent);
      return inlineText(n, parent, { captureId, report, kidsOf, decorationOf, selector, maxY: height });
    }
    if (n.rect.y >= height) return null;
    if (Number.parseFloat(n.style.opacity) === 0) return null;

    const nodeId = `${captureId}:${n.id}`;
    const ctx = { nodeId, report, rasters };
    const visible = n.style.visibility === "visible";
    const rawKids = children.get(n.id) ?? [];
    const island = n.rect.width >= 1 && n.rect.height >= 1 ? islandReason(n, rawKids.length === 0) : null;
    if (!island && visible && rawKids.length > 0) {
      for (const p of ["clip-path", "mask-image", "border-image-source"] as const) {
        if (n.style[p] !== "none" && n.style[p] !== "") {
          report.add("UNSUPPORTED_CSS", `${p} on an element with children`, nodeId, "skipped");
        }
      }
    }
    const kids = island ? [] : convertAll(n);
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
      layout: { mode: "none" },
      children: kids,
    };
    return flatten(box);
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
