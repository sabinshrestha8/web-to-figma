import type { BoxNode } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { type RawElement, type RawText, STYLE_PROPS, type StyleProp } from "./snapshot.ts";
import { snapshotToIR } from "./snapshot-to-ir.ts";

const defaults: Record<StyleProp, string> = {
  ...(Object.fromEntries(STYLE_PROPS.map((p) => [p, "0px"])) as Record<StyleProp, string>),
  display: "block",
  visibility: "visible",
  opacity: "1",
  position: "static",
  "white-space": "normal",
  "background-color": "rgba(0, 0, 0, 0)",
  color: "rgb(0, 0, 0)",
  "font-family": "Inter, sans-serif",
  "font-size": "16px",
  "font-weight": "400",
  "font-style": "normal",
  "line-height": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-transform": "none",
  "text-decoration-line": "none",
  "vertical-align": "baseline",
  "object-fit": "fill",
  "object-position": "50% 50%",
  ...Object.fromEntries(
    ["top", "right", "bottom", "left"].flatMap((side) => [
      [`border-${side}-style`, "none"],
      [`border-${side}-color`, "rgb(0, 0, 0)"],
    ]),
  ),
  "border-image-source": "none",
  "box-shadow": "none",
  "text-shadow": "none",
  "background-image": "none",
  "background-size": "auto",
  "background-position": "0% 0%",
  "background-repeat": "repeat",
  "mix-blend-mode": "normal",
  "overflow-x": "visible",
  "overflow-y": "visible",
  filter: "none",
  "backdrop-filter": "none",
  transform: "none",
  rotate: "none",
  scale: "none",
  translate: "none",
  "z-index": "auto",
  "outline-style": "none",
  "clip-path": "none",
  "mask-image": "none",
  appearance: "auto",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "justify-content": "normal",
  "align-items": "normal",
  "align-content": "normal",
  "column-gap": "normal",
  "row-gap": "normal",
  order: "0",
  "flex-grow": "0",
  "flex-shrink": "1",
  "flex-basis": "auto",
  "align-self": "auto",
  "grid-template-columns": "none",
  "grid-template-rows": "none",
  "grid-column-start": "auto",
  "grid-column-end": "auto",
  "grid-row-start": "auto",
  "grid-row-end": "auto",
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
  "box-sizing": "content-box",
  width: "auto",
  height: "auto",
};

let nextId = 0;
function el(
  parent: number | null,
  tag: string,
  rect: RawElement["rect"],
  style: Partial<Record<StyleProp, string>> = {},
): RawElement {
  return { kind: "element", id: nextId++, parent, tag, rect, style: { ...defaults, ...style }, attrs: {} };
}

function page(extra: (body: RawElement) => (RawElement | RawText)[]): {
  nodes: (RawElement | RawText)[];
  body: RawElement;
} {
  nextId = 0;
  const html = el(null, "html", { x: 0, y: 0, width: 1440, height: 900 });
  const body = el(html.id, "body", { x: 0, y: 0, width: 1440, height: 900 });
  return { nodes: [html, body, ...extra(body)], body };
}

const bg = (c: string) => ({ "background-color": c });
const snap = (nodes: (RawElement | RawText)[]) => ({
  url: "http://localhost:4400/x",
  title: "X",
  viewport: { width: 1440, height: 900, dpr: 1 },
  documentSize: { width: 1440, height: 900 },
  nodes,
  truncated: false,
});
const box = (id: string, root: BoxNode): BoxNode => {
  const found = [root, ...walk(root)].find((n) => n.type === "box" && n.name === id);
  if (found?.type !== "box") throw new Error(`no box ${id}`);
  return found;
};
const walk = (n: BoxNode): BoxNode[] => n.children.flatMap((c) => (c.type === "box" ? [c, ...walk(c)] : []));
const convert = (nodes: (RawElement | RawText)[]) =>
  snapshotToIR(snap(nodes), { captureId: "c1", maxHeight: 16_000 });

describe("layout engine", () => {
  it("turns a flex row into a verified horizontal stack", () => {
    const { nodes, body } = page((b) => {
      const nav = el(
        b.id,
        "nav",
        { x: 0, y: 0, width: 500, height: 60 },
        {
          ...bg("rgb(1, 1, 1)"),
          display: "flex",
          "flex-direction": "row",
          "justify-content": "flex-start",
          "align-items": "center",
          "column-gap": "32px",
          "padding-left": "40px",
          "padding-right": "40px",
        },
      );
      return [
        nav,
        el(nav.id, "a", { x: 40, y: 21, width: 60, height: 18 }, bg("rgb(2, 2, 2)")),
        el(nav.id, "a", { x: 132, y: 21, width: 60, height: 18 }, bg("rgb(2, 2, 2)")),
        el(nav.id, "a", { x: 224, y: 21, width: 60, height: 18 }, bg("rgb(2, 2, 2)")),
      ];
    });
    void body;
    const { capture, diagnostics } = convert(nodes);
    const nav = box("nav", capture.root);
    expect(nav.layout).toMatchObject({
      mode: "stack",
      direction: "horizontal",
      justify: "start",
      align: "center",
      gap: 32,
    });
    expect(nav.children.map((c) => c.position)).toEqual(["flow", "flow", "flow"]);
    expect(diagnostics.map((d) => d.code)).not.toContain("LAYOUT_ABSOLUTE_FALLBACK");
  });

  it("maps column, reverse, wrap and space-between", () => {
    const { nodes } = page((b) => {
      const col = el(
        b.id,
        "div",
        { x: 0, y: 0, width: 200, height: 220 },
        {
          ...bg("rgb(1, 1, 1)"),
          display: "flex",
          "flex-direction": "column-reverse",
          "row-gap": "10px",
          "padding-top": "10px",
          "padding-bottom": "10px",
        },
      );
      const wrap = el(
        b.id,
        "div",
        { x: 0, y: 300, width: 220, height: 110 },
        {
          ...bg("rgb(1, 1, 1)"),
          display: "flex",
          "flex-wrap": "wrap",
          "column-gap": "10px",
          "row-gap": "10px",
          "padding-left": "10px",
          "padding-right": "10px",
          "padding-top": "10px",
        },
      );
      return [
        col,
        el(col.id, "a", { x: 0, y: 120, width: 200, height: 90 }, bg("rgb(2, 2, 2)")),
        el(col.id, "b", { x: 0, y: 10, width: 200, height: 100 }, bg("rgb(2, 2, 2)")),
        wrap,
        el(wrap.id, "a", { x: 10, y: 310, width: 95, height: 40 }, bg("rgb(2, 2, 2)")),
        el(wrap.id, "b", { x: 115, y: 310, width: 95, height: 40 }, bg("rgb(2, 2, 2)")),
        el(wrap.id, "c", { x: 10, y: 360, width: 95, height: 40 }, bg("rgb(2, 2, 2)")),
      ];
    });
    const { capture } = convert(nodes);
    const col = box("div", capture.root);
    expect(col.layout).toMatchObject({ mode: "stack", direction: "vertical", reverse: true, gap: 10 });
    expect(col.children.map((c) => c.name)).toEqual(["b", "a"]); // visual order
    const wrap = walk(capture.root).find((n) => n.layout.mode === "stack" && n.layout.wrap)!;
    expect(wrap.layout).toMatchObject({ mode: "stack", wrap: true, gap: 10, crossGap: 10 });
  });

  it("recovers space-evenly and block stacking with margins from measurements", () => {
    const { nodes } = page((b) => {
      // space-evenly: equal 20px gaps including the edges; B reads it as start + padding.
      const even = el(
        b.id,
        "div",
        { x: 0, y: 0, width: 340, height: 50 },
        { ...bg("rgb(1, 1, 1)"), display: "flex", "justify-content": "space-evenly" },
      );
      // block flow with margins: margins are inside the measured gaps.
      const stack = el(b.id, "main", { x: 0, y: 100, width: 400, height: 130 }, bg("rgb(1, 1, 1)"));
      return [
        even,
        el(even.id, "a", { x: 20, y: 10, width: 80, height: 30 }, bg("rgb(2, 2, 2)")),
        el(even.id, "b", { x: 120, y: 10, width: 80, height: 30 }, bg("rgb(2, 2, 2)")),
        el(even.id, "c", { x: 220, y: 10, width: 80, height: 30 }, bg("rgb(2, 2, 2)")),
        stack,
        el(
          stack.id,
          "a",
          { x: 0, y: 100, width: 400, height: 40 },
          { ...bg("rgb(2, 2, 2)"), "margin-bottom": "10px" },
        ),
        el(
          stack.id,
          "b",
          { x: 0, y: 150, width: 400, height: 40 },
          { ...bg("rgb(2, 2, 2)"), "margin-bottom": "10px" },
        ),
        el(stack.id, "c", { x: 0, y: 200, width: 400, height: 30 }, bg("rgb(2, 2, 2)")),
      ];
    });
    const { capture, diagnostics } = convert(nodes);
    const even = box("div", capture.root);
    expect(even.layout).toMatchObject({ mode: "stack", direction: "horizontal", gap: 20 });
    const main = box("main", capture.root);
    expect(main.layout).toMatchObject({ mode: "stack", direction: "vertical", gap: 10 });
    expect(diagnostics.map((d) => d.code)).not.toContain("LAYOUT_ABSOLUTE_FALLBACK");
  });

  it("turns an explicit grid into fixed tracks with a cell per child", () => {
    const { nodes } = page((b) => {
      const grid = el(
        b.id,
        "div",
        { x: 0, y: 0, width: 640, height: 230 },
        {
          ...bg("rgb(1, 1, 1)"),
          display: "grid",
          "grid-template-columns": "200px 200px 200px",
          "grid-template-rows": "100px 100px",
          "column-gap": "20px",
          "row-gap": "30px",
        },
      );
      const cells = [0, 1, 2, 3, 4, 5].map((i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        return el(
          grid.id,
          "article",
          { x: col * 220, y: row * 130, width: 200, height: 100 },
          bg("rgb(2, 2, 2)"),
        );
      });
      return [grid, ...cells];
    });
    const { capture } = convert(nodes);
    const grid = box("div", capture.root);
    expect(grid.layout).toMatchObject({
      mode: "grid",
      columns: [{ size: 200 }, { size: 200 }, { size: 200 }],
      rows: [{ size: 100 }, { size: 100 }],
      columnGap: 20,
      rowGap: 30,
    });
    expect(grid.children.map((c) => c.gridCell)).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ]);
  });

  it("keeps absolute children absolute and still stacks the flow", () => {
    const { nodes } = page((b) => {
      const bar = el(
        b.id,
        "header",
        { x: 0, y: 0, width: 400, height: 50 },
        { ...bg("rgb(1, 1, 1)"), display: "flex", "column-gap": "10px", position: "relative" },
      );
      return [
        bar,
        el(bar.id, "a", { x: 0, y: 16, width: 100, height: 18 }, bg("rgb(2, 2, 2)")),
        el(bar.id, "b", { x: 110, y: 16, width: 100, height: 18 }, bg("rgb(2, 2, 2)")),
        el(
          bar.id,
          "badge",
          { x: 350, y: 5, width: 40, height: 20 },
          { ...bg("rgb(3, 3, 3)"), position: "absolute" },
        ),
      ];
    });
    const { capture } = convert(nodes);
    const bar = box("header", capture.root);
    expect(bar.layout).toMatchObject({ mode: "stack" });
    expect(bar.children.map((c) => c.position)).toEqual(["flow", "flow", "absolute"]);
  });

  it("marks flex-grow children as fill and rejects what it cannot verify", () => {
    const { nodes } = page((b) => {
      const row = el(
        b.id,
        "div",
        { x: 0, y: 0, width: 400, height: 50 },
        { ...bg("rgb(1, 1, 1)"), display: "flex", "padding-left": "10px", "padding-right": "10px" },
      );
      // gaps 10 then 15: neither the flex gap (0) nor a constant measured gap verifies.
      const bad = el(
        b.id,
        "section",
        { x: 0, y: 100, width: 400, height: 50 },
        { ...bg("rgb(1, 1, 1)"), display: "flex", "padding-left": "10px" },
      );
      return [
        row,
        el(row.id, "a", { x: 10, y: 0, width: 100, height: 50 }, bg("rgb(2, 2, 2)")),
        el(
          row.id,
          "b",
          { x: 110, y: 0, width: 280, height: 50 },
          { ...bg("rgb(2, 2, 2)"), "flex-grow": "1" },
        ),
        bad,
        el(bad.id, "a", { x: 10, y: 100, width: 100, height: 30 }, bg("rgb(2, 2, 2)")),
        el(bad.id, "b", { x: 120, y: 100, width: 100, height: 30 }, bg("rgb(2, 2, 2)")),
        el(bad.id, "c", { x: 235, y: 100, width: 100, height: 30 }, bg("rgb(2, 2, 2)")),
      ];
    });
    const { capture, diagnostics } = convert(nodes);
    const row = box("div", capture.root);
    const bad = box("section", capture.root);
    expect(row.children[1]?.sizing).toMatchObject({ horizontal: "fill" });
    expect(bad!.layout).toEqual({ mode: "none" });
    expect(bad!.children.map((c) => c.position)).toEqual(["absolute", "absolute", "absolute"]);
    expect(diagnostics.map((d) => d.code)).toContain("LAYOUT_ABSOLUTE_FALLBACK");
  });

  it("stores the verified visual order, not paint order, so Figma reflows identically", () => {
    // Real Hajir case: the drawer comes after main in the DOM but paints left of it.
    const { nodes } = page((b) => {
      const shell = el(
        b.id,
        "div",
        { x: 0, y: 0, width: 1440, height: 900 },
        { ...bg("rgb(1, 1, 1)"), display: "flex" },
      );
      return [
        shell,
        el(shell.id, "main", { x: 83, y: 0, width: 1357, height: 900 }, bg("rgb(2, 2, 2)")),
        el(shell.id, "nav", { x: 0, y: 0, width: 83, height: 900 }, bg("rgb(3, 3, 3)")),
      ];
    });
    const { capture } = convert(nodes);
    const shell = box("div", capture.root);
    expect(shell.layout).toMatchObject({ mode: "stack", direction: "horizontal" });
    // Figma positions Auto Layout children by list order: nav must come first to stay left.
    expect(shell.children.map((c) => c.name)).toEqual(["nav", "main"]);
  });

  it("accepts sub-pixel drift but not a 2px shift", () => {
    const build = (dx: number) => {
      const { nodes } = page((b) => {
        const row = el(
          b.id,
          "div",
          { x: 0, y: 0, width: 320, height: 40 },
          { ...bg("rgb(1, 1, 1)"), display: "flex", "column-gap": "10px", "align-items": "center" },
        );
        return [
          row,
          el(row.id, "a", { x: 0, y: 11, width: 100, height: 18 }, bg("rgb(2, 2, 2)")),
          el(row.id, "b", { x: 110 + dx, y: 11, width: 100, height: 18 }, bg("rgb(2, 2, 2)")),
          el(row.id, "c", { x: 220 + dx, y: 11, width: 100, height: 18 }, bg("rgb(2, 2, 2)")),
        ];
      });
      return convert(nodes);
    };
    const ok = box("div", build(0.9).capture.root);
    expect(ok.layout).toMatchObject({ mode: "stack" });
    const drifted = box("div", build(2).capture.root);
    expect(drifted.layout).toEqual({ mode: "none" });
  });
});
