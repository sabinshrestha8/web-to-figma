import type { Paint, RGBA } from "@w2f/ir";
import { parseAngle, parseColor, parseLength, round4, splitTop } from "./css.ts";

/** One CSS background layer, interpreted. Layers come top-most first, as CSS lists them. */
export type BackgroundLayer =
  | { kind: "paint"; paint: Paint; approximated?: string }
  | { kind: "tile"; css: string; width: number; height: number; approximated?: string }
  /** An image layer, placed once its intrinsic size is known (see images.ts). */
  | { kind: "url"; url: string; size: string; position: string; repeat: string }
  | { kind: "unsupported"; reason: string };

type Stop = { position: number; color: RGBA };

const isColorToken = (t: string) => /^(rgba?\(|#|transparent$)/.test(t) || parseColor(t) !== null;

/**
 * Color stops along a gradient line of `length` px. Missing positions are fixed up as the CSS
 * spec does (first 0, last 1, gaps spread evenly, never decreasing). Stops outside 0–1 are clamped
 * (Figma requires 0–1), which is reported as an approximation.
 */
export function parseStops(parts: string[], length: number): { stops: Stop[]; clamped: boolean } | null {
  const raw: { color: RGBA; position: number | null }[] = [];
  for (const part of parts) {
    const tokens = splitTop(part, " ");
    const colorToken = tokens.find(isColorToken);
    if (!colorToken) continue; // color hint (a lone length): ignored, the transition stays linear
    const color = parseColor(colorToken) ?? { r: 0, g: 0, b: 0, a: 0 };
    const positions = tokens
      .filter((t) => t !== colorToken)
      .map((t) => parseLength(t, length))
      .map((p) => (p === null ? null : p / length));
    if (positions.length === 0) raw.push({ color, position: null });
    for (const p of positions) raw.push({ color, position: p });
  }
  if (raw.length < 2) return null;

  const first = raw[0];
  const last = raw.at(-1);
  if (first && first.position === null) first.position = 0;
  if (last && last.position === null) last.position = 1;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of raw) {
    if (s.position !== null) {
      s.position = Math.max(s.position, max);
      max = s.position;
    }
  }
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]?.position !== null) continue;
    let j = i;
    while (raw[j]?.position === null) j++;
    const from = raw[i - 1]?.position ?? 0;
    const to = raw[j]?.position ?? 1;
    for (let k = i; k < j; k++) {
      const s = raw[k];
      if (s) s.position = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  let clamped = false;
  const stops = raw.map((s) => {
    const p = s.position ?? 0;
    if (p < 0 || p > 1) clamped = true;
    return { color: s.color, position: round4(Math.min(1, Math.max(0, p))) };
  });
  return { stops, clamped };
}

/** "to top right" → CSS angle for a w×h box (the gradient line points at that corner's quadrant). */
function directionAngle(words: string[], w: number, h: number): number | null {
  const sx = words.includes("right") ? 1 : words.includes("left") ? -1 : 0;
  const sy = words.includes("bottom") ? 1 : words.includes("top") ? -1 : 0;
  if (sx === 0 && sy === 0) return null;
  if (sx === 0) return sy > 0 ? 180 : 0;
  if (sy === 0) return sx > 0 ? 90 : 270;
  // Corner: the gradient line is perpendicular to the diagonal joining the two other corners.
  const deg = (Math.atan2(sx * h, -sy * w) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Strips a trailing color-interpolation clause ("in oklab", "in oklch longer hue"). */
const withoutInterpolation = (s: string) =>
  s.replace(/\s*\bin\s+[a-z-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/, "").trim();

export function parseLinear(args: string, w: number, h: number): { paint: Paint; clamped: boolean } | null {
  const parts = splitTop(args, ",");
  let angle = 180;
  const head = parts[0] ? withoutInterpolation(parts[0]) : "";
  const headTokens = splitTop(head, " ");
  const asAngle = headTokens.length === 1 && headTokens[0] ? parseAngle(headTokens[0]) : null;
  const asDirection = headTokens[0] === "to" ? directionAngle(headTokens.slice(1), w, h) : null;
  if (asAngle !== null || asDirection !== null || head === "") {
    angle = asAngle ?? asDirection ?? 180;
    parts.shift();
  }
  const rad = (angle * Math.PI) / 180;
  const length = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)) || 1;
  const parsed = parseStops(parts, length);
  if (!parsed) return null;
  return { paint: { type: "linear", angle: round4(angle), stops: parsed.stops }, clamped: parsed.clamped };
}

const KEYWORD_POS: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };

/** "at 30% 10px" / "at top left" → center in px. */
function parsePosition(tokens: string[], w: number, h: number): { x: number; y: number } {
  let [a = "center", b = "center"] = tokens;
  if (a === "top" || a === "bottom" || b === "left" || b === "right") [a, b] = [b, a];
  const axis = (t: string, size: number) => {
    const k = KEYWORD_POS[t];
    return k !== undefined ? k * size : (parseLength(t, size) ?? size / 2);
  };
  return { x: axis(a, w), y: axis(b, h) };
}

export function parseRadial(args: string, w: number, h: number): { paint: Paint; clamped: boolean } | null {
  const parts = splitTop(args, ",");
  const first = parts[0] ? withoutInterpolation(parts[0]) : "";
  const firstTokens = splitTop(first, " ");
  const hasConfig = first === "" || !firstTokens.some(isColorToken);
  if (hasConfig) parts.shift();

  const atIndex = hasConfig ? firstTokens.indexOf("at") : -1;
  const shapeTokens = hasConfig ? (atIndex >= 0 ? firstTokens.slice(0, atIndex) : firstTokens) : [];
  const center = parsePosition(atIndex >= 0 ? firstTokens.slice(atIndex + 1) : [], w, h);
  const circle =
    shapeTokens.includes("circle") ||
    (!shapeTokens.includes("ellipse") && shapeTokens.filter((t) => parseLength(t, w) !== null).length === 1);

  const sides = { x: [center.x, w - center.x], y: [center.y, h - center.y] };
  const extent = shapeTokens.find((t) => /^(closest|farthest)-(side|corner)$/.test(t)) ?? "farthest-corner";
  const pick = extent.startsWith("closest") ? Math.min : Math.max;
  const lengths = shapeTokens.filter((t) => t !== "circle" && t !== "ellipse" && t !== extent);

  let rx: number;
  let ry: number;
  if (lengths.length > 0) {
    rx = parseLength(lengths[0] ?? "", w) ?? w / 2;
    ry = circle ? rx : (parseLength(lengths[1] ?? "", h) ?? rx);
  } else if (circle) {
    const corners = sides.x.flatMap((dx) => sides.y.map((dy) => Math.hypot(dx, dy)));
    rx = ry = extent.endsWith("corner") ? pick(...corners) : pick(...sides.x, ...sides.y);
  } else {
    const k = extent.endsWith("corner") ? Math.SQRT2 : 1;
    rx = pick(...sides.x) * k;
    ry = pick(...sides.y) * k;
  }
  const parsed = parseStops(parts, rx || 1);
  if (!parsed) return null;
  return {
    paint: {
      type: "radial",
      center: { x: round4(clamp01(center.x / (w || 1))), y: round4(clamp01(center.y / (h || 1))) },
      radius: { x: round4(rx / (w || 1)), y: round4(ry / (h || 1)) },
      stops: parsed.stops,
    },
    clamped: parsed.clamped,
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Value for layer `i` of a comma list that repeats to match the layer count, as CSS does. */
const cycle = (list: string[], i: number) => list[i % list.length] ?? "";

/** background-image (+ size/repeat/position) → layers, top-most first. `w`/`h` is the border box. */
export function backgroundLayers(
  style: { image: string; size: string; repeat: string; position: string },
  w: number,
  h: number,
): BackgroundLayer[] {
  if (style.image === "none" || style.image === "") return [];
  const sizes = splitTop(style.size, ",");
  const repeats = splitTop(style.repeat, ",");
  const positions = splitTop(style.position, ",");

  return splitTop(style.image, ",").map((layer, i): BackgroundLayer => {
    const m = /^([a-z-]+)\((.*)\)$/s.exec(layer.trim());
    const fn = m?.[1] ?? "";
    const args = m?.[2] ?? "";
    if (fn === "url") {
      const url = /^(["']?)(.*)\1$/s.exec(args.trim())?.[2] ?? "";
      return {
        kind: "url",
        url,
        size: cycle(sizes, i),
        position: cycle(positions, i),
        repeat: cycle(repeats, i),
      };
    }
    if (!/^(repeating-)?(linear|radial)-gradient$/.test(fn)) {
      return { kind: "unsupported", reason: `background-image ${fn || layer}()` };
    }

    // Gradients have no intrinsic size: "auto", "cover" and "contain" all mean the whole box.
    const sizeValue = cycle(sizes, i);
    const [sw = "auto", sh = "auto"] = /^(cover|contain)$/.test(sizeValue) ? [] : splitTop(sizeValue, " ");
    const tileW = sw === "auto" ? w : parseLength(sw, w);
    const tileH = sh === "auto" ? h : parseLength(sh, h);
    const isFull = tileW !== null && tileH !== null && Math.abs(tileW - w) < 0.5 && Math.abs(tileH - h) < 0.5;
    const repeat = cycle(repeats, i);
    const offset = cycle(positions, i);
    const atOrigin = /^0(px|%)? 0(px|%)?$/.test(offset.trim()) || offset === "";

    if (!isFull) {
      if (tileW && tileH && !/no-repeat/.test(repeat)) {
        return {
          kind: "tile",
          css: layer,
          width: tileW,
          height: tileH,
          ...(atOrigin ? {} : { approximated: "background-position offset on a tiled pattern is ignored" }),
        };
      }
      return { kind: "unsupported", reason: `gradient with background-size "${sizeValue}"` };
    }

    const repeating = fn.startsWith("repeating-");
    const parsed = fn.endsWith("linear-gradient") ? parseLinear(args, w, h) : parseRadial(args, w, h);
    if (!parsed) return { kind: "unsupported", reason: `unparseable ${fn}` };
    const approximated = repeating
      ? `${fn} drawn as a single repetition`
      : parsed.clamped
        ? "gradient stops outside the box are clamped"
        : undefined;
    return { kind: "paint", paint: parsed.paint, ...(approximated ? { approximated } : {}) };
  });
}
