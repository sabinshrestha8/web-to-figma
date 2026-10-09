import type { BoxNode, Node, TextNode } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { diffCaptures, renderDrift } from "./drift.ts";

let id = 0;
const box = (name: string, x: number, y: number, w: number, h: number, children: Node[] = []): BoxNode => ({
  id: `n${id++}`,
  type: "box",
  name,
  bounds: { x, y, width: w, height: h },
  opacity: 1,
  blendMode: "normal",
  effects: [],
  position: "flow",
  sizing: { horizontal: "fixed", vertical: "fixed" },
  source: { tag: "div", selector: `div.${name}` },
  fills: [],
  radius: [0, 0, 0, 0],
  clip: false,
  layout: { mode: "none" },
  children,
});
const text = (characters: string, x = 0, y = 0): TextNode => ({
  id: `n${id++}`,
  type: "text",
  name: characters.slice(0, 20),
  bounds: { x, y, width: 100, height: 20 },
  opacity: 1,
  blendMode: "normal",
  effects: [],
  position: "flow",
  sizing: { horizontal: "hug", vertical: "hug" },
  source: { tag: "#text", selector: "#text" },
  characters,
  runs: [
    {
      start: 0,
      end: characters.length,
      style: {
        families: ["Inter"],
        weight: 400,
        italic: false,
        size: 16,
        lineHeight: 24,
        letterSpacing: 0,
        transform: "none",
        decoration: "none",
        color: { r: 0, g: 0, b: 0, a: 1 },
      },
    },
  ],
  align: "left",
  autoResize: "width-and-height",
  lineCount: 1,
});
const root = (children: Node[]): BoxNode => ({ ...box("root", 0, 0, 1440, 900, children), id: "root" });

describe("drift", () => {
  it("reports nothing for identical trees", () => {
    const r = diffCaptures(
      root([box("a", 0, 0, 100, 50, [text("Hi")])]),
      root([box("a", 0, 0, 100, 50, [text("Hi")])]),
    );
    expect(r.entries).toEqual([]);
    expect(renderDrift(r)).toMatch(/No drift/);
  });

  it("ignores sub-pixel jitter but flags real moves and resizes", () => {
    const r = diffCaptures(
      root([box("a", 0, 0, 100, 50), box("b", 0, 60, 100, 50)]),
      root([box("a", 0.5, 0, 100, 50), box("b", 0, 65, 120, 50)]),
    );
    expect(r.entries.map((e) => [e.kind, e.detail])).toEqual([
      ["moved", "(0, 60) → (0, 65)"],
      ["resized", "100×50 → 120×50"],
    ]);
  });

  it("reports text, restyle, layout, added and removed nodes", () => {
    const paint = { type: "solid" as const, color: { r: 1, g: 0, b: 0, a: 1 } };
    const oldR = root([
      text("Total 27"),
      { ...box("card", 0, 0, 200, 100), fills: [] },
      box("gone", 0, 200, 50, 50),
    ]);
    const newR = root([
      text("Total 28"),
      {
        ...box("card", 0, 0, 200, 100),
        fills: [paint],
        layout: {
          mode: "stack",
          direction: "horizontal",
          reverse: false,
          wrap: false,
          gap: 24,
          crossGap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          justify: "start",
          align: "start",
        },
      },
      box("fresh", 0, 320, 50, 50),
    ]);
    const kinds = diffCaptures(oldR, newR)
      .entries.map((e) => e.kind)
      .sort();
    expect(kinds).toEqual(["added", "layout-changed", "removed", "restyled", "text-changed"]);
    expect(renderDrift(diffCaptures(oldR, newR))).toMatch(/Text changed \(1\)/);
  });

  it("ignores float noise from a Figma round trip", () => {
    const fill = (r: number) => [{ type: "solid" as const, color: { r, g: 0, b: 0, a: 1 } }];
    const stack = (gap: number) => ({
      mode: "stack" as const,
      direction: "horizontal" as const,
      reverse: false,
      wrap: false,
      gap,
      crossGap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      justify: "start" as const,
      align: "start" as const,
    });
    const a = root([{ ...box("card", 0, 0, 200, 100), fills: fill(0.3843137323856354), layout: stack(7.5) }]);
    const b = root([{ ...box("card", 0, 0, 200, 100), fills: fill(0.3843), layout: stack(7.51) }]);
    expect(diffCaptures(a, b).entries).toEqual([]);
    const c = root([{ ...box("card", 0, 0, 200, 100), fills: fill(0.5), layout: stack(15) }]);
    expect(
      diffCaptures(a, c)
        .entries.map((e) => e.kind)
        .sort(),
    ).toEqual(["layout-changed", "restyled"]);
  });
});
