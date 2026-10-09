/**
 * Inline <svg> → standalone, inert SVG markup for Figma's createNodeFromSvg.
 * The page's CSS (classes, inheritance from HTML, currentColor) is resolved into presentation
 * attributes, sprites (`<use href="#id">`) are inlined, and everything that could run, fetch or
 * reference the page is removed: scripts, event handlers, foreignObject, <style>, animations and
 * any href or url() that is not a fragment or an inline raster image.
 */

const NS = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

/** Inherited paint properties: written only where they differ from the parent's. */
const INHERITED = [
  "color", // what currentColor resolves to inside sprites
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "clip-rule",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "letter-spacing",
] as const;
/** Not inherited: written where they differ from the initial value. */
const OWN: Record<string, string> = { opacity: "1", "stop-color": "rgb(0, 0, 0)", "stop-opacity": "1" };

const DROP = new Set([
  "script",
  "foreignobject",
  "style",
  "iframe",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "use", // only those left after inlining (external, missing or too deeply nested)
]);
/** Shapes and groups a page hides with display:none; never defs-like elements (not rendered anyway). */
const GRAPHIC = new Set([
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "image",
]);

const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g;
/** Computed url() paints may be absolute ("http://page/#grad"); keep only the fragment. */
const fragmentUrl = (v: string) => v.replace(/url\(\s*["']?[^"')#]*(#[^"')]+)["']?\s*\)/g, "url($1)");
const external = (v: string) => /url\(\s*["']?(?!#)/i.test(v);
/** Computed lengths carry "px"; SVG attributes are user units. */
const unitless = (v: string) => v.replace(/(\d)px\b/g, "$1");
const PAINT_PROPS = [...INHERITED, ...Object.keys(OWN)];
/**
 * SVG 2 geometry properties. CSS can set them (MUI X Charts draws every bar as `<rect style="x:…;
 * width:…">`), so they're lost with the `style` attribute unless copied back from computed style.
 */
const GEOMETRY: Record<string, string[]> = {
  rect: ["x", "y", "width", "height", "rx", "ry"],
  image: ["x", "y", "width", "height"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  path: ["d"],
};

/** `viewport`: the root's user-space size, which a sprite's 100% would resolve against. */
function inlineUses(clone: SVGSVGElement, viewport: { width: number; height: number }) {
  for (let depth = 0; depth < 3; depth++) {
    const uses = Array.from(clone.querySelectorAll("use"));
    if (uses.length === 0) return;
    for (const use of uses) {
      const href = use.getAttribute("href") ?? use.getAttributeNS(XLINK, "href") ?? "";
      const id = href.startsWith("#") ? href.slice(1) : "";
      const target = id
        ? (clone.querySelector(`[id="${CSS.escape(id)}"]`) ?? document.getElementById(id))
        : null;
      if (!target) continue; // removed with the rest below
      const g = document.createElementNS(NS, "g");
      for (const a of Array.from(use.attributes)) {
        if (!/^(x|y|width|height|href|xlink:href)$/.test(a.name)) g.setAttribute(a.name, a.value);
      }
      const x = use.getAttribute("x") ?? "0";
      const y = use.getAttribute("y") ?? "0";
      g.setAttribute("transform", `${use.getAttribute("transform") ?? ""} translate(${x} ${y})`.trim());
      let inner: Element;
      if (target.localName === "symbol") {
        inner = document.createElementNS(NS, "svg");
        for (const a of ["viewBox", "preserveAspectRatio"]) {
          const v = target.getAttribute(a);
          if (v) inner.setAttribute(a, v);
        }
        inner.setAttribute("width", use.getAttribute("width") ?? String(viewport.width));
        inner.setAttribute("height", use.getAttribute("height") ?? String(viewport.height));
        for (const c of Array.from(target.childNodes)) inner.append(c.cloneNode(true));
      } else {
        inner = target.cloneNode(true) as Element;
        inner.removeAttribute("id");
      }
      g.append(inner);
      use.replaceWith(g);
    }
  }
}

function strip(clone: SVGSVGElement, normalizeColor: (value: string) => string) {
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    if (DROP.has(el.localName.toLowerCase())) {
      el.remove();
      continue;
    }
    // Sprite content was copied, not computed: keep its inline paint as attributes. Classes are lost.
    const inline = (el as SVGElement).style;
    for (const p of inline ? PAINT_PROPS : []) {
      const v = inline.getPropertyValue(p);
      if (v && !v.includes("var("))
        // style beats presentation attributes, as in CSS
        el.setAttribute(p, unitless(fragmentUrl(v.replace(COLOR_FN, normalizeColor))));
    }
    for (const a of Array.from(el.attributes)) {
      // Copied sprite content may say currentColor; resolve it here rather than trust every importer.
      if (/currentcolor/i.test(a.value)) {
        const color = el.closest("[color]")?.getAttribute("color") ?? "rgb(0, 0, 0)";
        a.value = a.value.replace(/currentcolor/gi, color);
      }
      const name = a.name.toLowerCase();
      const isHref = name === "href" || name === "xlink:href";
      const unsafe =
        name.startsWith("on") ||
        name === "class" ||
        name === "style" ||
        (isHref && !(a.value.startsWith("#") || /^data:image\/(png|jpeg|gif|webp);/i.test(a.value))) ||
        (!isHref && external(a.value));
      if (unsafe) el.removeAttributeNode(a);
    }
  }
}

/** Sanitized markup, drawn at the element's rendered size. */
export function serializeSvg(
  svg: SVGSVGElement,
  size: { width: number; height: number },
  normalizeColor: (value: string) => string,
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const computed = new Map<Element, CSSStyleDeclaration>();
  const value = (cs: CSSStyleDeclaration, p: string) =>
    unitless(fragmentUrl(cs.getPropertyValue(p).replace(COLOR_FN, normalizeColor)));
  const hidden: Element[] = [];

  src.forEach((el, i) => {
    const out = dst[i];
    if (!out) return;
    const cs = getComputedStyle(el);
    computed.set(el, cs);
    if (cs.display === "none" && GRAPHIC.has(el.localName)) hidden.push(out);
    const parent = el === svg ? undefined : el.parentElement && computed.get(el.parentElement);
    for (const p of INHERITED) {
      out.removeAttribute(p);
      const v = value(cs, p);
      if (v && (!parent || v !== value(parent, p))) out.setAttribute(p, v);
    }
    for (const p of GEOMETRY[el.localName] ?? []) {
      const v = cs.getPropertyValue(p).trim();
      if (!v || v === "auto" || v === "none") continue;
      out.setAttribute(p, p === "d" ? v.replace(/^path\((["'])(.*)\1\)$/s, "$2") : unitless(v));
    }
    for (const [p, initial] of Object.entries(OWN)) {
      out.removeAttribute(p);
      if (el === svg && p === "opacity") continue; // the vector node carries it
      const v = value(cs, p);
      if (v && v !== initial) out.setAttribute(p, v);
    }
  });
  for (const el of hidden) el.remove();

  clone.setAttribute("xmlns", NS);
  clone.setAttribute("width", String(Math.round(size.width * 100) / 100));
  clone.setAttribute("height", String(Math.round(size.height * 100) / 100));
  const vb = clone.viewBox.baseVal;
  inlineUses(clone, vb && vb.width > 0 ? vb : size);
  strip(clone, normalizeColor);
  return new XMLSerializer().serializeToString(clone);
}
