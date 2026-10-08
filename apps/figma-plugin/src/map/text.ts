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

/**
 * TEXT_REFLOW: Figma wrapped the text into a different number of lines than the browser did — its
 * height differs from the IR's by more than half a line (font metrics, kerning, a substituted font).
 */
export function reflowed(t: IRText, figmaHeight: number): boolean {
  const s = t.runs[0]?.style;
  if (!s) return false;
  const line = s.lineHeight === "auto" ? s.size * 1.2 : s.lineHeight;
  return Math.abs(figmaHeight - t.bounds.height) > line / 2;
}
