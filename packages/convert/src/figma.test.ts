import type { BoxNode } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { collapseStops, convertNode, type FigmaRestNode } from "./figma.ts";

const frame: FigmaRestNode = {
  id: "1:2",
  name: "dashboard",
  type: "FRAME",
  absoluteBoundingBox: { x: 500, y: 200, width: 1440, height: 900 },
  layoutMode: "NONE",
  children: [
    {
      id: "1:3",
      name: "header",
      type: "FRAME",
      absoluteBoundingBox: { x: 500, y: 200, width: 1440, height: 60 },
      layoutMode: "HORIZONTAL",
      itemSpacing: 32,
      paddingLeft: 40,
      paddingRight: 40,
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      fills: [{ type: "SOLID", color: { r: 0.06, g: 0.09, b: 0.17, a: 1 } }],
      children: [
        {
          id: "1:4",
          name: "Total 27",
          type: "TEXT",
          absoluteBoundingBox: { x: 540, y: 221, width: 100, height: 18 },
          characters: "Total 27",
          style: { fontFamily: "Inter", fontWeight: 700, fontSize: 16, textAlignHorizontal: "LEFT" },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
        },
      ],
    },
  ],
};

describe("figma normalize", () => {
  it("drops the plugin's premultiplied sub-stops but keeps declared ones", () => {
    const stop = (position: number, r: number, g: number, b: number, a: number) => ({
      position,
      color: { r, g, b, a },
    });
    // transparent blue → white: the midpoint is white at half alpha when premultiplied
    expect(collapseStops([stop(0, 0, 0, 1, 0), stop(0.5, 1, 1, 1, 0.5), stop(1, 1, 1, 1, 1)])).toEqual([
      stop(0, 0, 0, 1, 0),
      stop(1, 1, 1, 1, 1),
    ]);
    expect(collapseStops([stop(0, 0, 0, 0, 1), stop(0.5, 1, 0, 0, 1), stop(1, 1, 1, 1, 1)])).toHaveLength(3);
  });

  it("rebases the frame onto the capture origin and maps layout, fills and text", () => {
    const root = convertNode(frame, 0 - 500, 0 - 200);
    if (root.type !== "box") throw new Error("want box");
    expect(root.bounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
    const header = (root as BoxNode).children[0];
    if (header?.type !== "box") throw new Error("want header box");
    expect(header.layout).toMatchObject({
      mode: "stack",
      direction: "horizontal",
      justify: "space-between",
      align: "center",
      gap: 32,
    });
    expect(header.fills).toEqual([{ type: "solid", color: { r: 0.06, g: 0.09, b: 0.17, a: 1 } }]);
    const label = header.children[0];
    if (label?.type !== "text") throw new Error("want text");
    expect(label).toMatchObject({ characters: "Total 27", align: "left" });
    expect(label.runs[0]?.style).toMatchObject({ families: ["Inter"], weight: 700, size: 16 });
    expect(label.bounds).toMatchObject({ x: 40, y: 21 });
  });

  it("maps grids and absolute children without-plugin values", () => {
    const grid = convertNode({
      id: "2:1",
      name: "grid",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 200 },
      layoutMode: "GRID",
      gridColumnCount: 3,
      gridRowCount: 2,
      gridColumnGap: 20,
      layoutPositioning: "ABSOLUTE",
      children: [],
    });
    if (grid.type !== "box") throw new Error("want box");
    expect(grid.layout).toMatchObject({ mode: "grid", columnGap: 20 });
    expect(grid.position).toBe("absolute");
    expect(grid.sizing).toEqual({ horizontal: "fixed", vertical: "fixed" });
  });

  it("maps radius, clip, stroke, effects and blend, and drops hidden paints", () => {
    const card = convertNode({
      id: "3:1",
      name: "card",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
      cornerRadius: 12,
      clipsContent: true,
      blendMode: "MULTIPLY",
      fills: [
        { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } },
        { type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0, a: 1 } },
        { type: "IMAGE", scaleMode: "FIT" },
      ],
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 }],
      strokeWeight: 2,
      strokeDashes: [6, 6],
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 8,
          spread: 0,
        },
        { type: "LAYER_BLUR", visible: false, radius: 4 },
      ],
      children: [],
    });
    if (card.type !== "box") throw new Error("want box");
    expect(card.radius).toEqual([12, 12, 12, 12]);
    expect(card.clip).toBe(true);
    expect(card.blendMode).toBe("multiply");
    expect(card.fills.map((f) => f.type)).toEqual(["solid", "image"]);
    expect(card.fills[1]).toMatchObject({ scale: "contain", assetId: "" });
    expect(card.stroke).toEqual({
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      weights: { top: 2, right: 2, bottom: 2, left: 2 },
      style: "dashed",
    });
    expect(card.effects).toEqual([
      {
        type: "shadow",
        inset: false,
        offset: { x: 0, y: 4 },
        blur: 8,
        spread: 0,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
      },
    ]);
  });

  it("recovers the CSS angle of a linear gradient from its handles", () => {
    const n = convertNode({
      id: "4:1",
      name: "g",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientHandlePositions: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
            { x: 0, y: 1 },
          ],
          gradientStops: [
            { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
          ],
        },
      ],
    });
    if (n.type !== "box") throw new Error("want box");
    expect(n.fills[0]).toMatchObject({ type: "linear", angle: 90 }); // to right
  });
});
