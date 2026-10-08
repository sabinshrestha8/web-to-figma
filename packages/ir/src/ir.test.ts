import { describe, expect, it } from "vitest";
import {
  type BoxNode,
  BUNDLE_FORMAT,
  type Document,
  migrate,
  parseBundle,
  parseDocument,
  SCHEMA_VERSION,
  type TextNode,
} from "./index.ts";

const ASSET = "a".repeat(64);
const black = { r: 0, g: 0, b: 0, a: 1 };
const common = {
  name: "",
  opacity: 1,
  blendMode: "normal" as const,
  effects: [],
  position: "flow" as const,
  sizing: { horizontal: "fixed" as const, vertical: "fixed" as const },
  source: { tag: "div", selector: "div" },
};

function text(id: string, characters: string, runs: [number, number][]): TextNode {
  return {
    ...common,
    id,
    type: "text",
    bounds: { x: 24, y: 24, width: 200, height: 32 },
    characters,
    runs: runs.map(([start, end]) => ({
      start,
      end,
      style: {
        families: ["Inter", "sans-serif"],
        weight: 700,
        italic: false,
        size: 24,
        lineHeight: 32,
        letterSpacing: 0,
        transform: "none",
        decoration: "none",
        color: black,
      },
    })),
    align: "left",
    autoResize: "width-and-height",
    lineCount: 1,
  };
}

function sample(): Document {
  const image: BoxNode = {
    ...common,
    id: "img",
    type: "box",
    bounds: { x: 0, y: 80, width: 400, height: 200 },
    fills: [{ type: "image", assetId: ASSET, scale: "cover", position: { x: 0.5, y: 0.5 } }],
    radius: [12, 12, 12, 12],
    clip: true,
    layout: { mode: "none" },
    children: [],
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: "test", version: "0.0.0" },
    captures: [
      {
        id: "c1",
        url: "http://localhost:3000/",
        title: "Home",
        viewport: { width: 1440, height: 900, dpr: 1 },
        root: {
          ...common,
          id: "root",
          type: "box",
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 } }],
          stroke: { color: black, weights: { top: 1, right: 0, bottom: 0, left: 0 }, style: "solid" },
          radius: [0, 0, 0, 0],
          clip: false,
          layout: {
            mode: "stack",
            direction: "vertical",
            reverse: false,
            wrap: false,
            gap: 16,
            crossGap: 0,
            padding: { top: 24, right: 24, bottom: 24, left: 24 },
            justify: "start",
            align: "start",
          },
          children: [
            text("t1", "Hello world", [
              [0, 6],
              [6, 11],
            ]),
            image,
            {
              ...common,
              id: "v1",
              type: "vector",
              bounds: { x: 0, y: 0, width: 24, height: 24 },
              svg: "<svg/>",
            },
          ],
        },
      },
    ],
    assets: { [ASSET]: { mime: "image/png", width: 800, height: 400, byteLength: 1234 } },
    diagnostics: [
      { code: "LAYOUT_ABSOLUTE_FALLBACK", severity: "info", message: "gaps not uniform", nodeId: "root" },
    ],
  };
}

/** JSON round-trip, i.e. exactly what crosses the file/postMessage boundary. */
const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

function errors(input: unknown): string[] {
  const r = parseDocument(input);
  return r.ok ? [] : r.diagnostics.map((d) => `${d.code}: ${d.message}`);
}

describe("parseDocument", () => {
  it("accepts a valid document and round-trips it unchanged", () => {
    const doc = sample();
    const r = parseDocument(roundTrip(doc));
    expect(r).toEqual({ ok: true, value: doc });
  });

  it("rejects image paints pointing at undeclared assets", () => {
    const doc = sample();
    doc.assets = {};
    expect(errors(doc).join()).toMatch(/unknown asset/);
  });

  it("rejects duplicate node ids", () => {
    const doc = sample();
    const root = doc.captures[0]!.root;
    root.children.push(text("t1", "dup", [[0, 3]]));
    expect(errors(doc).join()).toMatch(/duplicate node id t1/);
  });

  it.each([
    [
      "gap between runs",
      [
        [0, 5],
        [6, 11],
      ],
    ],
    ["runs short of the end", [[0, 6]]],
    [
      "empty run",
      [
        [0, 0],
        [0, 11],
      ],
    ],
  ] as const)("rejects text runs with %s", (_, runs) => {
    const doc = sample();
    doc.captures[0]!.root.children[0] = text(
      "t1",
      "Hello world",
      runs.map((r) => [...r] as [number, number]),
    );
    expect(errors(doc).join()).toMatch(/run/);
  });

  it.each([
    [
      "color out of range",
      (d: Document) => {
        d.captures[0]!.root.fills = [{ type: "solid", color: { r: 2, g: 0, b: 0, a: 1 } }];
      },
    ],
    [
      "negative width",
      (d: Document) => {
        d.captures[0]!.root.bounds.width = -1;
      },
    ],
    [
      "bad asset id",
      (d: Document) => {
        d.assets = { nope: { mime: "image/png", width: 1, height: 1, byteLength: 1 } };
      },
    ],
    [
      "unknown diagnostic code",
      (d: Document) => {
        (d.diagnostics[0] as { code: string }).code = "NOPE";
      },
    ],
    [
      "unknown node type",
      (d: Document) => {
        (d.captures[0]!.root.children[2] as { type: string }).type = "ellipse";
      },
    ],
  ])("rejects %s", (_, mutate) => {
    const doc = sample();
    mutate(doc);
    expect(errors(doc).length).toBeGreaterThan(0);
  });

  it("reports BUNDLE_INVALID with a path", () => {
    const doc = sample();
    doc.captures[0]!.viewport.width = 0;
    expect(errors(doc)[0]).toMatch(/^BUNDLE_INVALID: captures\.0\.viewport\.width/);
  });
});

describe("migrate", () => {
  it("rejects a newer major version with SCHEMA_VERSION_UNSUPPORTED", () => {
    const r = migrate({ ...sample(), schemaVersion: "2.0" });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.diagnostics[0]).toMatchObject({ code: "SCHEMA_VERSION_UNSUPPORTED", severity: "fatal" });
  });

  it("rejects an older major with no registered migration", () => {
    const r = migrate({ ...sample(), schemaVersion: "0.9" });
    expect(r.ok || r.diagnostics[0]?.code).toBe("SCHEMA_VERSION_UNSUPPORTED");
  });

  it.each([undefined, 1, "1", "v1.0", null])("rejects malformed schemaVersion %s", (v) => {
    const r = migrate({ ...sample(), schemaVersion: v });
    expect(r.ok || r.diagnostics[0]?.code).toBe("BUNDLE_INVALID");
  });

  it("accepts a newer minor of the same major and strips unknown fields", () => {
    const r = parseDocument({ ...(roundTrip(sample()) as object), schemaVersion: "1.7", futureField: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.schemaVersion).toBe(SCHEMA_VERSION);
      expect("futureField" in r.value).toBe(false);
    }
  });

  it("rejects non-objects", () => {
    for (const v of [null, [], "x", 3]) expect(migrate(v).ok).toBe(false);
  });
});

describe("parseBundle", () => {
  const bundle = (assetData: Record<string, string>) => ({ format: BUNDLE_FORMAT, ir: sample(), assetData });

  it("accepts a bundle whose assetData matches ir.assets", () => {
    const r = parseBundle(roundTrip(bundle({ [ASSET]: "iVBORw0KGgo=" })));
    expect(r.ok).toBe(true);
  });

  it("rejects missing or extra asset data", () => {
    expect(parseBundle(bundle({})).ok).toBe(false);
    expect(parseBundle(bundle({ [ASSET]: "AA==", ["b".repeat(64)]: "AA==" })).ok).toBe(false);
  });

  it("rejects non-base64 asset data and wrong format tag", () => {
    expect(parseBundle(bundle({ [ASSET]: "not base64!" })).ok).toBe(false);
    expect(parseBundle({ ...bundle({ [ASSET]: "AA==" }), format: "other" }).ok).toBe(false);
  });

  it("surfaces IR version errors from inside the bundle", () => {
    const r = parseBundle({ format: BUNDLE_FORMAT, ir: { schemaVersion: "9.0" }, assetData: {} });
    expect(r.ok || r.diagnostics[0]?.code).toBe("SCHEMA_VERSION_UNSUPPORTED");
  });
});
