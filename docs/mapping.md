# Mapping: DOM → IR → Figma

This document is the contract for `packages/capture/collector`, `packages/convert` and `apps/figma-plugin/src/map`. When the web and Figma models differ, the rule is: **don't fake it. Use the closest reliable fallback and emit a diagnostic.**

## 1. Extraction (collector)

**Settle sequence:**
1. `emulateMedia({ reducedMotion: "reduce" })`.
2. `goto` with `waitUntil: "load"`.
3. `document.fonts.ready`.
4. Scroll the full height in viewport steps (triggers lazy loading), then back to the top.
5. Network idle for 500 ms (5 s cap).
   - If the document doesn't scroll but an element covering at least half the viewport does (app shells), the viewport grows by that element's hidden height and the page settles again, up to 3 rounds. Reported as `SCROLL_CONTAINER_EXPANDED`.
6. Two `requestAnimationFrame` ticks.

**Walk.** One pass over the tree. For each element: `getBoundingClientRect()` plus scroll offset, and about 60 whitelisted computed properties (never the full ~300). For each text node: `Range.getClientRects()`, which gives line boxes (line count, wrap width).

**Skips:**
- Subtrees with `display:none`, `visibility:hidden` or `opacity:0`.
- Zero-area elements with no overflow-visible children.
- `script`, `style`, `head`.

**Colors.** Every color passes through a 1×1 canvas in the page (`fillStyle` → `fillRect` → `getImageData`). This turns `oklch()`, `lab()` and `color()` (Tailwind v4 emits oklch) into sRGB with no color library.

**SVG.** Clone the element, then:
- inline the computed `fill`, `stroke` and `color` (resolves `currentColor` and class styles);
- inline `<use>` targets;
- strip `script`, `foreignObject`, `on*` attributes and external hrefs;
- cap the markup at 500 KB.

**Assets.**
- Image response bytes are captured at the network layer (no CORS issue) and keyed by URL.
- They're transcoded to PNG and downscaled to ≤ 4096 px (Figma's `createImage` limit) via canvas in the same Chromium.

**Raster islands.** Some content can't be rebuilt from DOM facts, so it becomes a PNG drawn as an image paint (`scale: "stretch"`) and gets one `RASTERIZED` warning per reason. This covers:
- `img`, `svg` (until Phase 5), `canvas`, `video`, `iframe`, `embed`, `object`;
- native checkboxes and radios (`appearance` ≠ none);
- **leaf** elements with `clip-path`, `mask-image` or `border-image-source`.

How it works:
- `rasterPlan(snapshot)` (pure, in convert) lists the requests. Island descendants and `opacity:0` subtrees are skipped.
- Each island is screenshotted **in isolation**. An injected style hides everything except the island's subtree, makes `html`/`body` transparent, and resets its ancestors' `opacity`/`mix-blend-mode` (the IR applies those again). The screenshot uses `omitBackground`.
- So the PNG holds only the element's own pixels: no siblings drawn over it and no backgrounds under it.
- Failures produce a grey placeholder and `IMAGE_FAILED`. Failure cases: outside the page, larger than 4096 px even at CSS scale, or beyond `maxRasters`.

**Pattern tiles.** A gradient with an explicit `background-size` and `repeat` (for example a dot grid) is rendered once as a tile:
- in a separate browser context with JavaScript disabled and every request aborted;
- with styles set through the DOM API;
- becoming an image paint with `scale: "tile"` and `tileSize`.

**Scale transforms.** Rects are measured after transforms; computed lengths are not. `bakeScale` (run by both `rasterPlan` and `snapshotToIR`) multiplies each element's length styles by its accumulated `transform`/`scale`. Those styles are font, padding, border, radius, shadows, background size/position/gradients and filters. So a 22 px tile inside `scale(.9375)` is drawn at 20.625 px. Non-uniform scale uses the geometric mean and is reported.

**Layer names**, in priority order:
1. `aria-label`
2. `data-testid`
3. `id`
4. React fiber component name (dev builds, best effort)
5. tag plus first class

## 2. CSS → IR

| CSS (computed) | IR | Notes |
|---|---|---|
| rect + scroll offset | `bounds` | Rotated **leaves**: size from `offsetWidth/Height` (scale baked in), centered on the measured rect, `rotation` from `rotate` · `scale` · `transform`. Rotated containers are drawn unrotated. Skew, mirroring and 3D → `UNSUPPORTED_CSS` |
| `background-color`, `background-image` | `fills[]` | CSS lists the top layer first; the IR stores bottom first. Linear and radial gradients map directly; `repeating-*` is approximated; conic and other functions → `UNSUPPORTED_CSS`; `url()` waits for Phase 5 |
| `border-*-width/style/color` | `stroke` | Color of the widest side; mixed colors → `BORDER_COLORS_MIXED`; double/groove/ridge/inset/outset → solid + `UNSUPPORTED_CSS`; `outline` → `UNSUPPORTED_CSS` |
| `border-*-radius` | `radius` | `%` resolved against the box; CSS overlap scaling applied; elliptical → smaller radius + `UNSUPPORTED_CSS` |
| `box-shadow` | `effects[]` drop/inner shadow | Bottom-most first (CSS lists the top shadow first). Transparent or zero shadows are dropped |
| `text-shadow` | — | `UNSUPPORTED_CSS` until Phase 4 |
| `opacity`, `mix-blend-mode` | `opacity`, `blendMode` | |
| `overflow` ≠ visible | `clip: true` | Clipping on one axis only → both axes clip + `UNSUPPORTED_CSS` |
| `filter: blur()`, `backdrop-filter: blur()` | layer-blur, background-blur | Other filters → `UNSUPPORTED_CSS` |
| `z-index`, `position` | child order | Per parent: negative z, then in-flow, then positioned with z auto/0, then positive z. Stable on DOM order. `z-index` counts for positioned elements and flex/grid items |
| `clip-path`, `mask-image`, `border-image` | raster island (leaf) | On an element with children → `UNSUPPORTED_CSS`, drawn without them |
| `position` | `position` | sticky → flow at its scroll-top location |
| `display:flex/grid` + related | `layout` candidate | Must pass verification (§3) |
| font properties | `TextStyle` | One TextNode per inline formatting context. Inline elements with their own box (badge, padded `<code>`) break out as boxes |
| `<img>` + `object-fit/position` | `image` paint | cover→cover, contain→contain, fill→stretch, none→none, scale-down→contain |
| `background-size/repeat/position` | `image` paint | cover/contain/repeat→tile; other sizes → approximated |

## 3. Layout: verify, then fall back

The CSS and Figma layout models are **not** equivalent. They differ on margins (and margin collapsing), `space-around/evenly`, min/max-content, flex-shrink, `order`, percentage sizes, multi-cell grid spans, stacking contexts, and inline formatting. So we never trust a CSS → Auto Layout mapping. We verify it.

Per container, bottom-up:

1. **Flatten.** A box with no fills, stroke, effects or clip, whose single child has identical bounds, is replaced by that child. This removes React wrapper noise.
2. **Candidate A, from CSS intent** (best editing behavior):
   - `flex-direction` → `direction`. `*-reverse` → reversed child order plus `reverse`.
   - `padding` → `padding`; the border is accounted for with `strokesIncludedInLayout`.
   - `column-gap/row-gap` → `gap/crossGap`.
   - `justify-content` start/center/end/space-between → `justify`. Anything else → skip to B.
   - `align-items` → `align`, with stretch → child cross-axis `fill`. `flex-grow > 0` → child main-axis `fill`.
   - A child whose size equals its content size → `hug`; otherwise `fixed`.
3. **Simulate** Figma Auto Layout (padding, gap, alignment, fill distribution, greedy wrap) on the measured child sizes. Every in-flow child within **1 px** of its measured rect → accept.
4. **Candidate B, from measurements.** Covers block flow, margins and space-evenly.
   - Children must be monotonic along one axis with a constant gap (±0.5 px), which gives `gap`.
   - The first child's offset gives `padding`; consistent cross offsets give `align`.
   - Simulate again.
5. **Grid.** Explicit or uniform px tracks with single-cell items → `grid` with fixed tracks (`gridCell` per child). Otherwise try B per row.
6. **Fallback.** `layout: none`; children are absolutely positioned at measured coordinates; `LAYOUT_ABSOLUTE_FALLBACK` with `detail.reason`.
7. **Child order.** Non-positioned first, then positioned by z-index, stable on DOM order. Absolute children inside a stack keep `position: absolute`.

The output is never visually worse than pure absolute positioning, and it's editable wherever that's safe.

## 4. IR → Figma

The functions in `apps/figma-plugin/src/map/*.ts` are pure (IR → plain property objects). `build.ts` only creates nodes and assigns those properties.

| IR | Figma |
|---|---|
| Box with children or a non-`none` layout | `createFrame()`, `clipsContent = clip` |
| Childless box | `createRectangle()` (also for hr/lines) |
| `stack` | `layoutMode` HORIZONTAL/VERTICAL, `itemSpacing`, `counterAxisSpacing`, `layoutWrap`, `padding*`, `primaryAxisAlignItems` MIN/CENTER/MAX/SPACE_BETWEEN, `counterAxisAlignItems` MIN/CENTER/MAX/BASELINE, `strokesIncludedInLayout` |
| `grid` | `layoutMode = "GRID"`, `gridColumnCount/gridRowCount`, `gridColumnSizes/gridRowSizes`, `gridColumnGap/gridRowGap`, `setGridChildPosition` (the API exists; check typings at Phase 6) |
| `sizing` | `layoutSizingHorizontal/Vertical` FIXED/HUG/FILL, set **after** `appendChild` |
| absolute child of a stack | `layoutPositioning = "ABSOLUTE"`, x/y relative to the parent |
| `solid` | `SOLID` with `opacity = a` |
| `linear` / `radial` | `GRADIENT_LINEAR` / `GRADIENT_RADIAL` with `gradientTransform` (formula below) |
| `rotation` | `relativeTransform [[cos, −sin, tx], [sin, cos, ty]]` about the box center |
| `image` | `figma.createImage(bytes).hash`. scaleMode: cover→FILL, contain→FIT, tile→TILE, stretch/none→CROP with `imageTransform` |
| `stroke` | `strokes`, `strokeAlign = INSIDE`, `strokeTop/Right/Bottom/LeftWeight`, `dashPattern` (dashed `[3w, 3w]`, dotted `[w, w]`) |
| `radius` | `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius` |
| effects | DROP_SHADOW / INNER_SHADOW (with `spread`; `radius` = CSS blur radius, 1:1), LAYER_BLUR / BACKGROUND_BLUR (the IR `radius` is already 2 × CSS `blur()` σ, set by the converter). Bottom-most first, like `fills` |
| `image` with `scale: "tile"` | `TILE` with `scalingFactor = tileSize.width / asset pixel width` |
| text | `createText()`. Fonts are loaded up front. Then `characters`, `setRangeFontName/FontSize/Fills/LetterSpacing/LineHeight/TextCase/TextDecoration` per run. `textAutoResize` WIDTH_AND_HEIGHT for one line, else HEIGHT with fixed width |
| vector | `figma.createNodeFromSvg(svg)`. If it throws → raster crop + `SVG_IMPORT_FAILED` |
| blend mode | Same name, uppercased with `_` |

**`gradientTransform`** maps layer space (0–1 on each axis) to gradient space, where the gradient runs along x from 0 to 1. It was checked against the known top→bottom matrix `[[0, 1, 0], [−1, 0, 1]]`.
- **Linear**, for CSS angle θ on a w × h box:
  - `dx = sin θ`, `dy = −cos θ`, `L = w·|dx| + h·|dy|` (the CSS gradient-line length).
  - Row 1 is `[w·dx/L, h·dy/L, 0.5 − (w·dx + h·dy)/(2L)]`.
  - Row 2 is the same for the perpendicular direction.
- **Radial**, with center (cx, cy) and radii (rx, ry) as fractions of the box: `[[1/(2rx), 0, 0.5 − cx/(2rx)], [0, 1/(2ry), 0.5 − cy/(2ry)]]`.

**Strokes** are `INSIDE`, which matches CSS borders. A box that clips its content gets its stroke drawn above the children: in Figma via the frame stroke, and in the preview via the overlay order. That way a clipped header doesn't cover the card's border.

## 5. Typography and fonts

- The plugin resolves each `families` stack against `figma.listAvailableFontsAsync()`, first match wins. Figma ships Google Fonts, so most web fonts resolve.
- Generic families: `system-ui`/`sans-serif`/`-apple-system` → Inter; `serif` → Noto Serif; `monospace` → Roboto Mono.
- Weight → nearest available style name. Names are normalized ("SemiBold" = "Semi Bold"); italic picks an "Italic" style.
- No match → Inter at the nearest weight + `FONT_SUBSTITUTED {from, to}`. The pre-build font report lists every missing family so the user can install it and rebuild.
- `text-transform` → `textCase` (UPPER/LOWER/TITLE). The characters are kept in their original case, so edits behave like CSS.
- **Post-build check:** if a text node's height differs from its IR bounds by more than half a line height → `TEXT_REFLOW`.

## 6. Components

V1 produces visual structure only, not Figma components. The path for later versions is: React fiber name (already captured in `source.component`) → repeated-structure detection → Figma component and instances. The IR can grow that additively (minor version).
