import type { TextNode, TextStyle } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { blendMode, effects, rotatedTransform, strokeProps } from "./box.ts";
import { indexFonts, parseStyleName, planFonts, resolveFont } from "./fonts.ts";
import { relative } from "./geometry.ts";
import { childLayout, gridProps, sizingProp, stackProps } from "./layout.ts";
import { linearTransform, paints, radialTransform } from "./paint.ts";
import { reflowed, runProps } from "./text.ts";

const available = indexFonts(
  [
    ["Inter", "Regular"],
    ["Inter", "Semi Bold"],
    ["Inter", "Bold"],
    ["Inter", "Italic"],
    ["Inter", "Bold Italic"],
    ["Roboto Mono", "Regular"],
    ["Noto Serif", "Regular"],
    ["Playfair Display", "Black"],
    ["Weird", "Condensed Wide"], // unparseable style names are ignored
  ].map(([family, style]) => ({ fontName: { family: family!, style: style! } })),
);
const font = (families: string[], weight = 400, italic = false) =>
  resolveFont({ families, weight, italic }, available);

describe("fonts", () => {
  it.each([
    ["Regular", 400, false],
    ["Semi Bold", 600, false],
    ["SemiBold", 600, false],
    ["Extra Light Italic", 200, true],
    ["Italic", 400, true],
    ["Black", 900, false],
    ["Condensed Wide", null, null],
  ])("parses style %s", (style, weight, italic) => {
    const parsed = parseStyleName(style);
    expect(parsed && [parsed.weight, parsed.italic]).toEqual(weight === null ? null : [weight, italic]);
  });

  it("uses the first available family at the exact weight without a substitution", () => {
    expect(font(["Inter", "sans-serif"], 600)).toEqual({ font: { family: "Inter", style: "Semi Bold" } });
    expect(font(["Inter"], 700, true)).toEqual({ font: { family: "Inter", style: "Bold Italic" } });
  });

  it("falls through the stack and reports the substitution", () => {
    expect(font(["Geist", "Roboto Mono"])).toEqual({
      font: { family: "Roboto Mono", style: "Regular" },
      substitutedFrom: "Geist 400",
    });
  });

  it("maps generic families to shipped fonts, reported as a substitution", () => {
    expect(font(["monospace"]).font).toEqual({ family: "Roboto Mono", style: "Regular" });
    expect(font(["serif"]).font.family).toBe("Noto Serif");
    expect(font(["system-ui"]).substitutedFrom).toBe("system-ui 400");
  });

  it("picks the nearest weight and reports it", () => {
    expect(font(["Inter"], 800)).toEqual({
      font: { family: "Inter", style: "Bold" },
      substitutedFrom: "Inter 800",
    });
  });

  it("prefers matching italic over matching weight", () => {
    expect(font(["Inter"], 600, true).font.style).toBe("Bold Italic");
  });

  it("falls back to Inter when nothing in the stack exists", () => {
    expect(font(["Nope"], 700)).toEqual({
      font: { family: "Inter", style: "Bold" },
      substitutedFrom: "Nope 700",
    });
  });
});

const env = { width: 200, height: 100, imageHash: () => "hash", imageWidth: () => 32 };
const bw = [
  { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
  { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
];
/** Gradient-space x (0 = first stop, 1 = last) of a layer point (fractions of the box). */
const at = (m: Transform, x: number, y: number) => m[0][0] * x + m[0][1] * y + m[0][2];

describe("paint", () => {
  it("maps solid colors with alpha as paint opacity", () => {
    const out = paints([{ type: "solid", color: { r: 1, g: 0.5, b: 0, a: 0.25 } }], env);
    expect(out.paints).toEqual([{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.25 }]);
  });

  it("uses identity for a left→right gradient and the known top→bottom transform", () => {
    expect(linearTransform(90, 200, 100)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(linearTransform(180, 200, 100)).toEqual([
      [0, 1, 0],
      [-1, 0, 1],
    ]);
  });

  it.each([
    [45, [0, 1], [1, 0]], // CSS 45deg on any box: bottom-left corner is 0%, top-right is 100%
    [135, [0, 0], [1, 1]],
    [270, [1, 0.5], [0, 0.5]],
  ])("puts the %d° gradient's 0%% and 100%% on the corners CSS does", (angle, start, end) => {
    const m = linearTransform(angle, 200, 100);
    expect(at(m, start[0]!, start[1]!)).toBeCloseTo(0, 5);
    expect(at(m, end[0]!, end[1]!)).toBeCloseTo(1, 5);
    expect(at(m, 0.5, 0.5)).toBeCloseTo(0.5, 5);
  });

  it("maps a radial gradient's center to 0.5 and its radius to 0.5 in gradient space", () => {
    const m = radialTransform({ x: 0.3, y: 0.3 }, { x: 0.8, y: 1.4 });
    expect(m[0][0] * 0.3 + m[0][2]).toBeCloseTo(0.5, 5);
    expect(m[1][1] * 0.3 + m[1][2]).toBeCloseTo(0.5, 5);
    expect(m[0][0] * (0.3 + 0.8) + m[0][2]).toBeCloseTo(1, 5);
    expect(m[1][1] * (0.3 + 1.4) + m[1][2]).toBeCloseTo(1, 5);
  });

  it("builds gradient paints and scales tiles by their CSS size over the image pixels", () => {
    const asset = "a".repeat(64);
    const out = paints(
      [
        { type: "linear", angle: 90, stops: bw },
        { type: "radial", center: { x: 0.5, y: 0.5 }, radius: { x: 0, y: 1 }, stops: bw },
        {
          type: "image",
          assetId: asset,
          scale: "tile",
          position: { x: 0, y: 0 },
          tileSize: { width: 16, height: 16 },
        },
      ],
      env,
    );
    expect(out.paints.map((p) => p.type)).toEqual(["GRADIENT_LINEAR", "IMAGE"]);
    expect(out.paints[1]).toMatchObject({ scaleMode: "TILE", scalingFactor: 0.5 }); // 32 px image, 16 px tile
    expect(out.skipped).toEqual(["zero-size radial gradient"]);
  });

  it("maps image scales; crops and stretches go through CROP with an imageTransform", () => {
    const image = { type: "image" as const, assetId: "a".repeat(64), position: { x: 0.5, y: 0.5 } };
    const out = paints(
      [
        { ...image, scale: "cover" },
        { ...image, scale: "contain" },
        { ...image, scale: "stretch" },
        { ...image, scale: "cover", crop: { x: 0.1, y: 0.25, width: 0.8, height: 0.5 } },
      ],
      env,
    ).paints;
    expect(out).toEqual([
      { type: "IMAGE", imageHash: "hash", scaleMode: "FILL" },
      { type: "IMAGE", imageHash: "hash", scaleMode: "FIT" },
      {
        type: "IMAGE",
        imageHash: "hash",
        scaleMode: "CROP",
        imageTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
      {
        type: "IMAGE",
        imageHash: "hash",
        scaleMode: "CROP",
        imageTransform: [
          [0.8, 0, 0.1],
          [0, 0.5, 0.25],
        ],
      },
    ]);
  });
});

describe("box", () => {
  it("maps shadows, inset shadows and blurs in order", () => {
    const color = { r: 0, g: 0, b: 0, a: 0.5 };
    expect(
      effects([
        { type: "shadow", inset: false, offset: { x: 0, y: 4 }, blur: 6, spread: -1, color },
        { type: "shadow", inset: true, offset: { x: 0, y: 0 }, blur: 0, spread: 2, color },
        { type: "layer-blur", radius: 8 },
        { type: "background-blur", radius: 24 },
      ]),
    ).toEqual([
      {
        type: "DROP_SHADOW",
        color,
        offset: { x: 0, y: 4 },
        radius: 6,
        spread: -1,
        visible: true,
        blendMode: "NORMAL",
        showShadowBehindNode: false,
      },
      {
        type: "INNER_SHADOW",
        color,
        offset: { x: 0, y: 0 },
        radius: 0,
        spread: 2,
        visible: true,
        blendMode: "NORMAL",
      },
      { type: "LAYER_BLUR", blurType: "NORMAL", radius: 8, visible: true },
      { type: "BACKGROUND_BLUR", blurType: "NORMAL", radius: 24, visible: true },
    ]);
  });

  it("maps strokes inside, with per-side weights and dashes", () => {
    const color = { r: 1, g: 0, b: 0, a: 1 };
    const uniform = strokeProps({
      color,
      weights: { top: 2, right: 2, bottom: 2, left: 2 },
      style: "dashed",
    });
    expect(uniform).toMatchObject({ strokeAlign: "INSIDE", uniform: 2, dashPattern: [6, 6] });
    const sides = strokeProps({ color, weights: { top: 0, right: 0, bottom: 4, left: 1 }, style: "solid" });
    expect(sides).toMatchObject({
      uniform: null,
      dashPattern: [],
      weights: { strokeBottomWeight: 4, strokeLeftWeight: 1 },
    });
  });

  it("maps blend modes to Figma names", () => {
    expect(blendMode("color-dodge")).toBe("COLOR_DODGE");
    expect(blendMode("multiply")).toBe("MULTIPLY");
  });

  it("rotates clockwise around the box center", () => {
    const m = rotatedTransform(90, { x: 0, y: 0, width: 100, height: 50 });
    const apply = (x: number, y: number) => [
      m[0][0] * x + m[0][1] * y + m[0][2],
      m[1][0] * x + m[1][1] * y + m[1][2],
    ];
    expect(apply(50, 25).map((v) => Math.round(v))).toEqual([50, 25]); // center stays put
    expect(apply(100, 0).map((v) => Math.round(v))).toEqual([75, 75]); // top-right swings down (clockwise)
  });
});

describe("text", () => {
  const style: TextStyle = {
    families: ["Inter"],
    weight: 400,
    italic: false,
    size: 16,
    lineHeight: 24,
    letterSpacing: -0.4,
    transform: "uppercase",
    decoration: "line-through",
    color: { r: 0, g: 0, b: 0, a: 1 },
  };
  it("maps run properties to Figma units", () => {
    expect(runProps(style)).toEqual({
      fontSize: 16,
      lineHeight: { unit: "PIXELS", value: 24 },
      letterSpacing: { unit: "PIXELS", value: -0.4 },
      textCase: "UPPER",
      textDecoration: "STRIKETHROUGH",
    });
    expect(runProps({ ...style, lineHeight: "auto" }).lineHeight).toEqual({ unit: "AUTO" });
  });

  it("flags TEXT_REFLOW only when the height is off by more than half a line", () => {
    const t = {
      bounds: { x: 0, y: 0, width: 300, height: 48 },
      runs: [{ start: 0, end: 1, style }],
    } as TextNode;
    expect(reflowed(t, 48)).toBe(false);
    expect(reflowed(t, 59)).toBe(false); // metric drift within a line
    expect(reflowed(t, 72)).toBe(true); // wrapped onto a third line
    expect(reflowed(t, 24)).toBe(true);
  });
});

describe("font plan", () => {
  it("resolves each style once and lists substitutions first with their run counts", () => {
    const inter = { families: ["Inter"], weight: 400, italic: false };
    const geist = { families: ["Geist", "sans-serif"], weight: 700, italic: false };
    const { fonts, report } = planFonts([inter, geist, inter, inter], available);
    expect(fonts.size).toBe(2);
    expect(report).toEqual([
      { requested: "Geist 700", font: "Inter Bold", substituted: true, runs: 1 },
      { requested: "Inter 400", font: "Inter Regular", substituted: false, runs: 3 },
    ]);
  });
});

describe("geometry", () => {
  it("converts page coordinates to parent-relative and clamps zero sizes", () => {
    expect(
      relative({ x: 120, y: 340, width: 0, height: 20 }, { x: 100, y: 300, width: 500, height: 500 }),
    ).toEqual({
      x: 20,
      y: 40,
      width: 0.01,
      height: 20,
    });
  });
});

describe("layout", () => {
  it("maps stacks to Auto Layout props with stroke-aware layout inclusion", () => {
    expect(
      stackProps(
        {
          mode: "stack",
          direction: "horizontal",
          reverse: true,
          wrap: true,
          gap: 32,
          crossGap: 10,
          padding: { top: 5, right: 40, bottom: 5, left: 40 },
          justify: "space-between",
          align: "center",
        },
        true,
      ),
    ).toEqual({
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      itemSpacing: 32,
      counterAxisSpacing: 10,
      paddingTop: 5,
      paddingRight: 40,
      paddingBottom: 5,
      paddingLeft: 40,
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      itemReverseZIndex: true,
      strokesIncludedInLayout: true,
    });
    expect(
      stackProps(
        {
          mode: "stack",
          direction: "vertical",
          reverse: false,
          wrap: false,
          gap: 0,
          crossGap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          justify: "start",
          align: "start",
        },
        false,
      ),
    ).toMatchObject({ layoutMode: "VERTICAL", primaryAxisAlignItems: "MIN", strokesIncludedInLayout: false });
  });

  it("maps grids to fixed tracks and sizing to Figma names", () => {
    expect(
      gridProps({
        mode: "grid",
        columns: [{ size: 200 }, { size: 200 }],
        rows: [{ size: 100 }],
        columnGap: 20,
        rowGap: 30,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toMatchObject({ columnCount: 2, rowCount: 1, columnSizes: [200, 200], columnGap: 20 });
    expect([sizingProp("fixed"), sizingProp("hug"), sizingProp("fill")]).toEqual(["FIXED", "HUG", "FILL"]);
  });

  it("applies child layout props only under stacks and grids, never under none", () => {
    const flow = { sizing: { horizontal: "fill", vertical: "fixed" } as const, position: "flow" };
    const absolute = { sizing: { horizontal: "fixed", vertical: "fixed" } as const, position: "absolute" };
    expect(childLayout(flow, "stack")).toEqual({
      horizontal: "FILL",
      vertical: "FIXED",
      absolute: false,
      fixWidth: false,
      fixHeight: true,
    });
    expect(childLayout(absolute, "stack")).toMatchObject({ absolute: true });
    expect(childLayout(flow, "grid")).toMatchObject({ horizontal: "FILL", absolute: false });
    // Figma rejects layout props under a none frame: those children are already absolute.
    expect(childLayout(flow, "none")).toBeNull();
    expect(childLayout(absolute, "none")).toBeNull();
  });

  it("never pins text to the browser's width, so Figma's wider glyphs can't clip the last letter", () => {
    const fixed = { horizontal: "fixed", vertical: "fixed" } as const;
    const line = { sizing: fixed, position: "flow", autoResize: "width-and-height" } as const;
    const para = { sizing: fixed, position: "flow", autoResize: "height" } as const;
    expect(childLayout(line, "stack")).toMatchObject({ horizontal: "HUG", vertical: "HUG", fixWidth: false });
    expect(childLayout(para, "stack")).toMatchObject({
      horizontal: "FIXED",
      vertical: "HUG",
      fixWidth: true,
      fixHeight: false,
    });
    const filled = { ...line, sizing: { horizontal: "fill", vertical: "fixed" } } as const;
    expect(childLayout(filled, "stack")).toMatchObject({ horizontal: "FILL", vertical: "HUG" });
  });
});
