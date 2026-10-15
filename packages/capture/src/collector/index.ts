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
import { paintsPseudo } from "./pseudo.ts";
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
const PX = /(-?\d*\.?\d+(?:e-?\d+)?)px/g;

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
export function collect(opts: { maxNodes: number; dpr: number; ignore?: string[] }): {
  snapshot: RawSnapshot;
  elements: Element[];
} {
  const elements: Element[] = [];
  /** Effective CSS zoom per element id (the product of its ancestors' `zoom`). */
  const zooms: number[] = [];
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
  const ignored = new Set<Element>();
  const ignoreUnused: NonNullable<RawSnapshot["ignoreUnused"]> = [];
  for (const selector of opts.ignore ?? []) {
    let matches: Element[];
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch (e) {
      if (!(e instanceof DOMException)) throw e;
      ignoreUnused.push({ selector, reason: "invalid" });
      continue;
    }
    if (matches.length === 0) ignoreUnused.push({ selector, reason: "no match" });
    for (const m of matches) ignored.add(m);
  }

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

    // CSS `zoom` scales an element's rects but not its computed lengths (padding, font-size, …):
    // scale those to match, so they agree with the rects the IR is built from.
    const zoom = (parent === null ? 1 : (zooms[parent] ?? 1)) * (Number.parseFloat(cs.zoom) || 1);
    const style = {} as Record<StyleProp, string>;
    for (const p of STYLE_PROPS) style[p] = cs.getPropertyValue(p);
    if (zoom !== 1) {
      for (const p of STYLE_PROPS)
        style[p] = style[p].replace(PX, (_, n: string) => `${Math.round(Number(n) * zoom * 1000) / 1000}px`);
    }
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
    zooms[id] = zoom;
    const raw: RawElement = {
      kind: "element",
      id,
      parent,
      tag,
      rect: toRect(el.getBoundingClientRect()),
      style,
      attrs,
    };
    if (ignored.has(el)) raw.ignore = true;
    // Painted ::before/::after has no DOM node, so only its existence is recorded (PSEUDO_ELEMENT_SKIPPED).
    const pseudos = (["::before", "::after"] as const).filter((pseudo) => {
      let pcs: CSSStyleDeclaration;
      try {
        pcs = getComputedStyle(el, pseudo);
      } catch {
        return false;
      }
      return paintsPseudo((prop) => {
        const v = pcs.getPropertyValue(prop);
        return prop === "background-color" ? normalizeColor(v) : v;
      });
    });
    if (pseudos.length > 0)
      raw.pseudo = pseudos.length === 2 ? "both" : pseudos[0] === "::before" ? "before" : "after";
    const transformed = style.transform !== "none" || style.rotate !== "none" || style.scale !== "none";
    if (transformed && el instanceof HTMLElement) {
      raw.layoutSize = { width: el.offsetWidth * zoom, height: el.offsetHeight * zoom };
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
    ...(ignoreUnused.length ? { ignoreUnused } : {}),
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

/** The element scrolling most of the window (at least half of it each way), or null. */
function mainScroller(): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (el.scrollHeight - el.clientHeight <= 1) continue;
    if (el.clientHeight < window.innerHeight / 2 || el.clientWidth < window.innerWidth / 2) continue;
    if (!/^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) [best, bestArea] = [el, area];
  }
  return best;
}

/**
 * App-shell layouts (`html, body { height: 100% }` + a scrolling `<main>`) never scroll the document,
 * so a full-page capture would stop at the fold. Returns how many px the main inner scroller hides,
 * or 0 when the document scrolls itself or no scroller covers at least half the viewport each way.
 */
export function hiddenScrollHeight(): number {
  const doc = document.scrollingElement ?? document.documentElement;
  if (doc.scrollHeight > window.innerHeight + 1) return 0;
  const best = mainScroller();
  return best ? best.scrollHeight - best.clientHeight : 0;
}

const unrolled = new Map<HTMLElement, string | null>();
const scrolled = new Map<HTMLElement, number>();
/** The unroll in progress, so a later call can grow it further (content rendered on coming into view). */
let unroll: {
  targets: Set<HTMLElement>;
  /** Grew without showing more (its script resets its height, or its content grows with it). */
  stuck: Set<HTMLElement>;
  windowTall: HTMLElement[];
  added: number;
  log: string[];
} | null = null;

/** CSS `zoom` in effect: rects are on-screen px, everything else (client/scroll sizes, styles) is CSS px. */
const zoom = (el: Element) => el.currentCSSZoom ?? 1;
/** On-screen px cut off at its bottom. */
const hides = (el: Element) => (el.scrollHeight - el.clientHeight) * zoom(el);

/**
 * Elements cutting content off at their bottom that are part of the page's frame: at least half the
 * window each way, so a sidebar, a card's scrolling list, a collapsed accordion or a "show more" box
 * is left alone. Deepest first: an outer one's hidden part may be the inner one's.
 */
function clippers(skip: Set<HTMLElement>): HTMLElement[] {
  const found = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
    (el) =>
      hides(el) > 1 &&
      !skip.has(el) &&
      // Closed drawers and hidden overlays still have a size.
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
      el.clientWidth * zoom(el) >= window.innerWidth / 2 &&
      el.clientHeight * zoom(el) >= window.innerHeight / 2 &&
      /^(auto|scroll|overlay|hidden|clip)$/.test(getComputedStyle(el).overflowY),
  );
  return found.filter((el) => !found.some((d) => d !== el && el.contains(d)));
}

/**
 * The extension's `hiddenScrollHeight` fix: it can't make the window taller, so each panel that cuts
 * content off (the scrolling `<main>`, a fixed-height panel inside it, a full-height panel under a
 * summary) grows by what it hides, its ancestors with it, innermost first, until none hides anything
 * (up to `maxHeight` in all) or `restoreUnroll`. Each is grown from its top, wherever the user had
 * scrolled it. Elements as tall as the window (100vh or `inset-y-0` sidebars) grow to the new height,
 * as they would in a taller window. Call again after the page reacts (lazy widgets that render once
 * in view) to grow by what it hides now. Returns the px added in all.
 */
export function unrollInPlace(maxHeight: number): number {
  if (!unroll) {
    if (hiddenScrollHeight() <= 1) return 0;
    // ponytail: "as tall as the window" stands in for 100vh, which computed styles don't reveal.
    const windowTall = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
      (el) => Math.abs(el.getBoundingClientRect().height / zoom(el) - window.innerHeight) <= 1,
    );
    unroll = { targets: new Set(), stuck: new Set(), windowTall, added: 0, log: [] };
  }
  const { targets, stuck } = unroll;
  for (let round = 0; round < 12; round++) {
    const target = clippers(stuck).sort((a, b) => hides(b) - hides(a))[0];
    if (!target) break;
    if (target.scrollTop > 0) {
      if (!scrolled.has(target)) scrolled.set(target, target.scrollTop);
      target.scrollTop = 0;
    }
    const hidden = hides(target);
    const extra = Math.min(hidden, maxHeight - window.innerHeight - unroll.added);
    if (extra <= 1) break;
    // Measure the whole chain first: a grown child would already stretch an auto-height parent.
    const chain: { el: HTMLElement; height: number }[] = [];
    for (let el: HTMLElement | null = target; el; el = el.parentElement)
      chain.push({
        el,
        // html/body can be 0 tall under a position:fixed shell; the document must still reach its end.
        height: Math.max(
          el.getBoundingClientRect().height,
          el === document.documentElement || el === document.body ? window.innerHeight : 0,
        ),
      });
    const before = chain.map(({ el }) => ({ el, style: el.getAttribute("style"), had: unrolled.has(el) }));
    for (const { el, height } of chain) grow(el, height + extra);
    if (hides(target) > hidden - extra / 2) {
      // Growing it didn't show (much) more: undo, or every round would add blank height.
      for (const { el, style, had } of before) {
        if (style === null) el.removeAttribute("style");
        else el.setAttribute("style", style);
        if (!had) unrolled.delete(el);
      }
      stuck.add(target);
      unroll.log.push(
        `${describe(target)} (left as is: hid ${Math.round(hidden)}px, still ${Math.round(hides(target))}px after growing ${Math.round(extra)}px)`,
      );
      continue;
    }
    targets.add(target);
    unroll.added += extra;
    unroll.log.push(`${describe(target)} +${Math.round(extra)}px`);
  }
  if (targets.size > 0) unroll.added = contain(targets);
  // Not around or inside a grown panel: those are sized already, or growing them changes what it hides.
  const full = window.innerHeight + unroll.added;
  for (const el of unroll.windowTall) {
    if ([...targets].some((t) => t.contains(el) || el.contains(t))) continue;
    if (el.getBoundingClientRect().height / zoom(el) < full - 1) grow(el, full * zoom(el));
  }
  return unroll.added;
}

const describe = (el: Element) =>
  `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${Array.from(el.classList)
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("")}`;

/** What the unroll in progress grew (or gave up on), for the diagnostic. */
export function unrollLog(): string {
  return unroll?.log.join("; ") ?? "";
}

const px = (v: string) => Number.parseFloat(v) || 0;
/** Padding and border below the content box. */
const below = (cs: CSSStyleDeclaration) => px(cs.paddingBottom) + px(cs.borderBottomWidth);

/**
 * Each grown panel's ancestors reach at least its bottom (their own heights can't be trusted to: a
 * flex item's basis or a shell's script may have sized them) and html/body end exactly where the
 * content does, so nothing is cut off and no blank page follows. Returns the px added to the window.
 */
function contain(targets: Set<HTMLElement>): number {
  const root = document.documentElement;
  let end = window.innerHeight;
  for (const t of targets) {
    let child: HTMLElement = t;
    for (let el = t.parentElement; el && el !== document.body && el !== root; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      const need = child.getBoundingClientRect().bottom - r.top + below(getComputedStyle(el)) * zoom(el);
      if (r.height < need - 0.5) grow(el, need);
      child = el;
    }
    end = Math.max(end, child.getBoundingClientRect().bottom - root.getBoundingClientRect().top);
  }
  for (const el of [document.body, root]) grow(el, end);
  return end - window.innerHeight;
}

/** Sets `el`'s on-screen border-box height (whatever its box-sizing and zoom) until `restoreUnroll`. */
function grow(el: HTMLElement, height: number): void {
  if (!unrolled.has(el)) unrolled.set(el, el.getAttribute("style"));
  const cs = getComputedStyle(el);
  const extra = cs.boxSizing === "content-box" ? below(cs) + px(cs.paddingTop) + px(cs.borderTopWidth) : 0;
  el.style.setProperty("height", `${Math.max(0, height / zoom(el) - extra)}px`, "important");
  el.style.setProperty("max-height", "none", "important");
}

export function restoreUnroll(): boolean {
  for (const [el, style] of unrolled) {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }
  for (const [el, top] of scrolled) el.scrollTop = top;
  unrolled.clear();
  scrolled.clear();
  unroll = null;
  return true;
}

/**
 * `scrollThrough` for app shells: scroll each panel that cuts content off from top to bottom, a
 * screen at a time, so widgets that render on coming into view do (once grown, they'd sit below the
 * window, where nothing ever scrolls to them). Then each goes back to where it was.
 */
export async function scrollPanels(maxHeight: number): Promise<boolean> {
  if (hiddenScrollHeight() <= 1) return true;
  for (const el of clippers(new Set())) {
    const start = el.scrollTop;
    const end = el.scrollHeight - el.clientHeight;
    for (let y = 0; y <= Math.min(end, maxHeight); y += Math.max(200, el.clientHeight * 0.8)) {
      el.scrollTop = y;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    el.scrollTop = el.scrollHeight - el.clientHeight;
    await new Promise((resolve) => setTimeout(resolve, 150));
    el.scrollTop = start;
  }
  return nextFrames();
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

export { type DecodeArgs, type DecodeResult, decodeImage } from "./decode.ts";
