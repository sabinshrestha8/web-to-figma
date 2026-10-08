import type { Effect as IREffect, Node, Rect, Stroke } from "@w2f/ir";
import { solid } from "./paint.ts";

/** IR blend modes are the CSS names; Figma's are the same words in upper snake case. */
export const blendMode = (mode: Node["blendMode"]): BlendMode =>
  mode.toUpperCase().replace(/-/g, "_") as BlendMode;

/** IR effects (bottom-most first) → Figma effects, in the same order. */
export function effects(list: readonly IREffect[]): Effect[] {
  return list.map((e): Effect => {
    if (e.type === "shadow") {
      return {
        type: e.inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color: { ...e.color },
        offset: { ...e.offset },
        radius: e.blur, // Figma's shadow blur is the CSS box-shadow blur radius
        spread: e.spread,
        visible: true,
        blendMode: "NORMAL",
        ...(e.inset ? {} : { showShadowBehindNode: false }),
      } as DropShadowEffect | InnerShadowEffect;
    }
    return {
      type: e.type === "layer-blur" ? "LAYER_BLUR" : "BACKGROUND_BLUR",
      blurType: "NORMAL",
      radius: e.radius,
      visible: true,
    };
  });
}

/** CSS borders sit inside the border box, so strokes are INSIDE. Dash lengths follow Chromium (3× width dashes). */
export function strokeProps(s: Stroke) {
  const { top, right, bottom, left } = s.weights;
  const width = Math.max(top, right, bottom, left);
  return {
    strokes: [solid(s.color)],
    strokeAlign: "INSIDE" as const,
    weights: {
      strokeTopWeight: top,
      strokeRightWeight: right,
      strokeBottomWeight: bottom,
      strokeLeftWeight: left,
    },
    uniform: top === right && right === bottom && bottom === left ? width : null,
    dashPattern: s.style === "dashed" ? [3 * width, 3 * width] : s.style === "dotted" ? [width, width] : [],
  };
}

/**
 * Rotation in IR is degrees clockwise around the box center (CSS). Figma's relativeTransform maps
 * node space to parent space; x' = cos·x − sin·y + tx rotates clockwise on a y-down canvas, and
 * tx/ty keep the center where the browser had it.
 */
export function rotatedTransform(degrees: number, box: Rect): Transform {
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return [
    [cos, -sin, cx - (cos * box.width) / 2 + (sin * box.height) / 2],
    [sin, cos, cy - (sin * box.width) / 2 - (cos * box.height) / 2],
  ];
}
