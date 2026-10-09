import type {
  BoxNode,
  Capture,
  Diagnostic,
  Document,
  TextNode as IRText,
  VectorNode as IRVector,
  Node,
  Rect,
} from "@w2f/ir";
import { blendMode, effects, rotatedTransform, strokeProps } from "./map/box.ts";
import { type FontReportEntry, fontKey, indexFonts, planFonts, styleKey } from "./map/fonts.ts";
import { relative } from "./map/geometry.ts";
import { childLayout, gridProps, stackProps } from "./map/layout.ts";
import { paints } from "./map/paint.ts";
import { nodeProps, reflowed, runProps } from "./map/text.ts";

const CHUNK = 200;
const CAPTURE_GAP = 200;

const diagnostic = (code: Diagnostic["code"], message: string, extra: Partial<Diagnostic>): Diagnostic => ({
  code,
  message,
  severity: "warning",
  ...extra,
});

/** Mutable state for one build: resolved fonts, image hashes, diagnostics, progress. */
interface Ctx {
  fonts: Map<string, FontName>;
  images: Map<string, string>;
  assets: Document["assets"];
  diagnostics: Diagnostic[];
  reported: Set<string>;
  /** Text nodes Figma wrapped differently (TEXT_REFLOW), reported once with a count. */
  reflowed: IRText[];
  /** Hug text that rendered wider than measured into a clipped parent (TEXT_REFLOW). */
  clipped: IRText[];
  built: number;
  total: number;
  progress: (done: number, total: number) => void;
}

/** Report a feature the plugin cannot build yet, once per feature per build. */
function unbuilt(ctx: Ctx, feature: string, node: Node) {
  if (ctx.reported.has(feature)) return;
  ctx.reported.add(feature);
  ctx.diagnostics.push(
    diagnostic("UNSUPPORTED_CSS", `${feature} is not built by this plugin version; skipped`, {
      nodeId: node.id,
      fallback: "skipped",
      detail: { feature },
    }),
  );
}

function fontFor(ctx: Ctx, style: Parameters<typeof styleKey>[0]): FontName {
  const font = ctx.fonts.get(styleKey(style));
  if (!font) throw new Error(`font for ${styleKey(style)} was not prepared`); // planBuild bug
  return font;
}

function* walk(n: Node): Generator<Node> {
  yield n;
  if (n.type === "box") for (const c of n.children) yield* walk(c);
}

export interface FontPlan {
  fonts: Map<string, FontName>;
  report: FontReportEntry[];
}

/** Resolve every text style to an available font, for the report the user confirms before building. */
export async function planBuild(ir: Document): Promise<FontPlan> {
  const styles = ir.captures.flatMap((c) =>
    [...walk(c.root)].flatMap((n) => (n.type === "text" ? n.runs.map((r) => r.style) : [])),
  );
  return planFonts(styles, indexFonts(await figma.listAvailableFontsAsync()));
}

function fontDiagnostics(plan: FontPlan): Diagnostic[] {
  return plan.report
    .filter((f) => f.substituted)
    .map((f) =>
      diagnostic("FONT_SUBSTITUTED", `${f.requested} → ${f.font}`, {
        fallback: "substituted",
        detail: { from: f.requested, to: f.font, runs: f.runs },
      }),
    );
}

function place(node: SceneNode & LayoutMixin, n: Node, parent: Rect) {
  const r = relative(n.bounds, parent);
  node.x = r.x;
  node.y = r.y;
  node.resizeWithoutConstraints(r.width, r.height);
  if (n.rotation) node.relativeTransform = rotatedTransform(n.rotation, r);
}

function common(node: SceneNode & BlendMixin, n: Node) {
  node.name = n.name;
  node.opacity = n.opacity;
  if (n.blendMode !== "normal") node.blendMode = blendMode(n.blendMode);
  if (n.effects.length) node.effects = effects(n.effects);
}

function buildText(n: IRText, parent: Rect, ctx: Ctx, parentClips: boolean): TextNode {
  const t = figma.createText();
  // The default font (Inter Regular) may not be loaded; switch before setting characters.
  const [first] = n.runs;
  if (first) t.fontName = fontFor(ctx, first.style);
  t.characters = n.characters;
  for (const run of n.runs) {
    const p = runProps(run.style);
    t.setRangeFontName(run.start, run.end, fontFor(ctx, run.style));
    t.setRangeFontSize(run.start, run.end, p.fontSize);
    t.setRangeLineHeight(run.start, run.end, p.lineHeight);
    t.setRangeLetterSpacing(run.start, run.end, p.letterSpacing);
    t.setRangeTextCase(run.start, run.end, p.textCase);
    t.setRangeTextDecoration(run.start, run.end, p.textDecoration);
    t.setRangeFills(run.start, run.end, [
      {
        type: "SOLID",
        color: { r: run.style.color.r, g: run.style.color.g, b: run.style.color.b },
        opacity: run.style.color.a,
      },
    ]);
  }
  const { textAlignHorizontal, textAutoResize } = nodeProps(n);
  t.textAlignHorizontal = textAlignHorizontal;
  const r = relative(n.bounds, parent);
  t.x = r.x;
  t.y = r.y;
  if (textAutoResize === "HEIGHT") {
    t.resize(r.width, r.height); // fixes the wrap width; HEIGHT then lets Figma own the height
  }
  t.textAutoResize = textAutoResize;
  if (reflowed(n, t.height)) ctx.reflowed.push(n);
  // Hug text that renders wider than measured overflows a clipped parent visibly (cut glyphs).
  // Fixed-width text owns its width, so only hug text is checked.
  else if (n.autoResize === "width-and-height" && parentClips && t.width > r.width + 1) {
    ctx.clipped.push(n);
  }
  return t;
}

/** Inline svg → editable vectors; if Figma rejects the markup, its PNG fallback as an image. */
function buildVector(n: IRVector, parent: Rect, ctx: Ctx): SceneNode & LayoutMixin & BlendMixin {
  try {
    const node = figma.createNodeFromSvg(n.svg);
    place(node, n, parent);
    return node;
  } catch (e) {
    const hash = n.fallback ? ctx.images.get(n.fallback) : undefined;
    ctx.diagnostics.push(
      diagnostic("SVG_IMPORT_FAILED", `Figma rejected the SVG of "${n.name}": ${String(e)}`, {
        nodeId: n.id,
        severity: hash ? "warning" : "error",
        fallback: hash ? "rasterized" : "placeholder",
      }),
    );
    const rect = figma.createRectangle();
    place(rect, n, parent);
    rect.fills = hash
      ? [{ type: "IMAGE", imageHash: hash, scaleMode: "FILL" }]
      : [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    return rect;
  }
}

async function buildBox(n: BoxNode, parent: Rect, ctx: Ctx): Promise<FrameNode | RectangleNode> {
  const node = n.children.length > 0 ? figma.createFrame() : figma.createRectangle();
  place(node, n, parent);
  const { paints: fills, skipped } = paints(n.fills, {
    width: n.bounds.width,
    height: n.bounds.height,
    imageHash: (id) => ctx.images.get(id) ?? "",
    imageWidth: (id) => ctx.assets[id]?.width ?? 0,
  });
  for (const s of skipped) unbuilt(ctx, s, n);
  node.fills = fills;
  [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = n.radius;
  if (n.stroke) {
    const s = strokeProps(n.stroke);
    node.strokes = s.strokes;
    node.strokeAlign = s.strokeAlign;
    if (s.uniform !== null) node.strokeWeight = s.uniform;
    else Object.assign(node, s.weights);
    node.dashPattern = s.dashPattern;
  }
  if (node.type === "FRAME") {
    applyLayout(node, n);
    node.clipsContent = n.clip;
    for (const child of n.children) {
      const built = await buildNode(child, n.bounds, ctx, n.clip);
      if (!built) continue;
      if (node.layoutMode === "GRID" && child.gridCell) {
        node.appendChildAt(built, child.gridCell.row, child.gridCell.column);
      } else {
        node.appendChild(built);
      }
      placeInAutoLayout(built, child, n);
    }
  }
  return node;
}

/** Verified IR layout → Figma frame props. `none` leaves an absolutely positioned frame. */
function applyLayout(frame: FrameNode, n: BoxNode) {
  const hasStroke = n.stroke !== undefined;
  if (n.layout.mode === "stack") {
    const p = stackProps(n.layout, hasStroke);
    frame.layoutMode = p.layoutMode;
    frame.layoutWrap = p.layoutWrap;
    frame.itemSpacing = p.itemSpacing;
    frame.counterAxisSpacing = p.counterAxisSpacing;
    frame.paddingTop = p.paddingTop;
    frame.paddingRight = p.paddingRight;
    frame.paddingBottom = p.paddingBottom;
    frame.paddingLeft = p.paddingLeft;
    frame.primaryAxisAlignItems = p.primaryAxisAlignItems;
    frame.counterAxisAlignItems = p.counterAxisAlignItems;
    frame.itemReverseZIndex = p.itemReverseZIndex;
    frame.strokesIncludedInLayout = p.strokesIncludedInLayout;
    // The frame owns its measured size (the IR never asks a container to hug). Turning on Auto
    // Layout may resize it to its (still empty) content, so pin both axes and restore the size;
    // a FILL parent slot overrides this in placeInAutoLayout.
    frame.primaryAxisSizingMode = "FIXED";
    frame.counterAxisSizingMode = "FIXED";
    frame.resizeWithoutConstraints(n.bounds.width, n.bounds.height);
  } else if (n.layout.mode === "grid") {
    const p = gridProps(n.layout);
    frame.layoutMode = "GRID";
    frame.gridColumnCount = p.columnCount;
    frame.gridRowCount = p.rowCount;
    frame.gridColumnGap = p.columnGap;
    frame.gridRowGap = p.rowGap;
    frame.paddingTop = p.paddingTop;
    frame.paddingRight = p.paddingRight;
    frame.paddingBottom = p.paddingBottom;
    frame.paddingLeft = p.paddingLeft;
    frame.gridColumnSizes.forEach((t, i) => {
      t.type = "FIXED";
      t.value = p.columnSizes[i] ?? 0;
    });
    frame.gridRowSizes.forEach((t, i) => {
      t.type = "FIXED";
      t.value = p.rowSizes[i] ?? 0;
    });
  }
}

/**
 * After appendChild, an auto-layout child takes its IR sizing; absolute children pin to their
 * measured spot relative to the parent. Sizing is set after append, per the Figma docs, and
 * FIXED axes are re-enforced to the measured size: appending can re-resolve a fresh child's size,
 * and setting FIXED afterwards would otherwise lock the shrunk size (space-between collapsing).
 * Children of a `none` frame are already placed at absolute coordinates: Figma rejects
 * layout props there, so there is nothing to apply.
 */
function placeInAutoLayout(built: SceneNode, child: Node, parent: BoxNode) {
  if (!("layoutSizingHorizontal" in built) || !("resizeWithoutConstraints" in built)) return;
  const props = childLayout(child, parent.layout.mode);
  if (!props) return;
  built.layoutSizingHorizontal = props.horizontal;
  built.layoutSizingVertical = props.vertical;
  const r = relative(child.bounds, parent.bounds);
  if (props.fixWidth || props.fixHeight) {
    built.resizeWithoutConstraints(
      props.fixWidth ? r.width : built.width,
      props.fixHeight ? r.height : built.height,
    );
  }
  if (props.absolute) {
    built.layoutPositioning = "ABSOLUTE";
    built.x = r.x;
    built.y = r.y;
  }
}

async function buildNode(n: Node, parent: Rect, ctx: Ctx, parentClips = false): Promise<SceneNode | null> {
  if (++ctx.built % CHUNK === 0) {
    ctx.progress(ctx.built, ctx.total);
    await new Promise((r) => setTimeout(r, 0)); // keep Figma responsive on large captures
  }
  const node =
    n.type === "text"
      ? buildText(n, parent, ctx, parentClips)
      : n.type === "vector"
        ? buildVector(n, parent, ctx)
        : await buildBox(n, parent, ctx);
  common(node, n);
  return node;
}

/** Hidden, locked full-page screenshot under the layers, for side-by-side comparison. */
function referenceLayer(capture: Capture, ir: Document, ctx: Ctx): RectangleNode | null {
  const id = capture.screenshot;
  const hash = id && ctx.images.get(id);
  const meta = id && ir.assets[id];
  if (!hash || !meta) return null;
  const rect = figma.createRectangle();
  rect.name = "Reference screenshot";
  rect.resizeWithoutConstraints(meta.width, meta.height);
  rect.fills = [{ type: "IMAGE", imageHash: hash, scaleMode: "FILL" }];
  rect.visible = false;
  rect.locked = true;
  return rect;
}

export async function build(
  ir: Document,
  assets: Record<string, Uint8Array>,
  plan: FontPlan,
  progress: (done: number, total: number) => void,
): Promise<{ nodes: number; diagnostics: Diagnostic[] }> {
  const ctx: Ctx = {
    fonts: plan.fonts,
    images: new Map(),
    assets: ir.assets,
    diagnostics: fontDiagnostics(plan),
    reported: new Set(),
    reflowed: [],
    clipped: [],
    built: 0,
    total: ir.captures.reduce((s, c) => s + [...walk(c.root)].length, 0),
    progress,
  };
  const loads = new Map([...plan.fonts.values()].map((f) => [fontKey(f), f]));
  await Promise.all([...loads.values()].map((f) => figma.loadFontAsync(f)));
  for (const [id, bytes] of Object.entries(assets)) ctx.images.set(id, figma.createImage(bytes).hash);

  // Each import goes to the right of everything already on the page, never on top of an earlier one.
  const right = Math.max(0, ...figma.currentPage.children.map((n) => n.x + n.width + CAPTURE_GAP));
  const section = figma.createSection();
  section.name = `web-to-figma · ${ir.captures[0]?.title ?? "import"}`;
  section.x = right;
  section.y = 0;
  try {
    let x = 0;
    let height = 0;
    for (const capture of ir.captures) {
      const frame = (await buildNode(capture.root, capture.root.bounds, ctx)) as FrameNode;
      frame.name = `${capture.title || capture.url} · ${capture.viewport.width}`;
      const ref = referenceLayer(capture, ir, ctx);
      if (ref) frame.insertChild(0, ref);
      section.appendChild(frame);
      frame.x = x;
      frame.y = 0;
      x += frame.width + CAPTURE_GAP;
      height = Math.max(height, frame.height);
    }
    section.resizeWithoutConstraints(Math.max(x - CAPTURE_GAP, 1), Math.max(height, 1));
  } catch (e) {
    section.remove(); // no half-built output
    throw e;
  }
  const [example] = ctx.reflowed;
  if (example) {
    ctx.diagnostics.push(
      diagnostic(
        "TEXT_REFLOW",
        `${ctx.reflowed.length} text node(s) wrap to a different height than in the browser, e.g. "${example.name}"`,
        { nodeId: example.id, fallback: "approximated", detail: { count: ctx.reflowed.length } },
      ),
    );
  }
  const [clipped] = ctx.clipped;
  if (clipped) {
    ctx.diagnostics.push(
      diagnostic(
        "TEXT_REFLOW",
        `${ctx.clipped.length} text node(s) render wider than measured and overflow a clipped parent, e.g. "${clipped.name}"`,
        { nodeId: clipped.id, fallback: "approximated", detail: { count: ctx.clipped.length } },
      ),
    );
  }
  figma.currentPage.selection = [section];
  figma.viewport.scrollAndZoomIntoView([section]);
  return { nodes: ctx.built, diagnostics: ctx.diagnostics };
}
