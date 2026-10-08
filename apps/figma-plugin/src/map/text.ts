import type { TextNode as IRText, TextStyle } from "@w2f/ir";

const CASE: Record<TextStyle["transform"], TextCase> = {
  none: "ORIGINAL",
  uppercase: "UPPER",
  lowercase: "LOWER",
  capitalize: "TITLE",
};
const DECORATION: Record<TextStyle["decoration"], TextDecoration> = {
  none: "NONE",
  underline: "UNDERLINE",
  "line-through": "STRIKETHROUGH",
};
const ALIGN: Record<IRText["align"], TextNode["textAlignHorizontal"]> = {
  left: "LEFT",
  center: "CENTER",
  right: "RIGHT",
  justify: "JUSTIFIED",
};

/** Range-level text properties for one style run (font is resolved separately). */
export function runProps(s: TextStyle) {
  return {
    fontSize: s.size,
    lineHeight:
      s.lineHeight === "auto"
        ? ({ unit: "AUTO" } as const)
        : ({ unit: "PIXELS", value: s.lineHeight } as const),
    letterSpacing: { unit: "PIXELS", value: s.letterSpacing } as const,
    textCase: CASE[s.transform],
    textDecoration: DECORATION[s.decoration],
  };
}

export function nodeProps(t: IRText) {
  return {
    textAlignHorizontal: ALIGN[t.align],
    textAutoResize: t.autoResize === "height" ? ("HEIGHT" as const) : ("WIDTH_AND_HEIGHT" as const),
  };
}
