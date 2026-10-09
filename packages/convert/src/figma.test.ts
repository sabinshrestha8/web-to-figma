import type { BoxNode } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { convertNode, type FigmaRestNode } from "./figma.ts";

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
});
