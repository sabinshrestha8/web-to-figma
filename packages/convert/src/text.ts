import type { RGBA, TextNode, TextRun, TextStyle } from "@w2f/ir";
import { parseTextShadow } from "./box.ts";
import { parseColor, parseFontFamilies, px, round2, textAlign, textTransform } from "./css.ts";
import type { Report } from "./report.ts";
import type { RawElement, RawRect, RawText } from "./snapshot.ts";

type Decoration = TextStyle["decoration"];
export type KidsOf = (el: RawElement) => (RawElement | RawText)[];

/** A run of a block's inline content (text and box-less inline elements), drawn as one text node. */
export interface InlineGroup {
  kind: "inline";
  nodes: (RawElement | RawText)[];
  /** Follows an inline box on the same line: its leading space is drawn (and inside its rect). */
  afterInlineBox: boolean;
}

export interface TextContext {
  captureId: string;
  report: Report;
  kidsOf: KidsOf;
  decorationOf: (el: RawElement) => Decoration;
  /** Selector of the block that owns the text (for `source`). */
  selector: string;
  /** Text starting at or below this y is past the capture's height cap. */
  maxY: number;
}

const ATOMIC = new Set([
  "img",
  "svg",
  "video",
  "canvas",
  "iframe",
  "input",
  "textarea",
  "select",
  "button",
  "object",
  "embed",
  "audio",
  "math",
]);
const SIDES = ["top", "right", "bottom", "left"] as const;
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
const zero = (v: string) => (px(v) ?? 0) === 0;

/**
 * An inline element that paints no box of its own and holds only such content (strong, em, a, span…):
 * its text joins the surrounding paragraph as style runs. Anything with a box — background, border,
 * padding, shadow, transform, offset, its own text-shadow — keeps its own node.
 */
export function isPlainInline(el: RawElement, root: RawElement, kidsOf: KidsOf): boolean {
  if (el.tag === "br") return true;
  const s = el.style;
  const plain =
    s.display === "inline" &&
    !ATOMIC.has(el.tag) &&
    s.position === "static" &&
    s["vertical-align"] === "baseline" &&
    s.visibility === root.style.visibility &&
    Number.parseFloat(s.opacity) === 1 &&
    s["mix-blend-mode"] === "normal" &&
    parseColor(s["background-color"]) === null &&
    s["background-image"] === "none" &&
    s["box-shadow"] === "none" &&
    s["text-shadow"] === root.style["text-shadow"] &&
    s.filter === "none" &&
    s["backdrop-filter"] === "none" &&
    s["clip-path"] === "none" &&
    s["mask-image"] === "none" &&
    s.transform === "none" &&
    s.rotate === "none" &&
    s.scale === "none" &&
    (s["outline-style"] === "none" || zero(s["outline-width"])) &&
    SIDES.every(
      (d) =>
        zero(s[`padding-${d}` as const]) &&
        (zero(s[`border-${d}-width` as const]) || s[`border-${d}-style` as const] === "none"),
    );
  return plain && kidsOf(el).every((k) => k.kind === "text" || isPlainInline(k, root, kidsOf));
}

/** A block's children in DOM order, with each run of inline content gathered into one group. */
export function inlineGroups(
  kids: (RawElement | RawText)[],
  root: RawElement,
  kidsOf: KidsOf,
): (RawElement | InlineGroup)[] {
  const out: (RawElement | InlineGroup)[] = [];
  let group: InlineGroup | null = null;
  let prev: RawElement | null = null;
  for (const k of kids) {
    if (k.kind === "element" && !isPlainInline(k, root, kidsOf)) {
      group = null;
      prev = k;
      out.push(k);
      continue;
    }
    if (!group) {
      group = {
        kind: "inline",
        nodes: [],
        afterInlineBox: prev?.style.display.startsWith("inline") ?? false,
      };
      out.push(group);
    }
    group.nodes.push(k);
  }
  return out;
}

/**
 * Text decorations are not inherited, they propagate: an underlined <a> underlines its <strong>.
 * They stop at atomic inlines (inline-block…) and out-of-flow boxes. Figma has one decoration per
 * range, so an underline wins over an inherited line-through.
 */
export function decorationResolver(elements: Map<number, RawElement>): (el: RawElement) => Decoration {
  const memo = new Map<number, Decoration>();
  const of = (el: RawElement): Decoration => {
    let d = memo.get(el.id);
    if (d === undefined) {
      const line = el.style["text-decoration-line"];
      const parent = el.parent === null ? undefined : elements.get(el.parent);
      const isolated = el.style.display.startsWith("inline-") || /^(absolute|fixed)$/.test(el.style.position);
      if (line.includes("underline")) d = "underline";
      else if (line.includes("line-through")) d = "line-through";
      else d = isolated || !parent ? "none" : of(parent);
      memo.set(el.id, d);
    }
    return d;
  };
  return of;
}

/** Merge line fragments that share a visual line (inline boxes, bidi runs) into one rect per line. */
export function groupLines(fragments: RawRect[]): RawRect[] {
  const lines: RawRect[] = [];
  for (const f of [...fragments].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && f.y + f.height / 2 < last.y + last.height) {
      const x = Math.min(last.x, f.x);
      const y = Math.min(last.y, f.y);
      last.width = Math.max(last.x + last.width, f.x + f.width) - x;
      last.height = Math.max(last.y + last.height, f.y + f.height) - y;
      last.x = x;
      last.y = y;
    } else {
      lines.push({ ...f });
    }
  }
  return lines;
}

function contentBox(el: RawElement): RawRect {
  const s = el.style;
  const left = (px(s["padding-left"]) ?? 0) + (px(s["border-left-width"]) ?? 0);
  const right = (px(s["padding-right"]) ?? 0) + (px(s["border-right-width"]) ?? 0);
  const top = (px(s["padding-top"]) ?? 0) + (px(s["border-top-width"]) ?? 0);
  const bottom = (px(s["padding-bottom"]) ?? 0) + (px(s["border-bottom-width"]) ?? 0);
  return {
    x: el.rect.x + left,
    y: el.rect.y + top,
    width: Math.max(0, el.rect.width - left - right),
    height: Math.max(0, el.rect.height - top - bottom),
  };
}

function runStyle(el: RawElement, decoration: Decoration): TextStyle {
  const s = el.style;
  const lineHeight = px(s["line-height"]);
  return {
    families: parseFontFamilies(s["font-family"]),
    weight: Math.min(1000, Math.max(1, Number.parseInt(s["font-weight"], 10) || 400)),
    italic: /^(italic|oblique)/.test(s["font-style"]),
    size: px(s["font-size"]) ?? 16,
    lineHeight: lineHeight === null ? "auto" : round2(lineHeight),
    letterSpacing: round2(px(s["letter-spacing"]) ?? 0),
    transform: textTransform(s["text-transform"]),
    decoration,
    color: parseColor(s.color) ?? TRANSPARENT,
  };
}

interface Segment {
  text: string;
  lines: RawRect[];
  /** The element whose computed style the text has. */
  el: RawElement;
}

function segments(nodes: (RawElement | RawText)[], el: RawElement, kidsOf: KidsOf): Segment[] {
  return nodes.flatMap((n): Segment[] => {
    if (n.kind === "text") return [{ text: n.text, lines: n.lines, el }];
    if (n.tag === "br") return [{ text: "\n", lines: [], el: n }];
    return segments(kidsOf(n), n, kidsOf);
  });
}

const sameStyle = (a: TextStyle, b: TextStyle) => JSON.stringify(a) === JSON.stringify(b);

/** Characters and style runs of a group, with white space collapsed across element boundaries. */
function characterRuns(segs: Segment[], collapsible: boolean, keepLeadingSpace: boolean, ctx: TextContext) {
  let characters = "";
  const runs: TextRun[] = [];
  const dropLast = () => {
    characters = characters.slice(0, -1);
    const last = runs.at(-1);
    if (last && --last.end === last.start) runs.pop();
  };
  for (const seg of segs) {
    let t = seg.text;
    if (collapsible) {
      const lineStart = characters === "" ? !keepLeadingSpace : /[ \n]$/.test(characters);
      if (t.startsWith(" ") && lineStart) t = t.slice(1);
      if (t.startsWith("\n") && characters.endsWith(" ")) dropLast(); // a space before a break is not drawn
    }
    if (!t) continue;
    const style = runStyle(seg.el, ctx.decorationOf(seg.el));
    const last = runs.at(-1);
    if (last && sameStyle(last.style, style)) last.end += t.length;
    else runs.push({ start: characters.length, end: characters.length + t.length, style });
    characters += t;
  }
  if (collapsible) while (characters.endsWith(" ")) dropLast();
  if (characters.endsWith("\n")) dropLast(); // a final line break does not open a new line
  return { characters, runs };
}

/**
 * One text node per run of inline content: its characters, a style run per change of font, color or
 * decoration, and bounds that follow Figma's model — the box spans whole line boxes. Range rects
 * cover only the font's content area, so with an explicit line-height each line grows by its
 * half-leading. Multi-line text takes the block's content width so it wraps alike.
 */
export function inlineText(group: InlineGroup, root: RawElement, ctx: TextContext): TextNode | null {
  if (root.style.visibility !== "visible") return null;
  const segs = segments(group.nodes, root, ctx.kidsOf);
  const lines = groupLines(segs.flatMap((s) => s.lines));
  const first = lines[0];
  const [head] = group.nodes;
  if (!first || !head || first.y >= ctx.maxY) return null;

  const collapsible = !/^(pre|pre-wrap|break-spaces)$/.test(root.style["white-space"]);
  const { characters, runs } = characterRuns(segs, collapsible, group.afterInlineBox, ctx);
  if (!characters.trim() || runs.every((r) => r.style.color.a === 0)) return null;

  const id = `${ctx.captureId}:${head.id}`;
  const s = root.style;
  const lineHeight = px(s["line-height"]);
  const multiLine = lines.length > 1;
  const content = contentBox(root);
  const last = lines.at(-1) ?? first;
  const align = textAlign(s["text-align"]);
  if (s["text-overflow"] === "ellipsis" && multiLine) {
    ctx.report.add(
      "UNSUPPORTED_CSS",
      "text-overflow: ellipsis on wrapped text is drawn as clipped full text",
      id,
      "approximated",
    );
  }
  if (multiLine && align === "left" && first.x > content.x + 1) {
    ctx.report.add(
      "UNSUPPORTED_CSS",
      "multi-line text starting mid-line (after an inline box, or text-indent) is drawn from the line start",
      id,
      "approximated",
    );
  }

  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.x + l.width));
  const x = multiLine ? content.x : left;
  // `truncate`: one line cut at the clipping content box with "…", like Figma's ENDING truncation.
  const truncate =
    s["text-overflow"] === "ellipsis" &&
    !multiLine &&
    s["overflow-x"] !== "visible" &&
    right > content.x + content.width + 0.5;
  const width = multiLine ? content.width : truncate ? content.x + content.width - left : right - left;
  const y = lineHeight === null ? first.y : first.y - (lineHeight - first.height) / 2;
  const height = lineHeight === null ? last.y + last.height - first.y : lineHeight * lines.length;

  return {
    id,
    type: "text",
    name: characters.slice(0, 40),
    bounds: {
      x: round2(x),
      y: round2(y),
      width: round2(Math.max(0, width)),
      height: round2(Math.max(0, height)),
    },
    opacity: 1,
    blendMode: "normal",
    effects: parseTextShadow(s["text-shadow"]),
    position: "flow",
    sizing: { horizontal: multiLine || truncate ? "fixed" : "hug", vertical: "hug" },
    source: { tag: "#text", selector: ctx.selector },
    characters,
    runs,
    align,
    autoResize: multiLine || truncate ? "height" : "width-and-height",
    lineCount: lines.length,
    ...(truncate ? { truncate } : {}),
  };
}
