import { describe, expect, it } from "vitest";
import { paintsPseudo } from "./pseudo.ts";

const style = (o: Record<string, string>) => (p: string) => o[p] ?? "";
const base = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  content: "none",
  "background-color": "rgba(0, 0, 0, 0)",
  "border-top-width": "0px",
  "border-top-style": "none",
  "border-right-width": "0px",
  "border-right-style": "none",
  "border-bottom-width": "0px",
  "border-bottom-style": "none",
  "border-left-width": "0px",
  "border-left-style": "none",
};

describe("paintsPseudo", () => {
  it("ignores absent, hidden and empty pseudos", () => {
    expect(paintsPseudo(style(base))).toBe(false);
    expect(paintsPseudo(style({ ...base, content: "normal" }))).toBe(false);
  });

  it("ignores the classic clearfix (empty content, no paint)", () => {
    expect(paintsPseudo(style({ ...base, content: '""' }))).toBe(false);
    expect(paintsPseudo(style({ ...base, display: "none", content: '"x"' }))).toBe(false);
    expect(paintsPseudo(style({ ...base, visibility: "hidden", content: '"x"' }))).toBe(false);
  });

  it("flags text glyphs, painted hairlines and bordered badges", () => {
    expect(paintsPseudo(style({ ...base, content: '"★"' }))).toBe(true);
    expect(paintsPseudo(style({ ...base, content: "counter(n)" }))).toBe(true);
    expect(paintsPseudo(style({ ...base, content: '""', "background-color": "rgba(37, 99, 235, 1)" }))).toBe(
      true,
    );
    expect(
      paintsPseudo(style({ ...base, content: '""', "border-top-width": "1px", "border-top-style": "solid" })),
    ).toBe(true);
  });
});
