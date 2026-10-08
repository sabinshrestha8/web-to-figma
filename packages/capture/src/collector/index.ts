/**
 * In-page collector. Bundled by esbuild into an IIFE (global `__w2f`) and evaluated inside the
 * captured page — so it must not import anything that isn't bundle-safe, and it only records
 * facts. Interpretation lives in @w2f/convert.
 */
import {
  COLOR_PROPS,
  EMBEDDED_COLOR_PROPS,
  MAX_SVG_CHARS,
  type RawElement,
  type RawNode,
  type RawRect,
  type RawSnapshot,
  STYLE_PROPS,
  type StyleProp,
} from "@w2f/convert/snapshot";
import { serializeSvg } from "./svg.ts";

const SKIP = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title", "base"]);

/** Any CSS color → `rgba(r, g, b, a)` in sRGB, by letting canvas do the conversion (oklch, lab, color()…). */
function colorNormalizer(): (value: string) => string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, string>();
  return (value) => {
    if (value.startsWith("rgb") || !ctx) return value;
    let out = cache.get(value);
    if (out === undefined) {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      out = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
      cache.set(value, out);
    }
    return out;
  };
}

/** Color functions inside shadows/gradients: normalize each one in place. */
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g;

/** Collapse white space but keep edge spaces: the converter joins inline neighbors, then trims. */
function collapse(text: string, whiteSpace: string): string {
  if (/^(pre|pre-wrap|break-spaces)$/.test(whiteSpace)) return text;
  if (whiteSpace === "pre-line") return text.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]+/g, " ");
  return text.replace(/\s+/g, " ");
}

const isInline = (n: ChildNode | null): boolean =>
  n !== null &&
  (n.nodeType === Node.TEXT_NODE ||
    (n.nodeType === Node.ELEMENT_NODE && getComputedStyle(n as Element).display.startsWith("inline")));

/** The snapshot, plus each recorded element by snapshot id (kept in the page for `isolate`). */
export function collect(opts: { maxNodes: number; dpr: number }): {
  snapshot: RawSnapshot;
  elements: Element[];
} {
  const elements: Element[] = [];
  const normalizeColor = colorNormalizer();
  const range = document.createRange();
  const nodes: RawNode[] = [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  const toRect = (r: DOMRect): RawRect => ({
    x: r.left + sx,
    y: r.top + sy,
    width: r.width,
    height: r.height,
  });
  let nextId = 0;
  let truncated = false;

  const visitText = (node: Text, parent: number, whiteSpace: string) => {
    const text = collapse(node.data, whiteSpace);
    if (!text) return;
    range.selectNodeContents(node);
    const lines = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map(toRect);
    // A space where a line wraps has no rect, but it still separates the words around it.
    const separator = text.trim() === "" && isInline(node.previousSibling) && isInline(node.nextSibling);
    if (lines.length || separator) nodes.push({ kind: "text", id: nextId++, parent, text, lines });
  };

  const visitChildren = (el: Element, parent: number | null, whiteSpace: string) => {
    for (const child of Array.from(el.childNodes)) {
      if (truncated) return;
      if (child.nodeType === Node.ELEMENT_NODE) visit(child as Element, parent);
      else if (child.nodeType === Node.TEXT_NODE && parent !== null)
        visitText(child as Text, parent, whiteSpace);
    }
  };

  const visit = (el: Element, parent: number | null): void => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (nodes.length >= opts.maxNodes) {
      truncated = true;
      return;
    }
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    if (cs.display === "contents") {
      visitChildren(el, parent, cs.whiteSpace);
      return;
    }

    const style = {} as Record<StyleProp, string>;
    for (const p of STYLE_PROPS) style[p] = cs.getPropertyValue(p);
    for (const p of COLOR_PROPS) style[p] = normalizeColor(style[p]);
    for (const p of EMBEDDED_COLOR_PROPS) {
      if (style[p] !== "none") style[p] = style[p].replace(COLOR_FN, normalizeColor);
    }

    const attrs: Record<string, string> = {};
    const className = el.getAttribute("class");
    if (el.id) attrs.id = el.id;
    if (className) attrs.className = className;
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) attrs.ariaLabel = ariaLabel;
    const testId = el.getAttribute("data-testid");
    if (testId) attrs.testId = testId;
    if (el instanceof HTMLInputElement) attrs.type = el.type;

    const id = nextId++;
    elements[id] = el;
    const raw: RawElement = {
      kind: "element",
      id,
      parent,
      tag,
      rect: toRect(el.getBoundingClientRect()),
      style,
      attrs,
    };
    const transformed = style.transform !== "none" || style.rotate !== "none" || style.scale !== "none";
    if (transformed && el instanceof HTMLElement) {
      raw.layoutSize = { width: el.offsetWidth, height: el.offsetHeight };
    }
    if (el instanceof HTMLImageElement) {
      const broken = el.complete && el.naturalWidth === 0 && el.naturalHeight === 0;
      raw.image = {
        src: el.currentSrc || el.src,
        width: el.naturalWidth,
        height: el.naturalHeight,
        state: broken ? "failed" : el.complete ? "loaded" : "pending",
      };
    }
    if (el instanceof SVGSVGElement) {
      const markup = serializeSvg(el, raw.rect, normalizeColor);
      if (markup.length <= MAX_SVG_CHARS) raw.svg = markup; // else a raster island
    }
    nodes.push(raw);
    if (tag === "svg" || tag === "iframe") return; // svg content is in its markup; frames are never entered
    visitChildren(el, id, cs.whiteSpace);
  };

  visit(document.documentElement, null);
  const snapshot: RawSnapshot = {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: opts.dpr },
    documentSize: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    nodes,
    truncated,
  };
  return { snapshot, elements };
}

const ISLAND = "data-w2f-island";
const ANCESTOR = "data-w2f-ancestor";
const ISOLATE_STYLE = "__w2f-isolate";

/**
 * Show only `elements[id]` and its subtree, on a transparent canvas, so a raster island holds just
 * its own pixels: not the siblings drawn over it, nor the backgrounds under it. Opacity and blending
 * of its ancestors are neutralized because the IR applies them again. `null` restores the page.
 */
export function isolate(elements: Element[], id: number | null): boolean {
  document.getElementById(ISOLATE_STYLE)?.remove();
  for (const el of Array.from(document.querySelectorAll(`[${ISLAND}],[${ANCESTOR}]`))) {
    el.removeAttribute(ISLAND);
    el.removeAttribute(ANCESTOR);
  }
  const target = id === null ? undefined : elements[id];
  if (!target) return false;
  target.setAttribute(ISLAND, "");
  for (let p = target.parentElement; p; p = p.parentElement) p.setAttribute(ANCESTOR, "");
  const visible = [`[${ISLAND}]`, `[${ISLAND}] *`]
    .flatMap((sel) => [sel, `${sel}::before`, `${sel}::after`])
    .join(",");
  const style = document.createElement("style");
  style.id = ISOLATE_STYLE;
  style.textContent = [
    "*,*::before,*::after{visibility:hidden!important;transition:none!important}",
    "html,body{background:transparent!important}",
    `[${ANCESTOR}]{opacity:1!important;mix-blend-mode:normal!important}`,
    `${visible}{visibility:visible!important}`,
  ].join("\n");
  document.documentElement.append(style);
  return true;
}

export function fontsReady(): Promise<boolean> {
  return document.fonts.ready.then(() => true);
}

export function nextFrames(): Promise<boolean> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
}

/**
 * App-shell layouts (`html, body { height: 100% }` + a scrolling `<main>`) never scroll the document,
 * so a full-page capture would stop at the fold. Returns how many px the main inner scroller hides,
 * or 0 when the document scrolls itself or no scroller covers at least half the viewport each way.
 */
export function hiddenScrollHeight(): number {
  const doc = document.scrollingElement ?? document.documentElement;
  if (doc.scrollHeight > window.innerHeight + 1) return 0;
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (el.scrollHeight - el.clientHeight <= 1) continue;
    if (el.clientHeight < window.innerHeight / 2 || el.clientWidth < window.innerWidth / 2) continue;
    if (!/^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) [best, bestArea] = [el, area];
  }
  return best ? best.scrollHeight - best.clientHeight : 0;
}

/** Scroll the page in viewport steps so lazy content loads, then return to the top. */
export async function scrollThrough(maxHeight: number): Promise<boolean> {
  const step = Math.max(200, window.innerHeight);
  const end = Math.min(document.documentElement.scrollHeight, maxHeight);
  for (let y = 0; y < end; y += step) {
    window.scrollTo({ top: y, behavior: "instant" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  return nextFrames();
}

export { decodeImage } from "./decode.ts";
