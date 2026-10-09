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

  it("draws canvas and a native checkbox as raster islands; img and svg are real images and vectors", () => {
    for (const id of ["img", "chart", "checkbox"]) {
      const fill = byId(id).fills[0];
      expect(fill?.type, id).toBe("image");
      if (fill?.type === "image") expect(b.assetData[fill.assetId], id).toBeTruthy();
    }
    expect(walk(capture.root).find((n) => n.name === "svg svg")?.type).toBe("vector");
    expect(b.ir.diagnostics.filter((d) => d.code === "RASTERIZED")).toHaveLength(2);
  });
});

// Phase 5 DoD: no broken images on image-heavy; icons are editable vectors.
describe("image-heavy fixture → IR", async () => {
  const b = await bundle("image-heavy");
  const nodes = walk(b.ir.captures[0]!.root);
  const imageOf = (id: string) => {
    const n = nodes.find((x) => x.name.endsWith(` ${id}`));
    if (n?.type !== "box") throw new Error(`no box named *${id}`);
    const paint = n.fills.find((f) => f.type === "image");
    if (paint?.type !== "image") throw new Error(`${id} has no image fill`);
    return { paint, asset: b.ir.assets[paint.assetId]!, data: b.assetData[paint.assetId] };
  };
  const IMAGES = ["png", "cover", "cover-top", "contain", "fill", "none", "webp", "picture", "next"]
    .concat(["avatar", "svg", "data", "oversize", "lazy"])
    .map((s) => `img-${s}`);

  it("turns every loaded image into an image fill with its bytes, never a raster island", () => {
    for (const id of [...IMAGES, "bg-cover", "bg-contain", "bg-tile", "bg-layered"]) {
      const { data, asset } = imageOf(id);
      expect(data, id).toBeTruthy();
      expect(Math.max(asset.width, asset.height), id).toBeLessThanOrEqual(4096);
    }
    expect(b.ir.diagnostics.filter((d) => d.code === "RASTERIZED")).toEqual([]);
    expect(b.ir.diagnostics.filter((d) => d.code === "ASSET_REJECTED")).toEqual([]);
  });

  it("reports the 404 image once, as a grey placeholder", () => {
    const failed = b.ir.diagnostics.filter((d) => d.code === "IMAGE_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      fallback: "placeholder",
      message: expect.stringContaining("missing.png"),
    });
  });

  it("maps object-fit and background sizing to scale modes and crops", () => {
    expect(imageOf("img-cover").paint).toMatchObject({ scale: "cover" });
    expect(imageOf("img-cover").paint.crop).toBeUndefined();
    expect(imageOf("img-cover-top").paint).toMatchObject({
      scale: "cover",
      crop: { x: 0, y: 0, width: 1, height: 0.4444 },
    });
    expect(imageOf("img-contain").paint.scale).toBe("contain");
    expect(imageOf("img-fill").paint.scale).toBe("stretch");
    expect(imageOf("img-none").paint.crop).toMatchObject({ width: 0.3, height: 0.2667 });
    expect(imageOf("bg-cover").paint.scale).toBe("cover");
    expect(imageOf("bg-contain").paint.scale).toBe("contain");
    expect(imageOf("bg-tile").paint).toMatchObject({ scale: "tile", tileSize: { width: 24, height: 24 } });
  });

  it("transcodes what Figma can't take: WebP, SVG-as-img, oversize", () => {
    expect(imageOf("img-webp").asset.mime).toBe("image/jpeg"); // opaque → JPEG
    expect(imageOf("img-svg").asset).toMatchObject({ mime: "image/png", width: 96, height: 96 });
    expect(imageOf("img-oversize").asset).toMatchObject({ width: 4096, height: 328 });
    expect(imageOf("img-png").asset).toMatchObject({ mime: "image/png", width: 480, height: 320 }); // as served
  });
});

describe("svg-icons fixture → IR", async () => {
  const b = await bundle("svg-icons");
  const vectors = walk(b.ir.captures[0]!.root).filter((n) => n.type === "vector");
  const svgOf = (id: string) => {
    const v = vectors.find((n) => n.name === `svg ${id}`);
    if (v?.type !== "vector") throw new Error(`no vector ${id}`);
    return v;
  };

  it("draws every visible icon as a vector with a PNG fallback", () => {
    expect(vectors.map((v) => v.name.replace("svg ", "")).sort()).toEqual(
      [
        "icon-home",
        "icon-bell",
        "icon-check",
        "icon-sprite",
        "icon-filled",
        "icon-gradient",
        "icon-text",
        "icon-css-geometry",
      ]
        .concat(["hostile", "icon-inline"])
        .sort(),
    );
    for (const v of vectors) {
      expect(v.type === "vector" && v.fallback && b.assetData[v.fallback], v.name).toBeTruthy();
    }
  });

  it("resolves currentColor, classes, sprites and display:none into plain attributes", () => {
    const home = svgOf("icon-home").svg;
    expect(home).toMatch(/stroke="rgba\(\d+, \d+, \d+, 1\)"/);
    expect(home).toContain('stroke-width="2"');
    expect(svgOf("icon-check").svg).toContain('stroke-width="3"'); // from a class
    const sprite = svgOf("icon-sprite").svg;
    expect(sprite).toContain("<path");
    expect(sprite).not.toMatch(/<use|currentColor/i);
    const filled = svgOf("icon-filled").svg;
    expect(filled).not.toContain("<rect"); // display:none
    expect(filled).not.toContain("class=");
    expect(svgOf("icon-gradient").svg).toMatch(/<linearGradient[^>]*>.*stop-color="rgba?\(/);
    expect(svgOf("icon-gradient").svg).toContain('fill="url(#grad)"');
    // CSS-set geometry (MUI X Charts bars) survives losing the style attribute.
    const bars = svgOf("icon-css-geometry").svg;
    expect(bars).toMatch(/<rect[^>]*x="10"[^>]*y="4"[^>]*width="6"[^>]*height="18"[^>]*rx="1"/);
    expect(bars).toMatch(/<circle[^>]*cx="20"[^>]*cy="5"[^>]*r="3"/);
    expect(bars).toContain('transform="matrix(1, 0, 0, 1, 18, 16)"');
    // fill-box origin (the rect's center) baked in, since SVG transforms run around 0 0
    expect(bars).toContain('transform="translate(2 2) matrix(0.5, 0, 0, 0.5, 0, 0) translate(-2 -2)"');
    // em offsets resolved against each tspan's own font size
    expect(bars).toMatch(/<tspan[^>]*dy="-5"/);
    expect(bars).toMatch(/<tspan[^>]*dy="20"/);
  });

  it("strips scripts, handlers, foreignObject, styles, animations and external references", () => {
    for (const v of vectors) {
      if (v.type !== "vector") continue;
      expect(v.svg, v.name).not.toMatch(
        /<script|<foreignObject|<style|<animate|\son\w+=|javascript:|127\.0\.0\.1:9/i,
      );
    }
    expect(svgOf("hostile").svg).toContain("<circle");
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

  it("truncates a `truncate` line at its 128 px box instead of clipping it", () => {
    const t = text("2083-06-24");
    expect(t).toMatchObject({ truncate: true, autoResize: "height", lineCount: 1 });
    expect(t.bounds.width).toBeCloseTo(128, 0);
    expect(t.characters).toBe("2083-06-24 (2026-10-10) to 2083-06-30");
  });

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

// Phase 6 DoD: nav, card-grid, form and dashboard come out as Auto Layout.
describe("layout fixtures → IR", async () => {
  const byId = (capture: Parameters<typeof walk>[0], id: string) => {
    const n = walk(capture).find((x) => x.name.endsWith(` ${id}`));
    if (n?.type !== "box") throw new Error(`no box named *${id}`);
    return n as BoxNode;
  };

  it("builds the nav header as space-between stacks", async () => {
    const b = await bundle("nav");
    const root = b.ir.captures[0]!.root;
    expect(byId(root, "site-header").layout).toMatchObject({
      mode: "stack",
      direction: "horizontal",
      justify: "space-between",
    });
    expect(byId(root, "site-nav").layout).toMatchObject({ mode: "stack", direction: "horizontal" });
    expect(byId(root, "cta-row").layout).toMatchObject({
      mode: "stack",
      direction: "horizontal",
      justify: "center",
    });
  });

  it("builds the card grid as a fixed-track grid", async () => {
    const b = await bundle("card-grid");
    const root = b.ir.captures[0]!.root;
    const cards = walk(root).filter((n) => n.name === "article card");
    expect(cards).toHaveLength(6);
    const grid = byId(root, "card-grid");
    if (grid.layout.mode !== "grid") throw new Error(`card grid is ${grid.layout.mode}, want grid`);
    expect(grid.layout.columns).toHaveLength(3);
    expect(cards.map((c) => c.position)).toEqual(Array(6).fill("flow"));
  });

  it("builds the form as nested stacks, with the checkbox as a raster island", async () => {
    const b = await bundle("form");
    const root = b.ir.captures[0]!.root;
    expect(byId(root, "invite-form").layout).toMatchObject({ mode: "stack", direction: "vertical" });
    expect(byId(root, "notify-row").layout).toMatchObject({ mode: "stack", direction: "horizontal" });
    expect(byId(root, "form-actions").layout).toMatchObject({
      mode: "stack",
      direction: "horizontal",
      justify: "end",
    });
    expect(b.ir.diagnostics.filter((d) => d.code === "RASTERIZED")).not.toEqual([]);
  });

  it("builds the dashboard shell as a stack with a filling main column", async () => {
    const b = await bundle("dashboard");
    const root = b.ir.captures[0]!.root;
    expect(byId(root, "shell").layout).toMatchObject({ mode: "stack", direction: "horizontal" });
    expect(byId(root, "main").sizing).toMatchObject({ horizontal: "fill" });
    expect(byId(root, "stat-row").layout).toMatchObject({ mode: "stack", direction: "horizontal" });
    const chart = byId(root, "chart");
    expect(chart.fills[0]?.type).toBe("image");
    expect(b.ir.diagnostics.filter((d) => d.code === "RASTERIZED")).not.toEqual([]);
  });
});

// Phase 3 DoD: the IR, rendered back to HTML, differs from the original page by ≤5% of pixels.
describe("visual diff: original page vs renderIRToHtml(IR)", () => {
  it.each([
    "landing",
    "card-grid",
    "boxes",
    "article",
    "image-heavy",
    "svg-icons",
    "nav",
    "form",
    "dashboard",
  ])("%s stays within the diff budget", async (route) => {
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
