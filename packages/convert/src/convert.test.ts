import { type BoxNode, parseDocument, type TextNode } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import {
  groupLines,
  parseColor,
  parseFontFamilies,
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
    expect(rasterPlan(snap, 16_000)).toEqual([
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
    const plan = rasterPlan(snap, 16_000);
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
    const plan = rasterPlan(snap, 16_000);
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
