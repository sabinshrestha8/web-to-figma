import type { TextStyle } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { blendMode, effects, rotatedTransform, strokeProps } from "./box.ts";
import { indexFonts, parseStyleName, resolveFont } from "./fonts.ts";
import { relative } from "./geometry.ts";
import { linearTransform, paints, radialTransform } from "./paint.ts";
import { runProps } from "./text.ts";

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
