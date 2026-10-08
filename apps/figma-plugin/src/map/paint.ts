import type { Paint as IRPaint, RGBA } from "@w2f/ir";

export const solid = (c: RGBA): SolidPaint => ({
  type: "SOLID",
  color: { r: c.r, g: c.g, b: c.b },
  opacity: c.a,
});

const SCALE: Record<Extract<IRPaint, { type: "image" }>["scale"], ImagePaint["scaleMode"]> = {
  cover: "FILL",
  contain: "FIT",
  stretch: "CROP", // with the identity imageTransform: the image spans the layer, unevenly scaled
  tile: "TILE",
  none: "CROP",
};

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0; // + 0 turns -0 into 0

/**
 * CSS linear-gradient angle on a w×h box → Figma gradientTransform.
 * The transform maps layer space (0–1 on both axes) to gradient space, where the gradient runs
 * along x from 0 to 1; identity is a left→right gradient. CSS measures the angle clockwise from
 * "to top", and the gradient line is long enough that the corners reach 0% and 100% exactly:
 * L = w·|sin θ| + h·|cos θ|. Row 1 projects a point onto that line; row 2 is the perpendicular.
 */
export function linearTransform(angle: number, w: number, h: number): Transform {
  const t = (angle * Math.PI) / 180;
  const dx = Math.sin(t);
  const dy = -Math.cos(t);
  const len = w * Math.abs(dx) + h * Math.abs(dy) || 1;
  const perp = w * Math.abs(dy) + h * Math.abs(dx) || 1;
  return [
    [round((w * dx) / len), round((h * dy) / len), round(0.5 - (w * dx + h * dy) / (2 * len))],
    [round((-w * dy) / perp), round((h * dx) / perp), round(0.5 - (-w * dy + h * dx) / (2 * perp))],
  ];
}

/** Radial gradient (center and radii as box fractions) → gradientTransform; Figma's ellipse is centered at 0.5 with radius 0.5. */
export function radialTransform(
  center: { x: number; y: number },
  radius: { x: number; y: number },
): Transform {
  return [
    [round(1 / (2 * radius.x)), 0, round(0.5 - center.x / (2 * radius.x))],
    [0, round(1 / (2 * radius.y)), round(0.5 - center.y / (2 * radius.y))],
  ];
}

/**
 * The visible part of the image (fractions) → CROP imageTransform, which maps layer space (0–1) to
 * image space (0–1): the layer's corner (0,0) shows image point (x,y), its far corner (x+w, y+h).
 */
export function cropTransform(crop?: { x: number; y: number; width: number; height: number }): Transform {
  const c = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return [
    [round(c.width), 0, round(c.x)],
    [0, round(c.height), round(c.y)],
  ];
}

export interface PaintEnv {
  /** Box size in px; gradients depend on its aspect ratio. */
  width: number;
  height: number;
  imageHash: (assetId: string) => string;
  /** Pixel width of an asset, to scale tiles (a 2× tile is drawn at half size). */
  imageWidth: (assetId: string) => number;
}

/**
 * IR paints → Figma paints (IR is bottom-most first, as is Figma). Paints that cannot be built are
 * returned in `skipped` so the caller reports them instead of dropping them silently.
 */
export function paints(fills: readonly IRPaint[], env: PaintEnv): { paints: Paint[]; skipped: string[] } {
  const out: Paint[] = [];
  const skipped: string[] = [];
  for (const p of fills) {
    if (p.type === "solid") out.push(solid(p.color));
    else if (p.type === "linear") {
      out.push({
        type: "GRADIENT_LINEAR",
        gradientTransform: linearTransform(p.angle, env.width, env.height),
        gradientStops: p.stops.map((s) => ({ position: s.position, color: { ...s.color } })),
      });
    } else if (p.type === "radial") {
      if (p.radius.x <= 0 || p.radius.y <= 0) {
        skipped.push("zero-size radial gradient");
        continue;
      }
      out.push({
        type: "GRADIENT_RADIAL",
        gradientTransform: radialTransform(p.center, p.radius),
        gradientStops: p.stops.map((s) => ({ position: s.position, color: { ...s.color } })),
      });
    } else {
      const image: ImagePaint = {
        type: "IMAGE",
        imageHash: env.imageHash(p.assetId),
        scaleMode: SCALE[p.scale],
      };
      const px = env.imageWidth(p.assetId);
      if (p.crop || p.scale === "stretch")
        out.push({ ...image, scaleMode: "CROP", imageTransform: cropTransform(p.crop) });
      else if (p.scale === "tile" && p.tileSize && px > 0)
        out.push({ ...image, scalingFactor: round(p.tileSize.width / px) });
      else out.push(image);
    }
  }
  return { paints: out, skipped };
}
