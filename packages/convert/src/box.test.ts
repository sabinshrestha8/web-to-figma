import { describe, expect, it } from "vitest";
import { parseBorder, parseBoxShadow, parseFilter, parseRadius, parseTransform } from "./box.ts";
import { backgroundLayers, parseLinear, parseRadial, parseStops } from "./paint.ts";

const black = { r: 0, g: 0, b: 0, a: 1 };
const red = { r: 1, g: 0, b: 0, a: 1 };

describe("gradients", () => {
  it("fixes up missing stop positions like CSS", () => {
    const parsed = parseStops(["rgb(0, 0, 0)", "rgb(255, 0, 0)", "rgb(0, 0, 0) 80%", "rgb(255, 0, 0)"], 100);
    expect(parsed?.stops.map((s) => s.position)).toEqual([0, 0.4, 0.8, 1]);
    expect(parsed?.clamped).toBe(false);
  });

  it("never lets a stop go backwards and clamps stops outside the box", () => {
    const parsed = parseStops(["rgb(0, 0, 0) 50%", "rgb(255, 0, 0) 20%", "rgb(0, 0, 0) 150%"], 100);
    expect(parsed?.stops.map((s) => s.position)).toEqual([0.5, 0.5, 1]);
    expect(parsed?.clamped).toBe(true);
  });

  it("splits a two-position stop and ignores color hints", () => {
    const parsed = parseStops(["rgb(0, 0, 0) 0px 10px", "30%", "rgb(255, 0, 0)"], 100);
    expect(parsed?.stops).toEqual([
      { position: 0, color: black },
      { position: 0.1, color: black },
      { position: 1, color: red },
    ]);
  });

  it.each([
    ["rgb(0, 0, 0), rgb(255, 0, 0)", 180],
    ["90deg, rgb(0, 0, 0), rgb(255, 0, 0)", 90],
    ["0.25turn, rgb(0, 0, 0), rgb(255, 0, 0)", 90],
    ["to right, rgb(0, 0, 0), rgb(255, 0, 0)", 90],
    ["to top, rgb(0, 0, 0), rgb(255, 0, 0)", 0],
    ["to bottom right in oklab, rgb(0, 0, 0), rgb(255, 0, 0)", 153.4349], // 200×100: perpendicular to the BL→TR diagonal
  ])("linear-gradient(%s) → angle %d", (args, angle) => {
    expect(parseLinear(args, 200, 100)?.paint).toMatchObject({ type: "linear", angle });
  });

  it("measures stop lengths along the gradient line", () => {
    // 45deg across 100×100: line length = 100·(sin45 + cos45) ≈ 141.42 px.
    const stops = parseLinear("45deg, rgb(0, 0, 0) 70.71px, rgb(255, 0, 0)", 100, 100)?.paint;
    expect(stops).toMatchObject({ stops: [{ position: 0.5 }, { position: 1 }] });
  });

  it.each([
    ["rgb(0, 0, 0), rgb(255, 0, 0)", { x: 0.5, y: 0.5 }, { x: 0.7071, y: 0.7071 }], // ellipse farthest-corner
    ["circle at 0% 0%, rgb(0, 0, 0), rgb(255, 0, 0)", { x: 0, y: 0 }, { x: 1.118, y: 2.2361 }], // farthest corner: hypot(200, 100)
    ["circle closest-side, rgb(0, 0, 0), rgb(255, 0, 0)", { x: 0.5, y: 0.5 }, { x: 0.25, y: 0.5 }],
    ["50px 25px at right top, rgb(0, 0, 0), rgb(255, 0, 0)", { x: 1, y: 0 }, { x: 0.25, y: 0.25 }],
  ])("radial-gradient(%s)", (args, center, radius) => {
    expect(parseRadial(args, 200, 100)?.paint).toMatchObject({ type: "radial", center, radius });
  });

  it("turns full-size gradients into paints and small repeating ones into tiles", () => {
    const layers = backgroundLayers(
      {
        image:
          'radial-gradient(rgb(0, 0, 0) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(rgb(0, 0, 0), rgb(255, 0, 0)), url("a.png"), conic-gradient(red, blue)',
        size: "16px 16px, auto",
        repeat: "repeat",
        position: "0% 0%",
      },
      300,
      200,
    );
    expect(layers.map((l) => l.kind)).toEqual(["tile", "paint", "url", "unsupported"]);
    expect(layers[0]).toMatchObject({ width: 16, height: 16 });
    expect(layers[2]).toMatchObject({ kind: "url", url: "a.png" });
  });

  it("flags repeating gradients and offset tiles as approximations", () => {
    const [rep] = backgroundLayers(
      {
        image: "repeating-linear-gradient(rgb(0, 0, 0), rgb(255, 0, 0) 10px)",
        size: "auto",
        repeat: "repeat",
        position: "0% 0%",
      },
      100,
      100,
    );
    expect(rep).toMatchObject({ kind: "paint", approximated: expect.stringContaining("single repetition") });
    const [tile] = backgroundLayers(
      {
        image: "linear-gradient(rgb(0, 0, 0), rgb(255, 0, 0))",
        size: "10px 10px",
        repeat: "repeat",
        position: "5px 5px",
      },
      100,
      100,
    );
    expect(tile).toMatchObject({ kind: "tile", approximated: expect.stringContaining("offset") });
  });
});

const styles = (s: Record<string, string>) => (p: string) => s[p] ?? "";
const border = (width: string, style: string, color: string) =>
  Object.fromEntries(
    ["top", "right", "bottom", "left"].flatMap((side) => [
      [`border-${side}-width`, width],
      [`border-${side}-style`, style],
      [`border-${side}-color`, color],
    ]),
  );

describe("borders and radii", () => {
  it("maps a uniform border to one stroke", () => {
    expect(parseBorder(styles(border("2px", "dashed", "rgb(255, 0, 0)")))).toEqual({
      stroke: { color: red, weights: { top: 2, right: 2, bottom: 2, left: 2 }, style: "dashed" },
      mixedColors: false,
    });
  });

  it("keeps per-side weights, picks the widest side's color and flags mixed colors", () => {
    const s = {
      ...border("0px", "none", "rgb(0, 0, 0)"),
      "border-bottom-width": "3px",
      "border-bottom-style": "solid",
      "border-bottom-color": "rgb(255, 0, 0)",
      "border-left-width": "1px",
      "border-left-style": "solid",
    };
    const b = parseBorder(styles(s));
    expect(b.stroke).toMatchObject({ color: red, weights: { top: 0, right: 0, bottom: 3, left: 1 } });
    expect(b.mixedColors).toBe(true);
  });

  it("ignores invisible borders and approximates exotic styles", () => {
    expect(parseBorder(styles(border("1px", "solid", "rgba(0, 0, 0, 0)"))).stroke).toBeUndefined();
    expect(parseBorder(styles(border("4px", "none", "rgb(0, 0, 0)"))).stroke).toBeUndefined();
    expect(parseBorder(styles(border("4px", "double", "rgb(0, 0, 0)"))).approximated).toMatch(/double/);
  });

  const radii = (v: string) =>
    styles(
      Object.fromEntries(
        ["top-left", "top-right", "bottom-right", "bottom-left"].map((c) => [`border-${c}-radius`, v]),
      ),
    );

  it("resolves percentages and scales overlapping radii down like CSS", () => {
    expect(parseRadius(radii("8px"), 100, 40)).toEqual({ radius: [8, 8, 8, 8], elliptical: false });
    expect(parseRadius(radii("9999px"), 100, 40).radius).toEqual([20, 20, 20, 20]); // pill
    expect(parseRadius(radii("50%"), 80, 80).radius).toEqual([40, 40, 40, 40]); // circle
  });

  it("uses the smaller radius of an elliptical corner and says so", () => {
    expect(parseRadius(radii("50%"), 200, 100)).toEqual({ radius: [50, 50, 50, 50], elliptical: true });
  });
});

describe("shadows, filters, transforms", () => {
  it("parses multiple shadows, inset and spread, skipping invisible ones", () => {
    const effects = parseBoxShadow(
      "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgb(255, 0, 0) 0px 0px 0px 2px inset",
    );
    // Bottom-most first, like fills: CSS lists the top-most shadow first.
    expect(effects).toEqual([
      { type: "shadow", inset: true, offset: { x: 0, y: 0 }, blur: 0, spread: 2, color: red },
      {
        type: "shadow",
        inset: false,
        offset: { x: 0, y: 4 },
        blur: 6,
        spread: -1,
        color: { ...black, a: 0.1 },
      },
    ]);
  });

  it("maps blur to twice the CSS radius and reports other filters", () => {
    expect(parseFilter("blur(4px) grayscale(1)", "layer")).toEqual({
      effects: [{ type: "layer-blur", radius: 8 }],
      unsupported: ["filter grayscale()"],
    });
    expect(parseFilter("blur(12px)", "backdrop").effects).toEqual([{ type: "background-blur", radius: 24 }]);
    expect(parseFilter("drop-shadow(rgb(0, 0, 0) 2px 2px 4px)", "layer").effects).toMatchObject([
      { type: "shadow", offset: { x: 2, y: 2 }, blur: 4, spread: 0 },
    ]);
  });

  it("extracts rotation and scale from the computed matrix", () => {
    const r = parseTransform("matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)");
    expect(r.rotation).toBeCloseTo(45);
    expect(r.unsupported).toBeUndefined();
    expect(parseTransform("matrix(2, 0, 0, 2, 10, 10)")).toMatchObject({ rotation: 0, scaleX: 2, scaleY: 2 });
    expect(parseTransform("matrix(1, 0, 0.5, 1, 0, 0)").unsupported).toMatch(/skew/);
    expect(parseTransform("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)").unsupported).toMatch(
      /3D/,
    );
  });

  it("combines the individual rotate and scale properties (Tailwind v4 rotate-*, scale-*)", () => {
    expect(parseTransform("none", "12deg", "none").rotation).toBeCloseTo(12);
    expect(parseTransform("none", "z 0.25turn", "none").rotation).toBeCloseTo(90);
    expect(
      parseTransform("matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)", "45deg", "1.5").rotation,
    ).toBeCloseTo(90);
    expect(parseTransform("none", "none", "150% 150%")).toMatchObject({ scaleX: 1.5, scaleY: 1.5 });
    expect(parseTransform("none", "x 45deg", "none").unsupported).toMatch(/3D/);
  });
});
