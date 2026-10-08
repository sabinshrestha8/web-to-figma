import type { Effect, RGBA, Stroke } from "@w2f/ir";
import { parseAngle, parseColor, parseLength, px, round2, round4, splitTop } from "./css.ts";

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];
type Style = (prop: string) => string;

const sameColor = (a: RGBA, b: RGBA) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) + Math.abs(a.a - b.a) < 0.01;

/**
 * Per-side borders → one Figma-style stroke (one color, per-side weights). Figma can't color sides
 * differently, so the widest side's color wins and `mixedColors` is set for a BORDER_COLORS_MIXED.
 */
export function parseBorder(style: Style): { stroke?: Stroke; mixedColors: boolean; approximated?: string } {
  const sides = SIDES.map((side: Side) => {
    const s = style(`border-${side}-style`);
    const width = s === "none" || s === "hidden" ? 0 : (px(style(`border-${side}-width`)) ?? 0);
    const color = parseColor(style(`border-${side}-color`));
    return { side, style: s, width: color ? width : 0, color };
  });
  const visible = sides.filter((s) => s.width > 0 && s.color);
  const main = visible.reduce<(typeof visible)[number] | undefined>(
    (a, b) => (!a || b.width > a.width ? b : a),
    undefined,
  );
  if (!main?.color) return { mixedColors: false };

  const mainColor = main.color;
  const mixedColors = visible.some((s) => s.color && !sameColor(s.color, mainColor));
  const styles = new Set(visible.map((s) => s.style));
  const dash = main.style === "dashed" || main.style === "dotted" ? main.style : "solid";
  const approximated =
    styles.size > 1
      ? "border styles differ per side; one style is used"
      : !/^(solid|dashed|dotted)$/.test(main.style)
        ? `border-style ${main.style} drawn as solid`
        : undefined;
  const weight = (side: Side) => round2(sides.find((s) => s.side === side)?.width ?? 0);
  return {
    stroke: {
      color: mainColor,
      weights: { top: weight("top"), right: weight("right"), bottom: weight("bottom"), left: weight("left") },
      style: dash,
    },
    mixedColors,
    ...(approximated ? { approximated } : {}),
  };
}

const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

/**
 * Corner radii [tl, tr, br, bl] in px, after CSS's overlap scaling (radii that don't fit are scaled
 * down together). Figma corners are circular, so an elliptical corner uses its smaller radius.
 */
export function parseRadius(
  style: Style,
  w: number,
  h: number,
): { radius: [number, number, number, number]; elliptical: boolean } {
  const xy = CORNERS.map((c) => {
    const [a = "0px", b = a] = splitTop(style(`border-${c}-radius`), " ");
    return { x: Math.max(0, parseLength(a, w) ?? 0), y: Math.max(0, parseLength(b, h) ?? 0) };
  });
  const [tl, tr, br, bl] = xy as [(typeof xy)[0], (typeof xy)[0], (typeof xy)[0], (typeof xy)[0]];
  const ratio = (side: number, a: number, b: number) => (a + b > 0 ? side / (a + b) : 1);
  const f = Math.min(
    1,
    ratio(w, tl.x, tr.x),
    ratio(w, bl.x, br.x),
    ratio(h, tl.y, bl.y),
    ratio(h, tr.y, br.y),
  );
  const elliptical = xy.some((c) => Math.abs(c.x - c.y) * f > 0.5 && Math.min(c.x, c.y) > 0);
  const r = (c: { x: number; y: number }) => round2(Math.min(c.x, c.y) * f);
  return { radius: [r(tl), r(tr), r(br), r(bl)], elliptical };
}

const isColor = (t: string) => parseColor(t) !== null || /^(rgba?\(|#|transparent$)/.test(t);

/** One shadow: "[inset] <color> <x> <y> [blur] [spread]" (computed values put the color first). */
function shadow(value: string, allowSpread: boolean): Effect | null {
  const tokens = splitTop(value, " ");
  const inset = tokens.includes("inset");
  const color = parseColor(tokens.find(isColor) ?? "");
  const lengths = tokens.filter((t) => t !== "inset" && !isColor(t)).map((t) => px(t) ?? 0);
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
  if (!color) return null; // transparent shadows (e.g. Tailwind's "0 0 #0000" placeholders) paint nothing
  if (x === 0 && y === 0 && blur === 0 && (spread === 0 || !allowSpread)) return null;
  return {
    type: "shadow",
    inset,
    offset: { x: round2(x), y: round2(y) },
    blur: round2(Math.max(0, blur)),
    spread: allowSpread ? round2(spread) : 0,
    color,
  };
}

/** box-shadow → shadow effects, bottom-most first (CSS lists the top-most shadow first). */
export function parseBoxShadow(value: string, allowSpread = true): Effect[] {
  if (value === "none" || value === "") return [];
  return splitTop(value, ",")
    .map((s) => shadow(s, allowSpread))
    .filter((e): e is Effect => e !== null)
    .reverse();
}

/** text-shadow → shadow effects on the text node: same syntax as box-shadow, minus inset and spread. */
export const parseTextShadow = (value: string): Effect[] => parseBoxShadow(value, false);

/**
 * filter / backdrop-filter. blur(σ) → a Figma blur of radius 2σ (Figma's blur radius is twice the
 * CSS standard deviation). drop-shadow() → a shadow effect. Other functions are returned as unsupported.
 */
export function parseFilter(
  value: string,
  kind: "layer" | "backdrop",
): { effects: Effect[]; unsupported: string[] } {
  const effects: Effect[] = [];
  const unsupported: string[] = [];
  if (value === "none" || value === "") return { effects, unsupported };
  for (const fn of splitTop(value, " ")) {
    const m = /^([a-z-]+)\((.*)\)$/s.exec(fn);
    const name = m?.[1] ?? fn;
    const args = m?.[2] ?? "";
    if (name === "blur") {
      const radius = round2(2 * (px(args) ?? 0));
      if (radius > 0) effects.push({ type: kind === "layer" ? "layer-blur" : "background-blur", radius });
    } else if (name === "drop-shadow" && kind === "layer") {
      const e = shadow(args, false);
      if (e) effects.push(e);
    } else {
      unsupported.push(`${kind === "layer" ? "filter" : "backdrop-filter"} ${name}()`);
    }
  }
  return { effects, unsupported };
}

type Matrix = [number, number, number, number]; // a b c d of a CSS 2D matrix (translation dropped)
const mul = ([a, b, c, d]: Matrix, [e, f, g, h]: Matrix): Matrix => [
  a * e + c * f,
  b * e + d * f,
  a * g + c * h,
  b * g + d * h,
];

/** The `rotate` property: "12deg", "z 12deg" or "0 0 1 12deg" rotate in-plane; any other axis is 3D. */
function rotateProp(value: string): Matrix | null {
  if (value === "none" || value === "") return [1, 0, 0, 1];
  const parts = splitTop(value, " ");
  const angle = parseAngle(parts.at(-1) ?? "");
  const axis = parts.slice(0, -1).join(" ");
  if (angle === null || !(axis === "" || axis === "z" || /^0 0 [\d.]+$/.test(axis))) return null;
  const r = (angle * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)];
}

/** The `scale` property: "1.5", "1.5 2" or "1.5 2 1". */
function scaleProp(value: string): Matrix | null {
  if (value === "none" || value === "") return [1, 0, 0, 1];
  const [x = 1, y = x, z = 1] = splitTop(value, " ").map((v) =>
    v.endsWith("%") ? Number.parseFloat(v) / 100 : Number(v),
  );
  return z === 1 && Number.isFinite(x) && Number.isFinite(y) ? [x, 0, 0, y] : null;
}

/**
 * Computed transform + the individual rotate/scale properties → rotation (degrees clockwise) and
 * scale. CSS applies rotate, then scale, then transform. Scale and translation are already baked
 * into the measured rects; only rotation needs carrying. Skew, mirroring and 3D can't be.
 */
export function parseTransform(
  value: string,
  rotate = "none",
  scale = "none",
): { rotation: number; scaleX: number; scaleY: number; unsupported?: string } {
  const flat = { rotation: 0, scaleX: 1, scaleY: 1, unsupported: "3D transform drawn flat" };
  const m = value === "none" || value === "" ? ["", "1, 0, 0, 1"] : /^matrix\(([^)]*)\)$/.exec(value.trim());
  const r = rotateProp(rotate);
  const s = scaleProp(scale);
  if (!m?.[1] || !r || !s) return flat;
  const [a, b, c, d] = mul(mul(r, s), m[1].split(",").map(Number).slice(0, 4) as Matrix);
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const rotation = round4((Math.atan2(b, a) * 180) / Math.PI);
  const skewed = Math.abs(a * c + b * d) > 1e-3 * scaleX * scaleY;
  const mirrored = a * d - b * c < 0;
  return {
    rotation: Math.abs(rotation) < 0.01 ? 0 : rotation,
    scaleX,
    scaleY,
    ...(skewed
      ? { unsupported: "skew transform" }
      : mirrored
        ? { unsupported: "mirrored (negative scale) transform" }
        : {}),
  };
}
