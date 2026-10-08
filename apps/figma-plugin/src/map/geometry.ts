import type { Rect } from "@w2f/ir";

/** Figma rejects sizes below 0.01. */
const MIN = 0.01;

/** IR bounds are absolute page coordinates; Figma wants position relative to the parent frame. */
export function relative(bounds: Rect, parent: Rect): Rect {
  return {
    x: bounds.x - parent.x,
    y: bounds.y - parent.y,
    width: Math.max(bounds.width, MIN),
    height: Math.max(bounds.height, MIN),
  };
}
