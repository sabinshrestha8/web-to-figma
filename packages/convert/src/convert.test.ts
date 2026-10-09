import { type BoxNode, parseDocument, type TextNode } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import {
  backgroundRect,
  backgroundUrls,
  groupLines,
  imagePlan,
  nextFontFamily,
  objectFitRect,
  parseColor,
  parseFontFamilies,
  placementPaint,
  px,
  rasterPlan,
  scalePx,
  snapshotToIR,
  textAlign,
  toDocument,
} from "./index.ts";
import { type RawElement, type RawSnapshot, type RawText, STYLE_PROPS, type StyleProp } from "./snapshot.ts";

describe("css parsers", () => {
  it.each([
    ["rgb(255, 0, 0)", { r: 1, g: 0, b: 0, a: 1 }],
    ["rgba(0, 0, 0, 0.5)", { r: 0, g: 0, b: 0, a: 0.5 }],
    ["rgb(15 23 43 / 50%)", { r: 0.0588, g: 0.0902, b: 0.1686, a: 0.5 }],
    ["rgba(0, 0, 0, 0)", null],
    ["transparent", null],
    ["oklch(0.2 0.04 265)", null], // collector must normalize these first
    ["rgb(1, 2)", null],
  ])("parseColor(%s)", (input, expected) => {
    expect(parseColor(input)).toEqual(expected);
  });

  it.each([
    ['"Inter Var", Inter, system-ui, sans-serif', ["Inter Var", "Inter", "system-ui", "sans-serif"]],
    ["'Segoe UI', Roboto", ["Segoe UI", "Roboto"]],
    ["Georgia", ["Georgia"]],
    ["", ["sans-serif"]],
  ])("parseFontFamilies(%s)", (input, expected) => {
    expect(parseFontFamilies(input)).toEqual(expected);
  });

  it.each([
    ["16px", 16],
    ["-0.5px", -0.5],
    ["3.40282e+38px", 3.40282e38],
    ["normal", null],
    ["1.5em", null],
  ])("px(%s)", (input, expected) => {
    expect(px(input)).toBe(expected);
  });

  it.each([
    ["start", "left"],
    ["end", "right"],
    ["center", "center"],
    ["justify", "justify"],
    ["-webkit-left", "left"],
  ])("textAlign(%s)", (input, expected) => {
    expect(textAlign(input)).toBe(expected);
  });

  it("groupLines merges fragments on the same line and keeps separate lines apart", () => {
    const lines = groupLines([
      { x: 100, y: 0, width: 50, height: 20 },
      { x: 0, y: 1, width: 90, height: 19 },
      { x: 0, y: 24, width: 70, height: 20 },
    ]);
    expect(lines).toEqual([
      { x: 0, y: 0, width: 150, height: 20 },
      { x: 0, y: 24, width: 70, height: 20 },
    ]);
  });
});

// --- snapshotToIR -----------------------------------------------------------------------------

const defaults: Record<StyleProp, string> = {
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
function el(
  parent: number | null,
  tag: string,
  rect: RawElement["rect"],
  style: Partial<Record<StyleProp, string>> = {},
): RawElement {
  return { kind: "element", id: nextId++, parent, tag, rect, style: { ...defaults, ...style }, attrs: {} };
}
function txt(parent: number, text: string, lines: RawText["lines"]): RawText {
  return { kind: "text", id: nextId++, parent, text, lines };
}

function page(
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

const convert = (snap: RawSnapshot, maxHeight = 16_000) => snapshotToIR(snap, { captureId: "c1", maxHeight });
const all = (n: BoxNode): (BoxNode | TextNode)[] =>
  n.children.flatMap((c) => (c.type === "box" ? [c, ...all(c)] : c.type === "text" ? [c] : []));

describe("snapshotToIR", () => {
  it("produces a document that passes IR validation", () => {
    const snap = page((body) => {
      const card = el(
        body.id,
        "div",
        { x: 10, y: 10, width: 200, height: 100 },
        { "background-color": "rgb(255, 0, 0)" },
      );
      return [card, txt(card.id, "Hello", [{ x: 20, y: 20, width: 40, height: 18 }])];
    });
    const { capture } = convert(snap);
    expect(parseDocument(JSON.parse(JSON.stringify(toDocument([capture], {}, [])))).ok).toBe(true);
  });

  it("propagates body background to the canvas and does not paint it twice", () => {
    const { capture } = convert(page(() => []));
    expect(capture.root.fills).toEqual([{ type: "solid", color: { r: 0.9804, g: 0.9804, b: 0.9804, a: 1 } }]);
    expect(capture.root.children).toEqual([]); // body had nothing else to paint
  });

  it("prefers the html background for the canvas", () => {
    const { capture } = convert(page(() => [], "rgb(0, 0, 255)"));
    expect(capture.root.fills[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 } });
    expect(all(capture.root).find((n) => n.name === "body")?.type).toBe("box"); // body keeps its own fill
  });

  it("drops invisible and empty boxes but keeps their visible descendants", () => {
    const snap = page((body) => {
      const wrapper = el(body.id, "div", { x: 0, y: 0, width: 100, height: 100 }); // no paint
      const hidden = el(
        body.id,
        "div",
        { x: 0, y: 0, width: 50, height: 50 },
        { opacity: "0", "background-color": "rgb(1, 1, 1)" },
      );
      const red = el(
        wrapper.id,
        "span",
        { x: 5, y: 5, width: 10, height: 10 },
        { "background-color": "rgb(255, 0, 0)" },
      );
      const ghost = el(body.id, "p", { x: 0, y: 0, width: 50, height: 20 }, { visibility: "hidden" });
      return [wrapper, hidden, red, ghost, txt(ghost.id, "secret", [{ x: 0, y: 0, width: 40, height: 18 }])];
    });
    const names = all(convert(snap).capture.root).map((n) => n.name);
    expect(names).toEqual(["body", "div", "span"]);
  });

  it("expands single-line text to its line box and keeps natural width", () => {
    const snap = page((body) => {
      const p = el(
        body.id,
        "p",
        { x: 0, y: 100, width: 600, height: 24 },
        { "line-height": "24px", "font-weight": "700" },
      );
      return [p, txt(p.id, "Title", [{ x: 0, y: 103, width: 52, height: 18 }])];
    });
    const t = all(convert(snap).capture.root).find((n) => n.type === "text") as TextNode;
    expect(t.bounds).toEqual({ x: 0, y: 100, width: 52, height: 24 });
    expect(t).toMatchObject({ autoResize: "width-and-height", lineCount: 1 });
    expect(t.runs[0]?.style).toMatchObject({
      weight: 700,
      lineHeight: 24,
      families: ["Inter", "sans-serif"],
    });
  });

  it("gives multi-line text the parent's content width so it wraps the same way", () => {
    const snap = page((body) => {
      const p = el(
        body.id,
        "p",
        { x: 100, y: 0, width: 400, height: 48 },
        {
          "line-height": "24px",
          "padding-left": "20px",
          "padding-right": "20px",
          "text-align": "center",
        },
      );
      return [
        p,
        txt(p.id, "two lines", [
          { x: 150, y: 3, width: 300, height: 18 },
          { x: 200, y: 27, width: 200, height: 18 },
        ]),
      ];
    });
    const t = all(convert(snap).capture.root).find((n) => n.type === "text") as TextNode;
    expect(t.bounds).toEqual({ x: 120, y: 0, width: 360, height: 48 });
    expect(t).toMatchObject({ autoResize: "height", lineCount: 2, align: "center" });
  });

  it("clips tall pages and reports PAGE_HEIGHT_CLIPPED", () => {
    const snap = page(
      (body) => [
        el(body.id, "div", { x: 0, y: 100, width: 10, height: 10 }, { "background-color": "rgb(0, 0, 0)" }),
        el(body.id, "div", { x: 0, y: 5000, width: 10, height: 10 }, { "background-color": "rgb(0, 0, 0)" }),
      ],
      undefined,
      6000,
    );
    const { capture, diagnostics } = convert(snap, 4000);
    expect(capture.root.bounds.height).toBe(4000);
    expect(all(capture.root).filter((n) => n.name === "div")).toHaveLength(1);
    expect(diagnostics.map((d) => d.code)).toEqual(["PAGE_HEIGHT_CLIPPED"]);
  });

  it("warns when a page has nothing but html/body backgrounds", () => {
    const codes = (snap: RawSnapshot) => convert(snap).diagnostics.map((d) => d.code);
    expect(codes(page(() => [], "rgb(0, 0, 255)"))).toEqual(["EMPTY_CAPTURE"]); // body painted, still empty
    expect(codes(page((body) => [txt(body.id, "Hi", [{ x: 0, y: 0, width: 20, height: 18 }])]))).toEqual([]);
    expect(
      codes(
        page((body) => [
          el(body.id, "div", { x: 0, y: 0, width: 9, height: 9 }, { "background-color": "rgb(255, 0, 0)" }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("snapshotToIR box fidelity", () => {
  const bg = (c: string) => ({ "background-color": c });
  const box = (n: unknown) => n as BoxNode;

  it("orders children by CSS stacking: negative z, flow, positioned, positive z", () => {
    const snap = page((body) => [
      el(
        body.id,
        "a",
        { x: 0, y: 0, width: 9, height: 9 },
        { ...bg("rgb(1, 1, 1)"), position: "relative", "z-index": "2" },
      ),
      el(body.id, "b", { x: 0, y: 0, width: 9, height: 9 }, { ...bg("rgb(1, 1, 1)"), position: "absolute" }),
      el(body.id, "c", { x: 0, y: 0, width: 9, height: 9 }, bg("rgb(1, 1, 1)")),
      el(
        body.id,
        "d",
        { x: 0, y: 0, width: 9, height: 9 },
        { ...bg("rgb(1, 1, 1)"), position: "relative", "z-index": "-1" },
      ),
      el(
        body.id,
        "e",
        { x: 0, y: 0, width: 9, height: 9 },
        { ...bg("rgb(1, 1, 1)"), position: "relative", "z-index": "1" },
      ),
    ]);
    const bodyBox = box(convert(snap).capture.root.children[0]);
    expect(bodyBox.children.map((c) => c.name)).toEqual(["d", "c", "b", "e", "a"]);
  });

  it("flattens paint-less wrappers around a same-sized child, keeping the wrapper's positioning", () => {
    const snap = page((body) => {
      const wrap = el(body.id, "div", { x: 10, y: 10, width: 100, height: 50 }, { position: "absolute" });
      return [wrap, el(wrap.id, "section", { x: 10, y: 10, width: 100, height: 50 }, bg("rgb(255, 0, 0)"))];
    });
    const [only] = all(convert(snap).capture.root).filter((n) => n.name !== "body");
    expect(only).toMatchObject({ name: "section", position: "absolute" });
  });

  it("drops a flattened child's FILL: it filled the wrapper, not the new parent", () => {
    // MUI endIcon: <span display:flex> stretches the icon; the button centers the span.
    const snap = page((body) => {
      const btn = el(
        body.id,
        "button",
        { x: 0, y: 0, width: 40, height: 34 },
        { ...bg("rgb(1, 1, 1)"), display: "flex", "align-items": "center", "padding-left": "10px" },
      );
      const span = el(btn.id, "span", { x: 10, y: 11, width: 12, height: 12 }, { display: "flex" });
      return [btn, span, el(span.id, "i", { x: 10, y: 11, width: 12, height: 12 }, bg("rgb(2, 2, 2)"))];
    });
    const icon = all(convert(snap).capture.root).find((n) => n.name === "i");
    expect(icon?.sizing).toEqual({ horizontal: "fixed", vertical: "fixed" });
  });

  it("flattens a span around one text line whose line box overhangs it", () => {
    const snap = page((body) => {
      const row = el(
        body.id,
        "time",
        { x: 0, y: 0, width: 80, height: 19 },
        { display: "flex", "align-items": "baseline", "column-gap": "4px" },
      );
      const span = el(row.id, "span", { x: 0, y: 0, width: 50, height: 19 }, { "line-height": "20.4px" });
      const am = el(row.id, "small", { x: 54, y: 3, width: 26, height: 14 }, bg("rgb(1, 1, 1)"));
      return [row, span, txt(span.id, "03:09:05", [{ x: 0, y: 2, width: 50, height: 15 }]), am];
    });
    const row = box(all(convert(snap).capture.root).find((n) => n.name === "time"));
    expect(row.children.map((c) => c.type)).toEqual(["text", "box"]);
    expect(row.layout).toMatchObject({ mode: "stack", align: "baseline" });
    expect(row.children[0]?.sizing.horizontal).toBe("hug");
  });

  it("drops a clip around text that fits, so Figma's wider glyphs aren't cut", () => {
    const title = (width: number) => {
      const snap = page((body) => {
        const h2 = el(
          body.id,
          "h2",
          { x: 0, y: 1.5, width: 134, height: 22.5 },
          {
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "overflow-x": "hidden",
            "overflow-y": "hidden",
            "line-height": "24px",
          },
        );
        return [h2, txt(h2.id, "Latest Onboarding", [{ x: 0, y: 4, width, height: 18 }])];
      });
      return all(convert(snap).capture.root).filter((n) => n.name !== "body");
    };
    // fits: the clip goes, and the bare wrapper flattens into hugging text
    expect(title(133.86).map((n) => [n.type, n.sizing.horizontal])).toEqual([["text", "hug"]]);
    // overflows: CSS really cuts it, so the clip and the ellipsis stay
    const cut = title(160);
    expect(cut.map((n) => n.type)).toEqual(["box", "text"]);
    expect(cut[0]).toMatchObject({ clip: true });
    expect(cut[1]).toMatchObject({ truncate: true });
  });

  it("maps border, radius, shadow, blend, clip and gradient layers onto the box", () => {
    const snap = page((body) => [
      el(
        body.id,
        "div",
        { x: 0, y: 0, width: 200, height: 100 },
        {
          ...bg("rgb(255, 255, 255)"),
          "background-image":
            "linear-gradient(to right, rgb(0, 0, 0), rgb(255, 0, 0)), linear-gradient(rgb(255, 0, 0), rgb(0, 0, 0))",
          ...Object.fromEntries(
            ["top", "right", "bottom", "left"].flatMap((s) => [
              [`border-${s}-width`, "1px"],
              [`border-${s}-style`, "solid"],
            ]),
          ),
          "border-top-left-radius": "12px",
          "box-shadow": "rgba(0, 0, 0, 0.5) 0px 2px 4px 0px",
          "mix-blend-mode": "multiply",
          "overflow-x": "hidden",
          "overflow-y": "hidden",
        },
      ),
    ]);
    const { capture, diagnostics } = convert(snap);
    const div = box(all(capture.root).find((n) => n.name === "div"));
    expect(div.fills.map((f) => (f.type === "linear" ? f.angle : f.type))).toEqual(["solid", 180, 90]);
    expect(div).toMatchObject({
      stroke: { weights: { top: 1, right: 1, bottom: 1, left: 1 }, style: "solid" },
      radius: [12, 0, 0, 0],
      effects: [{ type: "shadow", blur: 4 }],
      blendMode: "multiply",
      clip: true,
    });
    expect(diagnostics).toEqual([]);
  });

  it("rotates leaf boxes around their center using the untransformed size", () => {
    const snap = page((body) => {
      const r = el(
        body.id,
        "div",
        { x: 79.29, y: 79.29, width: 141.42, height: 141.42 }, // 100×100 at (100,100), rotated 45°
        { ...bg("rgb(255, 0, 0)"), transform: "matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)" },
      );
      r.layoutSize = { width: 100, height: 100 };
      return [r];
    });
    const div = box(all(convert(snap).capture.root).find((n) => n.name === "div"));
    expect(div.bounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(div.rotation).toBeCloseTo(45);
  });

  it("draws descendants of a scale transform at their painted size", () => {
    const snap = page((body) => {
      const s = el(
        body.id,
        "div",
        { x: 0, y: 0, width: 720, height: 450 },
        { transform: "matrix(0.5, 0, 0, 0.5, -360, -225)" },
      );
      s.layoutSize = { width: 1440, height: 900 };
      const card = el(
        s.id,
        "div",
        { x: 10, y: 10, width: 100, height: 50 },
        {
          ...bg("rgb(255, 0, 0)"),
          "border-top-left-radius": "16px",
          "font-size": "20px",
          "background-image": "radial-gradient(rgb(0, 0, 0) 1px, rgba(0, 0, 0, 0) 1px)",
          "background-size": "20px 20px",
        },
      );
      return [s, card, txt(card.id, "Hi", [{ x: 10, y: 10, width: 10, height: 12 }])];
    });
    const nodes = all(convert(snap).capture.root);
    expect(box(nodes.find((n) => n.type === "box" && n.radius[0] > 0)).radius[0]).toBe(8);
    expect((nodes.find((n) => n.type === "text") as TextNode).runs[0]?.style.size).toBe(10);
    expect(rasterPlan(snap, 16_000, () => false)).toEqual([
      expect.objectContaining({ kind: "tile", width: 10, height: 10, css: expect.stringContaining("0.5px") }),
    ]);
    expect(scalePx('url("a-10px.png"), linear-gradient(red 4px, blue)', 0.5)).toBe(
      'url("a-10px.png"), linear-gradient(red 2px, blue)',
    );
  });

  it("turns replaced elements into raster islands, or grey placeholders when no pixels came back", () => {
    const snap = page((body) => [
      el(
        body.id,
        "canvas",
        { x: 0, y: 0, width: 300, height: 150 },
        { "box-shadow": "rgb(0, 0, 0) 0px 1px 2px 0px inset" },
      ),
      el(body.id, "img", { x: 0, y: 200, width: 64, height: 64 }),
    ]);
    const asset = "a".repeat(64);
    const plan = rasterPlan(snap, 16_000, () => false);
    expect(plan.map((r) => r.key)).toEqual(["el:2", "el:3"]);
    const { capture, diagnostics } = snapshotToIR(snap, {
      captureId: "c1",
      maxHeight: 16_000,
      rasters: { "el:2": asset },
    });
    const [canvas, img] = all(capture.root).filter((n) => n.name !== "body") as BoxNode[];
    expect(canvas).toMatchObject({
      fills: [{ type: "image", assetId: asset, scale: "stretch" }],
      effects: [],
    });
    expect(img?.fills[0]?.type).toBe("solid");
    expect(diagnostics.map((d) => [d.code, d.fallback])).toEqual([
      ["RASTERIZED", "rasterized"],
      ["IMAGE_FAILED", "placeholder"],
    ]);
  });

  it("draws tiled gradient patterns with the rendered tile, and reports one diagnostic per reason", () => {
    const snap = page((body) =>
      [0, 1, 2].map((i) =>
        el(
          body.id,
          "div",
          { x: 0, y: i * 100, width: 100, height: 100 },
          {
            "background-image": "radial-gradient(rgb(0, 0, 0) 1px, rgba(0, 0, 0, 0) 1px)",
            "background-size": "16px 16px",
            filter: "grayscale(1)",
          },
        ),
      ),
    );
    const plan = rasterPlan(snap, 16_000, () => false);
    expect(plan).toEqual(
      [2, 3, 4].map((id) => expect.objectContaining({ key: `tile:${id}:0`, kind: "tile", width: 16 })),
    );
    const asset = "b".repeat(64);
    const { capture, diagnostics } = snapshotToIR(snap, {
      captureId: "c1",
      maxHeight: 16_000,
      rasters: { "tile:2:0": asset },
    });
    const first = box(all(capture.root).find((n) => n.name === "div"));
    expect(first.fills).toEqual([
      {
        type: "image",
        assetId: asset,
        scale: "tile",
        position: { x: 0, y: 0 },
        tileSize: { width: 16, height: 16 },
      },
    ]);
    expect(diagnostics.map((d) => [d.message, d.detail?.count])).toEqual([
      ["filter grayscale()", 3],
      ["tiled gradient pattern (no tile was rendered)", 2],
    ]);
  });
});

describe("inline formatting contexts", () => {
  const line = (x: number, width: number, y = 3) => ({ x, y, width, height: 18 });
  const texts = (snap: RawSnapshot) =>
    all(convert(snap).capture.root).filter((n): n is TextNode => n.type === "text");
  const span = (t: TextNode, i: number) => t.characters.slice(t.runs[i]?.start, t.runs[i]?.end);

  it("draws a paragraph with strong, em and a link as one text node with style runs", () => {
    const snap = page((body) => {
      const p = el(body.id, "p", { x: 0, y: 0, width: 300, height: 48 }, { "line-height": "24px" });
      const strong = el(
        p.id,
        "strong",
        { x: 40, y: 3, width: 30, height: 18 },
        { display: "inline", "font-weight": "700" },
      );
      const em = el(
        p.id,
        "em",
        { x: 0, y: 27, width: 40, height: 18 },
        { display: "inline", "font-style": "italic" },
      );
      const a = el(
        p.id,
        "a",
        { x: 44, y: 27, width: 30, height: 18 },
        { display: "inline", color: "rgb(0, 0, 255)", "text-decoration-line": "underline" },
      );
      const b = el(
        a.id,
        "b",
        { x: 44, y: 27, width: 10, height: 18 },
        { display: "inline", "font-weight": "700" },
      );
      return [
        p,
        txt(p.id, "Hello ", [line(0, 40)]),
        strong,
        txt(strong.id, "bold", [line(40, 30)]),
        txt(p.id, " and ", [line(70, 35)]),
        em,
        txt(em.id, "italic", [line(0, 40, 27)]),
        txt(p.id, " ", []), // the space where the line wrapped: no rect, still a word separator
        a,
        txt(a.id, "my ", [line(44, 20, 27)]),
        b,
        txt(b.id, "link", [line(64, 10, 27)]),
        txt(p.id, ". ", [line(74, 4, 27)]),
      ];
    });
    const [t, ...rest] = texts(snap);
    expect(rest).toEqual([]);
    if (!t) throw new Error("no text node");
    expect(t.characters).toBe("Hello bold and italic my link.");
    expect(t.runs.map((_, i) => span(t, i))).toEqual([
      "Hello ",
      "bold",
      " and ",
      "italic",
      " ",
      "my ",
      "link",
      ".",
    ]);
    expect(t.runs[1]?.style.weight).toBe(700);
    expect(t.runs[3]?.style.italic).toBe(true);
    expect(t.runs[5]?.style).toMatchObject({ decoration: "underline", color: { r: 0, g: 0, b: 1, a: 1 } });
    expect(t.runs[6]?.style).toMatchObject({ decoration: "underline", weight: 700 }); // propagated from <a>
    expect(t.runs[7]?.style.decoration).toBe("none");
    expect(t).toMatchObject({
      lineCount: 2,
      autoResize: "height",
      bounds: { x: 0, y: 0, width: 300, height: 48 },
    });
  });

  it("keeps inline elements with their own box as boxes between text nodes", () => {
    const snap = page((body) => {
      const p = el(body.id, "p", { x: 0, y: 0, width: 600, height: 24 });
      const code = el(
        p.id,
        "code",
        { x: 50, y: 2, width: 40, height: 20 },
        { display: "inline", "background-color": "rgb(240, 240, 240)" },
      );
      return [
        p,
        txt(p.id, "Run ", [line(0, 50)]),
        code,
        txt(code.id, "pnpm", [line(52, 36)]),
        txt(p.id, " now", [line(90, 30)]),
      ];
    });
    const root = convert(snap).capture.root;
    // The space after an inline box is drawn (and inside the rect " now" starts at): keep it.
    expect(texts(snap).map((t) => t.characters)).toEqual(["Run", "pnpm", " now"]);
    expect(all(root).find((n) => n.name === "code")?.type).toBe("box");
  });

  it("drops the leading space of text that starts a line after a block", () => {
    const snap = page((body) => {
      const div = el(body.id, "div", { x: 0, y: 0, width: 600, height: 48 });
      const block = el(
        div.id,
        "div",
        { x: 0, y: 0, width: 600, height: 24 },
        { "background-color": "rgb(240, 240, 240)" },
      );
      return [div, block, txt(block.id, "Above", [line(0, 40)]), txt(div.id, " below ", [line(0, 40, 27)])];
    });
    expect(texts(snap).map((t) => t.characters)).toEqual(["Above", "below"]);
  });

  it("collapses white space across elements and turns <br> into a line break", () => {
    const snap = page((body) => {
      const p = el(body.id, "p", { x: 0, y: 0, width: 600, height: 48 });
      const s = el(p.id, "span", { x: 30, y: 3, width: 20, height: 18 }, { display: "inline" });
      const br = el(p.id, "br", { x: 60, y: 3, width: 0, height: 18 }, { display: "inline" });
      return [
        p,
        txt(p.id, " one ", [line(0, 30)]),
        s,
        txt(s.id, " two ", [line(30, 30)]),
        br,
        txt(p.id, " three ", [line(0, 40, 27)]),
      ];
    });
    const [t] = texts(snap);
    expect(t?.characters).toBe("one two\nthree");
    expect(t?.runs).toHaveLength(1); // same style throughout: one run
  });

  it("maps text-shadow to shadow effects on the text node", () => {
    const snap = page((body) => {
      const h = el(
        body.id,
        "h1",
        { x: 0, y: 0, width: 600, height: 40 },
        { "text-shadow": "rgba(0, 0, 0, 0.5) 1px 2px 3px" },
      );
      return [h, txt(h.id, "Shadow", [line(0, 90)])];
    });
    const { capture, diagnostics } = convert(snap);
    const t = all(capture.root).find((n) => n.type === "text");
    expect(t?.effects).toEqual([
      {
        type: "shadow",
        inset: false,
        offset: { x: 1, y: 2 },
        blur: 3,
        spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
      },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("truncates an overflowing ellipsis line at the content box, keeping the characters", () => {
    const text = (width: number) => {
      const snap = page((body) => {
        const p = el(
          body.id,
          "p",
          { x: 0, y: 0, width: 200, height: 24 },
          {
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "overflow-x": "hidden",
            "overflow-y": "hidden",
          },
        );
        return [p, txt(p.id, "A very long truncated line", [line(0, width)])];
      });
      const { capture, diagnostics } = convert(snap);
      expect(diagnostics).toEqual([]);
      return all(capture.root).find((n) => n.type === "text");
    };
    expect(text(260)).toMatchObject({
      characters: "A very long truncated line",
      truncate: true,
      autoResize: "height",
      sizing: { horizontal: "fixed" },
      bounds: { width: 200 },
    });
    expect(text(190)).not.toHaveProperty("truncate"); // fits: nothing cut
  });

  it.each([
    ["__inter_53f2d8", "Inter"],
    ["__notoSansDevanagari_e075aa", "Noto Sans Devanagari"],
    ["__Roboto_Mono_a1b2c3", "Roboto Mono"],
    ["__inter_Fallback_53f2d8", null],
    ["Inter", "Inter"],
    ["__custom", "__custom"],
  ])("nextFontFamily(%s)", (input, expected) => {
    expect(nextFontFamily(input)).toBe(expected);
  });

  it("drops next/font fallback families from the stack", () => {
    expect(parseFontFamilies("__inter_53f2d8, __inter_Fallback_53f2d8, sans-serif")).toEqual([
      "Inter",
      "sans-serif",
    ]);
  });
});

// --- images and vectors (Phase 5) ---------------------------------------------------------------

describe("image placement", () => {
  const box = { x: 0, y: 0, width: 240, height: 160 };
  const portrait = { width: 300, height: 450 };

  it.each([
    ["fill", "50% 50%", { x: 0, y: 0, width: 240, height: 160 }],
    ["contain", "50% 50%", { x: 66.67, y: 0, width: 106.67, height: 160 }],
    ["cover", "50% 50%", { x: 0, y: -100, width: 240, height: 360 }],
    ["cover", "50% 0%", { x: 0, y: 0, width: 240, height: 360 }],
    ["none", "50% 50%", { x: -30, y: -145, width: 300, height: 450 }],
    ["scale-down", "50% 50%", { x: 66.67, y: 0, width: 106.67, height: 160 }],
    ["cover", "10px 20px", { x: 10, y: 20, width: 240, height: 360 }],
  ])("object-fit %s at %s", (fit, position, expected) => {
    const r = objectFitRect(fit, position, box, portrait);
    expect(r).not.toBeNull();
    for (const k of ["x", "y", "width", "height"] as const) expect(r?.[k]).toBeCloseTo(expected[k], 1);
  });

  it("maps drawn rects to paints: stretch, centered cover, crop, contain", () => {
    const paint = (r: { x: number; y: number; width: number; height: number }) =>
      placementPaint("a", r, 240, 160);
    expect(paint({ x: 0, y: 0, width: 240, height: 160 }).paint.scale).toBe("stretch");
    expect(paint({ x: 0, y: -100, width: 240, height: 360 })).toEqual({
      paint: { type: "image", assetId: "a", scale: "cover", position: { x: 0.5, y: 0.5 } },
    });
    expect(paint({ x: 0, y: 0, width: 240, height: 360 }).paint.crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.4444,
    });
    expect(paint({ x: -30, y: -145, width: 300, height: 450 }).paint.crop).toEqual({
      x: 0.1,
      y: 0.3222,
      width: 0.8,
      height: 0.3556,
    });
    expect(paint({ x: 66.67, y: 0, width: 106.67, height: 160 })).toEqual({
      paint: { type: "image", assetId: "a", scale: "contain", position: { x: 0.5, y: 0.5 } },
    });
    expect(paint({ x: 0, y: 0, width: 106.67, height: 160 }).approximated).toMatch(/off-center/);
    expect(paint({ x: 100, y: 60, width: 40, height: 40 }).approximated).toMatch(/empty/);
  });

  it.each([
    ["cover", { width: 240, height: 360 }],
    ["contain", { width: 106.67, height: 160 }],
    ["auto", { width: 300, height: 450 }],
    ["24px 24px", { width: 24, height: 24 }],
    ["auto 80px", { width: 53.33, height: 80 }],
    ["50% auto", { width: 120, height: 180 }],
  ])("background-size %s", (size, expected) => {
    const r = backgroundRect(size, "0% 0%", box, portrait);
    expect(r?.width).toBeCloseTo(expected.width, 1);
    expect(r?.height).toBeCloseTo(expected.height, 1);
  });

  it("reads url() layers out of a computed background-image", () => {
    expect(backgroundUrls('linear-gradient(red, blue), url("http://a/b.png"), url(c.jpg)')).toEqual([
      null,
      "http://a/b.png",
      "c.jpg",
    ]);
    expect(backgroundUrls("none")).toEqual([]);
  });
});

describe("snapshotToIR: images and vectors", () => {
  const asset = (id: string, width: number, height: number) => ({ assetId: id.repeat(64), width, height });

  it("draws decoded images as fills, failed ones as placeholders, and plans what to decode", () => {
    const snap = page((body) => {
      const ok = el(
        body.id,
        "img",
        { x: 0, y: 0, width: 240, height: 160 },
        { "object-fit": "cover", "object-position": "50% 0%", "background-color": "rgb(226, 232, 240)" },
      );
      ok.image = { src: "http://x/p.jpg", width: 300, height: 450, state: "loaded" };
      const broken = el(body.id, "img", { x: 0, y: 200, width: 100, height: 100 });
      broken.image = { src: "http://x/missing.png", width: 0, height: 0, state: "failed" };
      const lazy = el(body.id, "img", { x: 0, y: 400, width: 100, height: 100 });
      lazy.image = { src: "http://x/lazy.png", width: 0, height: 0, state: "pending" };
      const tiled = el(
        body.id,
        "div",
        { x: 300, y: 0, width: 100, height: 100 },
        { "background-image": 'url("http://x/dot.png")', "background-size": "24px 24px" },
      );
      const gone = el(
        body.id,
        "div",
        { x: 300, y: 200, width: 100, height: 100 },
        { "background-image": 'url("http://x/gone.png")', "background-color": "rgb(0, 0, 0)" },
      );
      return [ok, broken, lazy, tiled, gone];
    });
    expect(imagePlan(snap, 16_000).map((r) => r.key)).toEqual([
      "http://x/p.jpg",
      "http://x/dot.png",
      "http://x/gone.png",
    ]);
    const images = { "http://x/p.jpg": asset("a", 300, 450), "http://x/dot.png": asset("b", 48, 48) };
    const hasImage = (k: string) => k in images;
    expect(rasterPlan(snap, 16_000, hasImage).map((r) => r.key)).toEqual(["el:4"]); // only the lazy one
    const { capture, diagnostics } = snapshotToIR(snap, { captureId: "c1", maxHeight: 16_000, images });
    const [ok, broken, , tiled, gone] = all(capture.root).filter((n) => n.name !== "body") as BoxNode[];
    expect(ok?.fills).toEqual([
      { type: "solid", color: { r: 0.8863, g: 0.9098, b: 0.9412, a: 1 } },
      {
        type: "image",
        assetId: "a".repeat(64),
        scale: "cover",
        position: { x: 0.5, y: 0.5 },
        crop: { x: 0, y: 0, width: 1, height: 0.4444 },
      },
    ]);
    expect(broken?.fills).toEqual([{ type: "solid", color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } }]);
    expect(tiled?.fills).toEqual([
      {
        type: "image",
        assetId: "b".repeat(64),
        scale: "tile",
        position: { x: 0, y: 0 },
        tileSize: { width: 24, height: 24 },
      },
    ]);
    expect(gone?.fills.map((f) => f.type)).toEqual(["solid"]);
    expect(diagnostics.map((d) => [d.code, d.fallback])).toEqual([
      ["IMAGE_FAILED", "placeholder"],
      ["IMAGE_FAILED", "placeholder"], // the lazy one: no island pixels in this test
      ["IMAGE_FAILED", "skipped"],
      ["LAYOUT_ABSOLUTE_FALLBACK", "absolute"], // scattered images: no stack verifies
    ]);
  });

  it("turns svg markup into a vector node with its fallback, and oversized svgs into islands", () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v24z"/></svg>';
    const snap = page((body) => {
      const icon = el(body.id, "svg", { x: 10, y: 10, width: 24, height: 24 }, { opacity: "0.5" });
      icon.svg = markup;
      const huge = el(body.id, "svg", { x: 50, y: 10, width: 24, height: 24 });
      return [icon, huge];
    });
    expect(imagePlan(snap, 16_000)).toEqual([{ key: "svg:2", kind: "svg", markup, width: 24, height: 24 }]);
    expect(rasterPlan(snap, 16_000, () => false).map((r) => r.key)).toEqual(["el:3"]);
    const c = "c".repeat(64);
    const d = "d".repeat(64);
    const { capture } = snapshotToIR(snap, {
      captureId: "c1",
      maxHeight: 16_000,
      images: { "svg:2": asset("c", 24, 24) },
      rasters: { "el:3": d },
    });
    const body = capture.root.children[0];
    const [vector, island] = body?.type === "box" ? body.children : [];
    expect(vector).toMatchObject({
      type: "vector",
      svg: markup,
      fallback: c,
      opacity: 0.5,
      bounds: { x: 10, y: 10, width: 24, height: 24 },
    });
    expect(island).toMatchObject({ type: "box", fills: [{ type: "image", scale: "stretch" }] });
    const meta = { mime: "image/png" as const, width: 24, height: 24, byteLength: 10 };
    const doc = toDocument([capture], { [c]: meta, [d]: meta }, []);
    expect(parseDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });
});
