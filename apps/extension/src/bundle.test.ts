import { el, page } from "@w2f/convert/testing";
import { type BoxNode, parseBundle } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { type Deps, toBundle } from "./bundle.ts";

/** Just enough PNG for sniffing and the IHDR size. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function deps(over: Partial<Deps> = {}) {
  const crops: { x: number; y: number; width: number; height: number; scale: number }[] = [];
  const d: Deps = {
    fetch: async (url) => (url.endsWith("/a.png") ? png(40, 30) : `HTTP 404`),
    decode: async () => ({ width: 40, height: 30 }),
    crop: async (r, scale) => {
      crops.push({ ...r, scale });
      return png(Math.round(r.width * scale), Math.round(r.height * scale));
    },
    screenshotScale: 2,
    ...over,
  };
  return { d, crops };
}

// An <img>, a missing image, a canvas on screen and one below the fold (viewport 1440×900).
const snapshot = () =>
  page(
    (body) => [
      {
        ...el(body.id, "img", { x: 0, y: 0, width: 40, height: 30 }),
        image: { src: "https://x/a.png", width: 40, height: 30, state: "loaded" },
      },
      {
        ...el(body.id, "img", { x: 50, y: 0, width: 40, height: 30 }),
        image: { src: "https://x/gone.png", width: 40, height: 30, state: "loaded" },
      },
      el(body.id, "canvas", { x: 100, y: 100, width: 50, height: 20 }),
      el(body.id, "canvas", { x: 100, y: 1500, width: 50, height: 20 }),
    ],
    "rgba(0, 0, 0, 0)",
    2000,
  );

const kids = (b: { ir: { captures: { root: BoxNode }[] } }) => b.ir.captures[0]?.root.children ?? [];

describe("toBundle (extension)", () => {
  it("builds a valid bundle: fetched images, on-screen islands, reference screenshot", async () => {
    const { d, crops } = deps();
    const r = await toBundle({ snapshot: snapshot(), scroll: { x: 0, y: 0 } }, d);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    expect(parseBundle(JSON.parse(JSON.stringify(r.value))).ok).toBe(true);

    const fills = JSON.stringify(kids(r.value));
    expect(fills).toContain('"type":"image"');
    // The undecodable <img> and the on-screen canvas at device scale, then the reference (viewport at 1×).
    expect(crops).toEqual([
      { x: 50, y: 0, width: 40, height: 30, scale: 2 },
      { x: 100, y: 100, width: 50, height: 20, scale: 2 },
      { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
    ]);
    expect(r.value.ir.captures[0]?.screenshot).toBeDefined();
    const rejected = r.value.ir.diagnostics.filter((x) => x.code === "ASSET_REJECTED").map((x) => x.message);
    expect(rejected).toEqual([
      expect.stringContaining("gone.png not used: HTTP 404"),
      expect.stringContaining("outside the visible part of the window"),
    ]);
  });

  it("crops relative to the scroll position and drops the reference when scrolled", async () => {
    const { d, crops } = deps();
    const r = await toBundle({ snapshot: snapshot(), scroll: { x: 0, y: 1000 } }, d);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    // The <img> at the top is off screen now; the canvas below the fold is on it.
    expect(crops).toEqual([{ x: 100, y: 500, width: 50, height: 20, scale: 2 }]);
    expect(r.value.ir.captures[0]?.screenshot).toBeUndefined();
  });

  it("keeps the transcoded bytes when the decoder converts an image", async () => {
    const out = png(20, 15);
    const { d } = deps({
      decode: async () => ({
        width: 40,
        height: 30,
        output: { base64: btoa(String.fromCharCode(...out)), mime: "image/png", width: 20, height: 15 },
      }),
    });
    const r = await toBundle({ snapshot: snapshot(), scroll: { x: 0, y: 0 } }, d);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    expect(Object.values(r.value.ir.assets)).toContainEqual({
      mime: "image/png",
      width: 20,
      height: 15,
      byteLength: 33,
    });
  });

  it("refuses a truncated page", async () => {
    const r = await toBundle(
      { snapshot: { ...snapshot(), truncated: true }, scroll: { x: 0, y: 0 } },
      deps().d,
    );
    expect(r.ok ? [] : r.diagnostics.map((x) => x.code)).toEqual(["PAGE_TOO_LARGE"]);
  });
});
