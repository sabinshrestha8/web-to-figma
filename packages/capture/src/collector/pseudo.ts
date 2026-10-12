/**
 * Whether a ::before/::after pseudo-element paints something the DOM walker can't see
 * (pseudo boxes have no DOM node, so geometry needs CDP — a V1.1 item). Conservative:
 * only content that actually paints counts, so clearfixes and hidden pseudos stay quiet.
 * `get` reads the pseudo's computed style; `background-color` must already be normalized
 * to rgba() (the caller does that, like COLOR_PROPS).
 */
export function paintsPseudo(get: (prop: string) => string): boolean {
  if (get("display") === "none" || get("visibility") === "hidden" || get("opacity") === "0") return false;
  const content = get("content");
  const inner = content.startsWith('"') && content.length >= 2 ? content.slice(1, -1) : content;
  // A text/counter/image glyph paints, even with no box paint.
  if (inner !== "" && content !== "none" && content !== "normal") return true;
  const bg = get("background-color");
  if (bg !== "" && bg !== "transparent" && !bg.endsWith(", 0)")) return true;
  for (const side of ["top", "right", "bottom", "left"]) {
    const w = get(`border-${side}-width`);
    if (w !== "" && w !== "0px" && get(`border-${side}-style`) !== "none") return true;
  }
  return false;
}
