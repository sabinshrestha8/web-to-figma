import type { BoxNode, Layout, Node } from "@w2f/ir";
import { VERIFY_PX } from "./layout.ts";

export type DriftKind =
  | "moved"
  | "resized"
  | "text-changed"
  | "restyled"
  | "layout-changed"
  | "added"
  | "removed";

export interface DriftEntry {
  kind: DriftKind;
  /** `name#index` segments from the root, e.g. `root / div shell#1 / main main#0`. */
  path: string;
  detail: string;
  /** Page bounds of the node in the old and new tree (one side only for added/removed). */
  before?: Node["bounds"];
  after?: Node["bounds"];
}

export interface DriftReport {
  entries: DriftEntry[];
  compared: number;
}

/** Geometry counts as changed past the same 1 px the layout simulator verifies within. */
const changed = (a: number, b: number) => Math.abs(a - b) > VERIFY_PX + 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;

function iou(a: Node["bounds"], b: Node["bounds"]): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = x * y;
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Same element across captures? Tag + selector carry identity; overlap tolerates moves and resizes.
 * Across Figma and production, icons change type (vector vs box): those match on exact name + overlap. */
function similarity(a: Node, b: Node): number {
  if (a.type !== b.type) {
    return a.name === b.name && iou(a.bounds, b.bounds) > 0.3 ? 4 : 0;
  }
  let s = 0;
  if (a.source.tag === b.source.tag) s += 3;
  if (a.source.selector === b.source.selector) s += 2;
  if (a.name === b.name) s += 1;
  if (iou(a.bounds, b.bounds) > 0.3) s += 2;
  return s;
}

function label(n: Node, index: number): string {
  return `${n.name}#${index}`;
}

/**
 * Style equality that survives a round trip through Figma: numbers within 0.011 or 1% (float
 * colors vs 4-dp IR colors, recomputed gradient angles), objects compared on shared keys (Figma
 * can't report an image's crop or position), and an empty image `assetId` (Figma side: bytes
 * unknown) matching any.
 */
function near(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= Math.max(0.011, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    return Object.keys(x)
      .filter((k) => k in y)
      .every((k) => (k === "assetId" && (x[k] === "" || y[k] === "")) || near(x[k], y[k]));
  }
  return a === b;
}

function layoutDetail(a: Layout, b: Layout): string | null {
  if (a.mode !== b.mode) return `layout ${a.mode} → ${b.mode}`;
  const diffs: string[] = [];
  if (a.mode === "stack" && b.mode === "stack") {
    if (a.direction !== b.direction) diffs.push(`direction ${a.direction} → ${b.direction}`);
    if (a.justify !== b.justify) diffs.push(`justify ${a.justify} → ${b.justify}`);
    if (a.align !== b.align) diffs.push(`align ${a.align} → ${b.align}`);
    if (changed(a.gap, b.gap)) diffs.push(`gap ${a.gap} → ${b.gap}`);
    if (changed(a.crossGap, b.crossGap)) diffs.push(`crossGap ${a.crossGap} → ${b.crossGap}`);
    const sides = ["top", "right", "bottom", "left"] as const;
    if (sides.some((s) => changed(a.padding[s], b.padding[s]))) diffs.push(`padding changed`);
    if (a.reverse !== b.reverse) diffs.push(`reverse changed`);
    if (a.wrap !== b.wrap) diffs.push(`wrap changed`);
  }
  if (a.mode === "grid" && b.mode === "grid") {
    if (a.columns.length !== b.columns.length || a.rows.length !== b.rows.length) {
      diffs.push(`tracks ${a.columns.length}×${a.rows.length} → ${b.columns.length}×${b.rows.length}`);
    }
    if (changed(a.columnGap, b.columnGap)) diffs.push(`columnGap ${a.columnGap} → ${b.columnGap}`);
    if (changed(a.rowGap, b.rowGap)) diffs.push(`rowGap ${a.rowGap} → ${b.rowGap}`);
  }
  return diffs.length ? diffs.join("; ") : null;
}

/**
 * SVG ids renamed in order of first appearance: React `useId` (`:r14:`) and chart libraries mint
 * new ids on every load, which would otherwise flag every such icon as changed.
 */
export function canonicalIds(svg: string): string {
  const ids = [...new Set(Array.from(svg.matchAll(/\bid="([^"]+)"/g), (m) => m[1] ?? ""))];
  return ids.reduce((out, id, i) => out.split(id).join(`id${i}`), svg);
}

function restyleDetail(a: Node, b: Node): string | null {
  const diffs: string[] = [];
  if (a.type === "box" && b.type === "box") {
    if (!near(a.fills, b.fills)) diffs.push("fills");
    if (!near(a.stroke, b.stroke)) diffs.push("stroke");
    if (!near(a.radius, b.radius)) diffs.push("radius");
    // Clipping a childless box changes nothing visible (Figma rectangles can't even clip).
    if (a.clip !== b.clip && (a.children.length > 0 || b.children.length > 0)) diffs.push("clip");
  }
  if (a.type === "vector" && b.type === "vector" && canonicalIds(a.svg) !== canonicalIds(b.svg))
    diffs.push("markup");
  if (!near(a.effects, b.effects)) diffs.push("effects");
  if (a.opacity !== b.opacity) diffs.push(`opacity ${a.opacity} → ${b.opacity}`);
  if (a.blendMode !== b.blendMode) diffs.push("blend");
  if (a.rotation !== b.rotation) diffs.push("rotation");
  return diffs.length ? `${diffs.join(", ")} changed` : null;
}

function comparePair(a: Node, b: Node, path: string, entries: DriftEntry[]): void {
  const out = {
    push: (e: Omit<DriftEntry, "before" | "after">) =>
      entries.push({ ...e, before: a.bounds, after: b.bounds }),
  };
  if (changed(a.bounds.x, b.bounds.x) || changed(a.bounds.y, b.bounds.y)) {
    out.push({
      kind: "moved",
      path,
      detail: `(${r2(a.bounds.x)}, ${r2(a.bounds.y)}) → (${r2(b.bounds.x)}, ${r2(b.bounds.y)})`,
    });
  }
  if (changed(a.bounds.width, b.bounds.width) || changed(a.bounds.height, b.bounds.height)) {
    out.push({
      kind: "resized",
      path,
      detail: `${r2(a.bounds.width)}×${r2(a.bounds.height)} → ${r2(b.bounds.width)}×${r2(b.bounds.height)}`,
    });
  }
  // Live content (an `ignore` selector matched it on either side): where it sits, not what it shows.
  if (a.ignore || b.ignore) return;
  if (a.type === "text" && b.type === "text" && a.characters !== b.characters) {
    out.push({
      kind: "text-changed",
      path,
      detail: `${JSON.stringify(a.characters.slice(0, 60))} → ${JSON.stringify(b.characters.slice(0, 60))}`,
    });
  }
  const restyle = restyleDetail(a, b);
  if (restyle) out.push({ kind: "restyled", path, detail: restyle });
  const sizing =
    a.sizing.horizontal !== b.sizing.horizontal || a.sizing.vertical !== b.sizing.vertical
      ? `sizing ${a.sizing.horizontal}/${a.sizing.vertical} → ${b.sizing.horizontal}/${b.sizing.vertical}`
      : null;
  const position = a.position !== b.position ? `position ${a.position} → ${b.position}` : null;
  if (a.type === "box" && b.type === "box") {
    const layout = layoutDetail(a.layout, b.layout);
    const structural = [layout, sizing, position].filter((s): s is string => s !== null);
    if (structural.length) out.push({ kind: "layout-changed", path, detail: structural.join("; ") });
  } else if (sizing || position) {
    out.push({
      kind: "layout-changed",
      path,
      detail: [sizing, position].filter((s): s is string => s !== null).join("; "),
    });
  }
  if (a.type === "box" && b.type === "box") compareChildren(a.children, b.children, path, entries);
}

/** Greedy best-match pairing per level; leftovers are added/removed (reorders surface as both). */
function compareChildren(a: Node[], b: Node[], path: string, out: DriftEntry[]): void {
  const freeB = new Set(b.map((_, i) => i));
  const removed: { n: Node; i: number }[] = [];
  for (const [i, old] of a.entries()) {
    let best = -1;
    let bestScore = 3;
    for (const j of freeB) {
      const candidate = b[j];
      if (!candidate) continue;
      const s = similarity(old, candidate);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    }
    if (best < 0) {
      removed.push({ n: old, i });
      continue;
    }
    freeB.delete(best);
    const match = b[best];
    if (!match) {
      removed.push({ n: old, i });
      continue;
    }
    comparePair(old, match, `${path} / ${label(old, i)}`, out);
  }
  for (const { n, i } of removed) {
    out.push({
      kind: "removed",
      path: `${path} / ${label(n, i)}`,
      detail: `${n.type} ${n.source.selector}`,
      before: n.bounds,
    });
  }
  for (const j of [...freeB].sort((x, y) => x - y)) {
    const n = b[j];
    if (!n) continue;
    out.push({
      kind: "added",
      path: `${path} / ${label(n, j)}`,
      detail: `${n.type} ${n.source.selector}`,
      after: n.bounds,
    });
  }
}

/** Bounds of the outermost ignored nodes, for masking them out of a pixel diff. */
export function ignoredRects(root: Node): Node["bounds"][] {
  if (root.ignore) return [root.bounds];
  return root.type === "box" ? root.children.flatMap(ignoredRects) : [];
}

/** Node-level diff of two captures of the same page. Roots are expected to be the same viewport. */
export function diffCaptures(oldRoot: BoxNode, newRoot: BoxNode): DriftReport {
  const entries: DriftEntry[] = [];
  let compared = 0;
  const count = (n: Node): void => {
    compared++;
    if (n.type === "box") n.children.forEach(count);
  };
  count(oldRoot);
  comparePair(oldRoot, newRoot, "root", entries);
  return { entries, compared };
}

const KIND_TITLE: Record<DriftKind, string> = {
  moved: "Moved",
  resized: "Resized",
  "text-changed": "Text changed",
  restyled: "Restyled",
  "layout-changed": "Layout changed",
  added: "Added",
  removed: "Removed",
};

/** Human-readable drift report. Empty means the captures match within tolerance. */
export function renderDrift(report: DriftReport): string {
  const lines = [`Drift: ${report.entries.length} change(s) across ${report.compared} node(s).`];
  if (report.entries.length === 0) return `${lines[0]} No drift within tolerance.`;
  for (const kind of Object.keys(KIND_TITLE) as DriftKind[]) {
    const group = report.entries.filter((e) => e.kind === kind);
    if (!group.length) continue;
    lines.push(`\n## ${KIND_TITLE[kind]} (${group.length})`);
    for (const e of group) lines.push(`- ${e.path} — ${e.detail}`);
  }
  return lines.join("\n");
}
