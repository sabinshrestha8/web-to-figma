import type { TextStyle } from "@w2f/ir";

/** CSS generic families → fonts Figma always ships. */
const GENERIC: Record<string, string> = {
  "sans-serif": "Inter",
  "system-ui": "Inter",
  "ui-sans-serif": "Inter",
  "-apple-system": "Inter",
  blinkmacsystemfont: "Inter",
  serif: "Noto Serif",
  "ui-serif": "Noto Serif",
  monospace: "Roboto Mono",
  "ui-monospace": "Roboto Mono",
};
const FALLBACK = "Inter";

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  "": 400,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** "Semi Bold Italic" → { weight: 600, italic: true }; unknown style names → null. */
export function parseStyleName(style: string): { weight: number; italic: boolean } | null {
  const s = style.toLowerCase().replace(/[\s_-]/g, "");
  const italic = /italic|oblique/.test(s);
  const weight = WEIGHTS[s.replace(/italic|oblique/, "")];
  return weight === undefined ? null : { weight, italic };
}

export interface ResolvedFont {
  font: FontName;
  /** Set when the font differs from what the browser was asked for. */
  substitutedFrom?: string;
}

/** Index of family (lower-cased) → available styles, built once from listAvailableFontsAsync(). */
export type FontIndex = Map<string, { family: string; style: string; weight: number; italic: boolean }[]>;

export function indexFonts(available: readonly { fontName: FontName }[]): FontIndex {
  const index: FontIndex = new Map();
  for (const { fontName } of available) {
    const parsed = parseStyleName(fontName.style);
    if (!parsed) continue;
    const key = fontName.family.toLowerCase();
    const list = index.get(key) ?? [];
    list.push({ ...fontName, ...parsed });
    index.set(key, list);
  }
  return index;
}

/** First family in the CSS stack that Figma has, at the nearest weight; generics map to shipped fonts. */
export function resolveFont(
  style: Pick<TextStyle, "families" | "weight" | "italic">,
  index: FontIndex,
): ResolvedFont {
  const stack = [...style.families, FALLBACK];
  for (const requested of stack) {
    const family = GENERIC[requested.toLowerCase()] ?? requested;
    const styles = index.get(family.toLowerCase());
    if (!styles?.length) continue;
    const score = (s: { weight: number; italic: boolean }) =>
      Math.abs(s.weight - style.weight) + (s.italic === style.italic ? 0 : 1000);
    const best = styles.reduce((a, b) => (score(b) < score(a) ? b : a));
    const font = { family: best.family, style: best.style };
    const exact = requested === style.families[0] && family === requested && score(best) === 0;
    return exact ? { font } : { font, substitutedFrom: describe(style) };
  }
  // Figma always ships Inter; reaching here means the font list itself was empty.
  return { font: { family: FALLBACK, style: "Regular" }, substitutedFrom: describe(style) };
}

const describe = (s: Pick<TextStyle, "families" | "weight" | "italic">) =>
  `${s.families[0] ?? "?"} ${s.weight}${s.italic ? " italic" : ""}`;

export const fontKey = (f: FontName) => `${f.family}\u0000${f.style}`;

type FontStyle = Pick<TextStyle, "families" | "weight" | "italic">;

export const styleKey = (s: FontStyle) => `${s.families.join(",")}|${s.weight}|${s.italic}`;

/** One line of the pre-build font report: what the page asked for and what Figma will use. */
export interface FontReportEntry {
  requested: string;
  font: string;
  substituted: boolean;
  /** Text runs using it. */
  runs: number;
}

/**
 * Resolve every distinct text style once: the fonts to load (by style key) and the report the user
 * sees before building, substitutions first so missing fonts can be installed and the build rerun.
 */
export function planFonts(
  styles: Iterable<FontStyle>,
  index: FontIndex,
): { fonts: Map<string, FontName>; report: FontReportEntry[] } {
  const fonts = new Map<string, FontName>();
  const entries = new Map<string, FontReportEntry>();
  for (const style of styles) {
    const key = styleKey(style);
    const known = entries.get(key);
    if (known) {
      known.runs++;
      continue;
    }
    const { font, substitutedFrom } = resolveFont(style, index);
    fonts.set(key, font);
    entries.set(key, {
      requested: describe(style),
      font: `${font.family} ${font.style}`,
      substituted: substitutedFrom !== undefined,
      runs: 1,
    });
  }
  const report = [...entries.values()].sort(
    (a, b) => Number(b.substituted) - Number(a.substituted) || b.runs - a.runs,
  );
  return { fonts, report };
}
