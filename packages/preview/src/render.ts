import type { BoxNode, Capture, Effect, Node, Paint, RGBA, TextNode } from "@w2f/ir";

/**
 * IR → HTML of absolutely positioned elements, read back the way Figma would draw it. It measures
 * how much the DOM → IR step loses (the visual diff compares it with the original page), so it
 * renders only what the IR says, never anything from the source page.
 * `assets` maps asset ids to URLs the viewer can load (data: URLs in tests).
 */
export function renderIRToHtml(capture: Capture, assets: Record<string, string>): string {
  const { root } = capture;
  return node(root, { x: root.bounds.x, y: root.bounds.y }, assets);
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const n2 = (n: number) => Math.round(n * 100) / 100;
const rgba = (c: RGBA) => `rgba(${n2(c.r * 255)}, ${n2(c.g * 255)}, ${n2(c.b * 255)}, ${n2(c.a)})`;
const stops = (s: { position: number; color: RGBA }[]) =>
  s.map((x) => `${rgba(x.color)} ${n2(x.position * 100)}%`).join(", ");

/** One background layer per paint, in CSS order (top-most first) by the caller. */
function background(p: Paint, w: number, h: number, assets: Record<string, string>): string {
  switch (p.type) {
    case "solid":
      return `linear-gradient(${rgba(p.color)}, ${rgba(p.color)})`;
    case "linear":
      return `linear-gradient(${n2(p.angle)}deg, ${stops(p.stops)})`;
    case "radial":
      return `radial-gradient(${n2(p.radius.x * w)}px ${n2(p.radius.y * h)}px at ${n2(p.center.x * 100)}% ${n2(p.center.y * 100)}%, ${stops(p.stops)})`;
    case "image": {
      const url = `url("${esc(assets[p.assetId] ?? "")}")`;
      const pos = `${n2(p.position.x * 100)}% ${n2(p.position.y * 100)}%`;
      if (p.scale === "tile" && p.tileSize)
        return `${url} 0 0 / ${p.tileSize.width}px ${p.tileSize.height}px repeat`;
      const size = { cover: "cover", contain: "contain", stretch: "100% 100%", tile: "auto", none: "auto" }[
        p.scale
      ];
      return `${url} ${pos} / ${size} ${p.scale === "tile" ? "repeat" : "no-repeat"}`;
    }
  }
}

function effectsCss(effects: Effect[]): string[] {
  const shadows = effects
    .filter((e) => e.type === "shadow")
    .map(
      (e) =>
        `${e.inset ? "inset " : ""}${e.offset.x}px ${e.offset.y}px ${e.blur}px ${e.spread}px ${rgba(e.color)}`,
    )
    .reverse(); // IR is bottom-most first; CSS lists the top-most first
  const css: string[] = [];
  if (shadows.length) css.push(`box-shadow:${shadows.join(", ")}`);
  for (const e of effects) {
    // Figma blur radius = 2 × CSS blur standard deviation (see docs/mapping.md).
    if (e.type === "layer-blur") css.push(`filter:blur(${e.radius / 2}px)`);
    if (e.type === "background-blur") css.push(`backdrop-filter:blur(${e.radius / 2}px)`);
  }
  return css;
}

function common(n: Node, origin: { x: number; y: number }): string[] {
  const b = n.bounds;
  return [
    "position:absolute",
    "box-sizing:border-box",
    `left:${n2(b.x - origin.x)}px`,
    `top:${n2(b.y - origin.y)}px`,
    `width:${b.width}px`,
    `height:${b.height}px`,
    ...(n.opacity !== 1 ? [`opacity:${n.opacity}`] : []),
    ...(n.blendMode !== "normal" ? [`mix-blend-mode:${n.blendMode}`] : []),
    ...(n.rotation ? [`transform:rotate(${n.rotation}deg)`] : []),
    ...effectsCss(n.effects),
  ];
}

function fontCss(s: TextNode["runs"][number]["style"]): string[] {
  return [
    `font-family:${s.families.map((f) => `"${f.replace(/["\\]/g, "")}"`).join(", ")}`,
    `font-weight:${s.weight}`,
    `font-style:${s.italic ? "italic" : "normal"}`,
    `font-size:${s.size}px`,
    `line-height:${s.lineHeight === "auto" ? "normal" : `${s.lineHeight}px`}`,
    `letter-spacing:${s.letterSpacing}px`,
    `text-transform:${s.transform}`,
    `text-decoration:${s.decoration}`,
    `color:${rgba(s.color)}`,
  ];
}

function text(t: TextNode, origin: { x: number; y: number }): string {
  const spans = t.runs.map(
    (r) =>
      `<span style="${esc(fontCss(r.style).join(";"))}">${esc(t.characters.slice(r.start, r.end))}</span>`,
  );
  // The container carries the first run's font too: otherwise its own (inherited) font and
  // line-height form the line's strut and shift the baseline of smaller text.
  const first = t.runs[0]?.style;
  const css = [
    ...common(t, origin),
    ...(first ? fontCss(first) : []),
    `text-align:${t.align}`,
    `white-space:${t.autoResize === "width-and-height" ? "pre" : "pre-wrap"}`,
  ];
  return `<div data-id="${esc(t.id)}" style="${esc(css.join(";"))}">${spans.join("")}</div>`;
}

function node(n: Node, origin: { x: number; y: number }, assets: Record<string, string>): string {
  if (n.type === "text") return text(n, origin);
  if (n.type === "vector") {
    // An <img> never runs script, so the SVG markup stays inert.
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(n.svg)}`;
    return `<img data-id="${esc(n.id)}" alt="" src="${esc(src)}" style="${esc(common(n, origin).join(";"))}">`;
  }
  return box(n, origin, assets);
}

function box(b: BoxNode, origin: { x: number; y: number }, assets: Record<string, string>): string {
  const { width: w, height: h } = b.bounds;
  const radius = b.radius.some((r) => r > 0)
    ? `border-radius:${b.radius.map((r) => `${r}px`).join(" ")}`
    : "";
  const css = [...common(b, origin), radius, b.clip ? "overflow:hidden" : ""];
  if (b.fills.length)
    css.push(
      `background:${[...b.fills]
        .reverse()
        .map((p) => background(p, w, h, assets))
        .join(", ")}`,
    );
  // The stroke is its own layer so it doesn't shift the absolutely positioned children (a CSS
  // border would offset their containing block). Below the children like a CSS border; above them
  // when the box clips, since CSS then clips children inside the border and they never cover it.
  const stroke = b.stroke
    ? `<div style="${esc(
        [
          "position:absolute",
          "inset:0",
          "box-sizing:border-box",
          "border-radius:inherit",
          `border-style:${b.stroke.style}`,
          `border-color:${rgba(b.stroke.color)}`,
          `border-width:${b.stroke.weights.top}px ${b.stroke.weights.right}px ${b.stroke.weights.bottom}px ${b.stroke.weights.left}px`,
        ].join(";"),
      )}"></div>`
    : "";
  const kids = b.children.map((c) => node(c, { x: b.bounds.x, y: b.bounds.y }, assets)).join("");
  const inner = b.clip ? kids + stroke : stroke + kids;
  return `<div data-id="${esc(b.id)}" style="${esc(css.filter(Boolean).join(";"))}">${inner}</div>`;
}
