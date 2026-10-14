import { type RawElement, type RawSnapshot, type RawText, STYLE_PROPS, type StyleProp } from "./snapshot.ts";

/** Builders for hand-written snapshots in tests: every computed style at its initial value. */
export const defaults: Record<StyleProp, string> = {
  ...(Object.fromEntries(STYLE_PROPS.map((p) => [p, "0px"])) as Record<StyleProp, string>),
  display: "block",
  visibility: "visible",
  opacity: "1",
  position: "static",
  "white-space": "normal",
  "background-color": "rgba(0, 0, 0, 0)",
  color: "rgb(0, 0, 0)",
  "font-family": "Inter, sans-serif",
  "font-size": "16px",
  "font-weight": "400",
  "font-style": "normal",
  "line-height": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-transform": "none",
  "text-decoration-line": "none",
  "text-overflow": "clip",
  "vertical-align": "baseline",
  "object-fit": "fill",
  "object-position": "50% 50%",
  ...Object.fromEntries(
    ["top", "right", "bottom", "left"].flatMap((side) => [
      [`border-${side}-style`, "none"],
      [`border-${side}-color`, "rgb(0, 0, 0)"],
    ]),
  ),
  "border-image-source": "none",
  "box-shadow": "none",
  "text-shadow": "none",
  "background-image": "none",
  "background-size": "auto",
  "background-position": "0% 0%",
  "background-repeat": "repeat",
  "mix-blend-mode": "normal",
  "overflow-x": "visible",
  "overflow-y": "visible",
  filter: "none",
  "backdrop-filter": "none",
  transform: "none",
  rotate: "none",
  scale: "none",
  translate: "none",
  "z-index": "auto",
  "outline-style": "none",
  "clip-path": "none",
  "mask-image": "none",
  appearance: "auto",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "justify-content": "normal",
  "align-items": "normal",
  "align-content": "normal",
  "column-gap": "normal",
  "row-gap": "normal",
  order: "0",
  "flex-grow": "0",
  "flex-shrink": "1",
  "flex-basis": "auto",
  "align-self": "auto",
  "grid-template-columns": "none",
  "grid-template-rows": "none",
  "grid-column-start": "auto",
  "grid-column-end": "auto",
  "grid-row-start": "auto",
  "grid-row-end": "auto",
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
  "box-sizing": "content-box",
  width: "auto",
  height: "auto",
};

let nextId = 0;
export function el(
  parent: number | null,
  tag: string,
  rect: RawElement["rect"],
  style: Partial<Record<StyleProp, string>> = {},
): RawElement {
  return { kind: "element", id: nextId++, parent, tag, rect, style: { ...defaults, ...style }, attrs: {} };
}
export function txt(parent: number, text: string, lines: RawText["lines"]): RawText {
  return { kind: "text", id: nextId++, parent, text, lines };
}

export function page(
  extra: (body: RawElement) => (RawElement | RawText)[],
  htmlBg = "rgba(0, 0, 0, 0)",
  height = 900,
): RawSnapshot {
  nextId = 0;
  const html = el(null, "html", { x: 0, y: 0, width: 1440, height }, { "background-color": htmlBg });
  const body = el(
    html.id,
    "body",
    { x: 0, y: 0, width: 1440, height },
    { "background-color": "rgb(250, 250, 250)" },
  );
  return {
    url: "http://localhost:4400/x",
    title: "X",
    viewport: { width: 1440, height: 900, dpr: 1 },
    documentSize: { width: 1440, height },
    nodes: [html, body, ...extra(body)],
    truncated: false,
  };
}
