/// <reference path="../../../tests/fixture-server.ts" />
import type { BoxNode, Bundle, Node, TextNode } from "@w2f/ir";
import { afterAll, describe, expect, inject, it } from "vitest";
import { closeBrowser } from "./browser.ts";
import { convertUrls } from "./run.ts";
import { comparePngs, previewScreenshot } from "./visual.ts";

const base = inject("fixtureUrl");
const desktop = { width: 1440, height: 900, dpr: 1 };
const walk = (n: Node): Node[] => [n, ...(n.type === "box" ? n.children.flatMap(walk) : [])];

afterAll(closeBrowser);

async function bundle(route: string): Promise<Bundle> {
  const r = await convertUrls({ urls: [`${base}/${route}`], viewports: [desktop] });
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}

describe("boxes fixture → IR", async () => {
  const b = await bundle("boxes");
  const capture = b.ir.captures[0]!;
  const byId = (id: string) => {
    const n = walk(capture.root).find((x) => x.name.endsWith(` ${id}`));
    if (n?.type !== "box") throw new Error(`no box named *${id}`);
    return n as BoxNode;
  };

  it("maps borders: uniform, per side with mixed colors, dashed", () => {
    expect(byId("border-uniform").stroke).toMatchObject({
      weights: { top: 2, right: 2, bottom: 2, left: 2 },
      style: "solid",
    });
    expect(byId("border-sides").stroke?.weights).toEqual({ top: 0, right: 0, bottom: 4, left: 1 });
    expect(byId("border-dashed").stroke?.style).toBe("dashed");
    expect(b.ir.diagnostics.map((d) => d.code)).toContain("BORDER_COLORS_MIXED");
  });

  it("maps radii: pill, per corner, elliptical approximated", () => {
    expect(byId("pill").radius).toEqual([48, 48, 48, 48]);
    expect(byId("corners").radius).toEqual([24, 0, 8, 0]);
    expect(byId("ellipse").radius).toEqual([48, 48, 48, 48]);
    expect(b.ir.diagnostics.find((d) => d.message.includes("elliptical"))).toBeDefined();
  });

  it("maps shadows bottom-most first: drop, inset, Tailwind ring with offset", () => {
    expect(byId("shadow").effects).toHaveLength(2);
    expect(byId("shadow-inset").effects).toMatchObject([{ inset: true }]);
    // ring-offset (white, spread 2) is drawn on top of the ring (indigo, spread 4).
    expect(byId("ring").effects.map((e) => e.type === "shadow" && e.spread)).toEqual([4, 2]);
  });

  it("maps gradients, layered backgrounds and the dot pattern tile", () => {
    expect(byId("linear").fills).toMatchObject([{ type: "linear", angle: 90 }]);
    expect(byId("radial").fills).toMatchObject([{ type: "radial", center: { x: 0.3, y: 0.3 } }]);
    expect(byId("layers").fills.map((f) => f.type)).toEqual(["solid", "linear", "linear"]);
    const [, tile] = byId("dots").fills;
    expect(tile).toMatchObject({ type: "image", scale: "tile", tileSize: { width: 16, height: 16 } });
    if (tile?.type === "image") expect(b.ir.assets[tile.assetId]).toMatchObject({ width: 16, height: 16 });
  });

  it("maps opacity, blend, clip, blur, backdrop blur, rotation and stacking", () => {
    expect(byId("opacity").opacity).toBe(0.5);
    expect(byId("blend").blendMode).toBe("multiply");
    expect(byId("clip").clip).toBe(true);
    expect(byId("blur").effects).toEqual([{ type: "layer-blur", radius: 16 }]);
    expect(byId("glass").effects).toEqual([{ type: "background-blur", radius: 24 }]);
    const rotated = byId("rotated");
    expect(rotated.rotation).toBeCloseTo(12);
    expect(rotated.bounds).toMatchObject({ width: 160, height: 96 });
    expect(byId("stack").children.map((c) => c.name)).toEqual(["div z-bottom", "div z-top"]);
  });

  it("draws img, svg, canvas and a native checkbox as raster islands", () => {
    for (const id of ["img", "svg", "chart", "checkbox"]) {
      const fill = byId(id).fills[0];
      expect(fill?.type, id).toBe("image");
      if (fill?.type === "image") expect(b.assetData[fill.assetId], id).toBeTruthy();
    }
    expect(b.ir.diagnostics.filter((d) => d.code === "RASTERIZED")).toHaveLength(4);
  });
});

// Phase 4 DoD: paragraphs are single text nodes with correct style runs.
describe("article fixture → IR", async () => {
  const b = await bundle("article");
  const texts = walk(b.ir.captures[0]!.root).filter((n): n is TextNode => n.type === "text");
  const text = (start: string) => {
    const found = texts.filter((t) => t.characters.startsWith(start));
    if (found.length !== 1) throw new Error(`${found.length} text nodes start with "${start}"`);
    return found[0]!;
  };
  /** The style of the run covering `word`, which must not straddle a run boundary. */
  const styleOf = (t: TextNode, word: string) => {
    const at = t.characters.indexOf(word);
    const run = t.runs.find((r) => r.start <= at && at + word.length <= r.end);
    if (at < 0 || !run) throw new Error(`"${word}" is not inside one run of "${t.name}"`);
    return run.style;
  };

  it("draws the wrapped paragraph as one text node with a run per inline style", () => {
    const intro = text("Converters work from");
    expect(intro.characters).toBe(
      "Converters work from what the browser drew, not from the source. A paragraph with emphasis, a link with bold inside and colored words still becomes a single text layer, wrapped at the same width as in the browser.",
    );
    expect(texts.filter((t) => t.source.selector === intro.source.selector)).toHaveLength(1);
    expect(intro).toMatchObject({ autoResize: "height" });
    expect(intro.lineCount).toBeGreaterThan(1);
    const body = styleOf(intro, "Converters");
    expect(body).toMatchObject({ weight: 400, italic: false, decoration: "none", size: 18, lineHeight: 32 });
    expect(styleOf(intro, "what the browser drew").weight).toBe(700);
    expect(styleOf(intro, "emphasis").italic).toBe(true);
    const link = styleOf(intro, "link with ");
    expect(link).toMatchObject({ decoration: "underline", weight: 400 });
    expect(link.color).not.toEqual(body.color);
    expect(styleOf(intro, "bold")).toMatchObject({ decoration: "underline", weight: 700, color: link.color });
    expect(styleOf(intro, "colored words").color).not.toEqual(body.color);
    expect(styleOf(intro, " still becomes")).toEqual(body);
  });

  it("maps del/ins decorations, <br> breaks and the title's text-shadow", () => {
    const prices = text("Prices drop");
    expect(styleOf(prices, "$40").decoration).toBe("line-through");
    expect(styleOf(prices, "$25").decoration).toBe("underline");
    expect(text("First line").characters).toBe("First line\nSecond line");
    expect(text("Reading the rendered page").effects).toMatchObject([
      { type: "shadow", offset: { x: 0, y: 2 }, blur: 4, color: { a: 0.25 } },
    ]);
    expect(b.ir.diagnostics.filter((d) => d.message.includes("text-shadow"))).toEqual([]);
  });

  it("keeps an inline element with its own box (code) as a box between text nodes", () => {
    expect(["Run", "pnpm w2f", " against any page."].map((s) => text(s).characters)).toEqual([
      "Run",
      "pnpm w2f",
      " against any page.",
    ]);
    const code = walk(b.ir.captures[0]!.root).find((n) => n.name.startsWith("code"));
    expect(code?.type).toBe("box");
  });

  it("keeps the requested family first so the plugin can report it missing", () => {
    expect(styleOf(text("This line asks"), "font").families[0]).toBe("W2F Missing Serif");
    expect(styleOf(text("Field notes"), "Field").transform).toBe("uppercase");
    expect(styleOf(text("Field notes"), "Field").letterSpacing).toBeGreaterThan(0);
  });
});

// Phase 3 DoD: the IR, rendered back to HTML, differs from the original page by ≤5% of pixels.
describe("visual diff: original page vs renderIRToHtml(IR)", () => {
  it.each(["landing", "card-grid", "boxes", "article"])("%s stays within the diff budget", async (route) => {
    const b = await bundle(route);
    const capture = b.ir.captures[0]!;
    const reference = Buffer.from(b.assetData[capture.screenshot!]!, "base64");
    const preview = await previewScreenshot(
      `${base}/${route}`,
      capture,
      b.assetData,
      reference.readUInt32BE(20),
    );
    const diff = await comparePngs(reference, preview);
    console.log(`${route}: ${(diff.mismatch * 100).toFixed(2)}% of pixels differ`);
    expect(diff.sizeDiffers).toBe(false);
    expect(diff.mismatch).toBeLessThanOrEqual(0.05);
  });

  it("detects a real difference (guards against comparing an image with itself)", async () => {
    const b = await bundle("card-grid");
    const capture = b.ir.captures[0]!;
    const reference = Buffer.from(b.assetData[capture.screenshot!]!, "base64");
    const emptied = { ...capture, root: { ...capture.root, children: [] } };
    const preview = await previewScreenshot(
      `${base}/card-grid`,
      emptied,
      b.assetData,
      reference.readUInt32BE(20),
    );
    expect((await comparePngs(reference, preview)).mismatch).toBeGreaterThan(0.05);
  });
});
