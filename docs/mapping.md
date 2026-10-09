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

**Walk.** One pass over the tree. For each element: `getBoundingClientRect()` plus scroll offset, and about 60 whitelisted computed properties (never the full ~300). For each text node: `Range.getClientRects()`, which gives line boxes (line count, wrap width). Text is white-space-collapsed but **not trimmed**, so the converter knows whether a space separates it from its inline neighbors. A whitespace-only node between two inline siblings is kept even without a rect: Chrome gives the space where a line wraps no rect, but it still separates the words around it.

**Skips:**
- Subtrees with `display:none`, `visibility:hidden` or `opacity:0`.
- Zero-area elements with no overflow-visible children.
- `script`, `style`, `head`.

**Colors.** Every color passes through a 1×1 canvas in the page (`fillStyle` → `fillRect` → `getImageData`). This turns `oklch()`, `lab()` and `color()` (Tailwind v4 emits oklch) into sRGB with no color library.

**SVG** (`collector/svg.ts`). Each inline `<svg>` is serialized to standalone markup that needs nothing from the page:
- Computed paint is written as presentation attributes: `color`, `fill`, `stroke` (+ width, opacity, linecap/linejoin, dasharray/offset, miterlimit), `fill-rule`, `clip-rule`, `visibility`, font properties, and `opacity`/`stop-color`/`stop-opacity`. Inherited ones only where they differ from the parent. This resolves classes, `currentColor` and Tailwind's oklch colors (normalized to rgba); lengths lose their `px`; `url(http://page/#id)` becomes `url(#id)`. The root's `opacity` goes to the vector node instead.
- Geometry set from CSS (SVG 2 `x`/`y`/`width`/`height`/`rx`/`ry`, `cx`/`cy`/`r`, `d`) is copied back as attributes from computed style: MUI X Charts draws every bar as `<rect style="x:…">`, which would otherwise lose its size with the `style` attribute.
- Shapes hidden with `display:none` are removed.
- `<use href="#id">` is inlined (3 levels): a `<symbol>` becomes a nested `<svg>` with its viewBox, sized to the `<use>` or the root's user space; anything else is cloned into a `<g>` with the `x`/`y` translate. Targets may live in another svg (sprite sheets). Copied sprite content keeps its inline `style` paint as attributes (its classes are lost), and any `currentColor` left is replaced by the color in scope.
- Removed: `script`, `foreignObject`, `style`, `iframe`, `animate*`/`set`, unresolved `use`; every `on*`, `class` and `style` attribute; every `href` that isn't `#…` or a `data:image/(png|jpeg|gif|webp)` URL; every other attribute holding a non-fragment `url()`.
- `width`/`height` are set to the rendered size. Over 500 KB → no markup, and the svg becomes a raster island.

**Images.**
- `<img>`: the collector records `currentSrc` (so `srcset`/`<picture>`/next/image resolve to what the browser chose), `naturalWidth/Height` and a state: loaded, failed (complete with no size: 404, undecodable) or pending (still loading).
- `imagePlan(snapshot)` (pure, in convert) lists what to decode: loaded `<img>` sources, `url()` background layers, and one fallback PNG per inline svg, each with the largest size it's drawn at.
- Bytes come from the **network guard**: every image response the page loads is kept by URL (≤ 10 MB each, ≤ 100 MB per capture). `data:` URLs are decoded in Node. Nothing is fetched a second time.
- `decodeImages` (`capture/src/images.ts`) sniffs the format from the bytes (not the server's Content-Type) and decodes each image in a blank page of a **separate browser context with every request aborted**, via `Image.decode()` on a blob URL, 10 s per image.
  - PNG/JPEG/GIF within 4096 px a side pass through byte for byte.
  - WebP/AVIF/BMP/ICO and oversize images are redrawn on a canvas, downscaled to ≤ 4096 px a side: JPEG (0.92) when fully opaque, else PNG.
  - SVG (as `<img>`, as a background, or an inline svg's fallback) is rendered at its drawn size × dpr, as PNG.
  - Over 50 MP decoded, unrecognized, or undecodable → `ASSET_REJECTED`.

**Raster islands.** Some content can't be rebuilt from DOM facts, so it becomes a PNG drawn as an image paint (`scale: "stretch"`) and gets one `RASTERIZED` warning per reason. This covers:
- `canvas`, `video`, `iframe`, `embed`, `object`;
- `img` only while still loading or when its image couldn't be decoded; `svg` only when its markup is over 500 KB;
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
| `background-color`, `background-image` | `fills[]` | CSS lists the top layer first; the IR stores bottom first. Linear and radial gradients map directly; `repeating-*` is approximated; conic and other functions → `UNSUPPORTED_CSS`; `url()` → image paint (below) |
| `border-*-width/style/color` | `stroke` | Color of the widest side; mixed colors → `BORDER_COLORS_MIXED`; double/groove/ridge/inset/outset → solid + `UNSUPPORTED_CSS`; `outline` → `UNSUPPORTED_CSS` |
| `border-*-radius` | `radius` | `%` resolved against the box; CSS overlap scaling applied; elliptical → smaller radius + `UNSUPPORTED_CSS` |
| `box-shadow` | `effects[]` drop/inner shadow | Bottom-most first (CSS lists the top shadow first). Transparent or zero shadows are dropped |
| `text-shadow` | text node `effects[]` drop shadows | Same parser as box-shadow, without inset/spread. An inline element with a different text-shadow keeps its own text node |
| `opacity`, `mix-blend-mode` | `opacity`, `blendMode` | |
| `overflow` ≠ visible | `clip: true` | Clipping on one axis only → both axes clip + `UNSUPPORTED_CSS` |
| `filter: blur()`, `backdrop-filter: blur()` | layer-blur, background-blur | Other filters → `UNSUPPORTED_CSS` |
| `z-index`, `position` | child order | Per parent: negative z, then in-flow, then positioned with z auto/0, then positive z. Stable on DOM order. `z-index` counts for positioned elements and flex/grid items |
| `clip-path`, `mask-image`, `border-image` | raster island (leaf) | On an element with children → `UNSUPPORTED_CSS`, drawn without them |
| `position` | `position` | sticky → flow at its scroll-top location |
| `display:flex/grid` + related | `layout` candidate | Must pass verification (§3) |
| font properties | `TextStyle` per run | One TextNode per run of inline content (§5). Inline elements with their own box (badge, padded `<code>`) break out as boxes |
| `text-decoration-line` | `TextStyle.decoration` | Propagated to descendants (an underlined `<a>` underlines its `<strong>`), not into inline-blocks or out-of-flow boxes. Underline wins over line-through; overline and decoration color/thickness/style are dropped |
| `<img>` + `object-fit/position` | `image` paint over the element's own background | See **Image placement** below. A failed image → grey placeholder + `IMAGE_FAILED`. Padding on an `<img>` is drawn over (approximated) |
| `url()` background + `background-size/position/repeat` | `image` paint | Same placement. Repeating with a tile smaller than the box → `tile` with `tileSize` (from the corner; an offset or `repeat-x/y/space/round` is approximated). An image the capture didn't get → `IMAGE_FAILED`, layer skipped |
| inline `<svg>` | `VectorNode` (`svg` + `fallback` PNG) | Opacity, blend, shadows and filters from the element; a background or border on the `<svg>` itself is skipped (reported) |
| `background-size/repeat/position` | `image` paint | cover/contain/repeat→tile; other sizes → approximated |

**Image placement** (`packages/convert/src/images.ts`). The browser's rule gives the rect the image is drawn in, relative to the border box: `object-fit` (fill, contain, cover, none, scale-down) with `object-position`, or `background-size` (cover, contain, lengths, %, `auto` from the intrinsic size keeping its ratio) with `background-position`. Percent positions resolve against the free space, as in CSS. Then:
- the rect is exactly the box → `stretch`;
- it covers the box, centered with one axis exact → `cover`;
- it covers the box otherwise (cover off-center, `none` larger than the box) → `cover` + `crop` (the visible part of the image as fractions);
- it fits inside with one axis exact → `contain` (off-center: drawn centered, approximated);
- anything leaving part of the box empty (a small `none` image, an unrepeated small background) → `contain`, approximated.

For `<img>` the intrinsic size is the element's density-corrected natural size (`srcset 2x` is half its pixels).

## 3. Layout: verify, then fall back

The CSS and Figma layout models are **not** equivalent. They differ on margins (and margin collapsing), `space-around/evenly`, min/max-content, flex-shrink, `order`, percentage sizes, multi-cell grid spans, stacking contexts, and inline formatting. So we never trust a CSS → Auto Layout mapping. We verify it.

Per container, bottom-up:

1. **Flatten.** A box with no fills, stroke, effects or clip, whose single child has identical bounds, is replaced by that child. This removes React wrapper noise.
2. **Candidate A, from CSS intent** (best editing behavior):
   - `flex-direction` → `direction`. `*-reverse` → reversed child order plus `reverse`.
   - `padding` → `padding`; the border is accounted for with `strokesIncludedInLayout`.
   - `column-gap/row-gap` → `gap/crossGap`.
   - `justify-content` start/center/end/space-between → `justify`. Anything else → skip to B.
   - `align-items` → `align`. Stretch → child cross-axis `fill`, but only for a child the browser actually stretched (cross size = the content box, no wrap); a child with its own height (an `h-8` avatar) stays `fixed` at start. `flex-grow > 0` → child main-axis `fill`.
   - Other children are `fixed` at their measured size (the IR doesn't emit `hug` yet).
3. **Simulate** Figma Auto Layout (padding, gap, alignment, greedy wrap) on the measured child sizes. FILL children are simulated the Figma way: they split the space left after fixed children **equally** (CSS grow ratios and `flex-basis` don't carry over), so `flex-grow: 1` next to `flex-grow: 2` fails verification, and so does fill inside a wrapping row. Every in-flow child within **1 px** of its measured rect (and fill children within 1 px of their simulated size) → accept.
4. **Candidate B, from measurements.** Covers block flow, margins and space-evenly.
   - Children must be monotonic along one axis with a constant gap (±0.5 px), which gives `gap`.
   - The first child's offset gives `padding`; consistent cross offsets give `align`: equal starts → start (padding = the offset), equal centers → center (no cross padding, so `mx-auto` blocks of different widths verify), equal ends → end (padding = the end offset).
   - Simulate again.
5. **Grid.** Explicit or uniform px tracks with single-cell items → `grid` with fixed tracks (`gridCell` per child). Otherwise try B per row.
6. **Fallback.** `layout: none`; children are absolutely positioned at measured coordinates; `LAYOUT_ABSOLUTE_FALLBACK` with `detail.reason`.
7. **Child order.** Paint order (non-positioned first, then positioned by z-index, stable on DOM order), except that a stack's or grid's flow children take the verified visual order, because Figma places them by list position. Absolute children keep their paint-order slot (a `-z-10` backdrop stays behind the content) and `position: absolute`.

The output is never visually worse than pure absolute positioning, and it's editable wherever that's safe.

## 4. IR → Figma

The functions in `apps/figma-plugin/src/map/*.ts` are pure (IR → plain property objects). `build.ts` only creates nodes and assigns those properties.

| IR | Figma |
|---|---|
| Box with children or a non-`none` layout | `createFrame()`, `clipsContent = clip` |
| Childless box | `createRectangle()` (also for hr/lines) |
| `stack` | `layoutMode` HORIZONTAL/VERTICAL, `itemSpacing`, `counterAxisSpacing`, `layoutWrap`, `padding*`, `primaryAxisAlignItems` MIN/CENTER/MAX/SPACE_BETWEEN, `counterAxisAlignItems` MIN/CENTER/MAX/BASELINE, `strokesIncludedInLayout` |
| `grid` | `layoutMode = "GRID"`, `gridColumnCount/gridRowCount`, `gridColumnSizes/gridRowSizes`, `gridColumnGap/gridRowGap`, `setGridChildPosition` (the API exists; check typings at Phase 6) |
| `sizing` | `layoutSizingHorizontal/Vertical` FIXED/HUG/FILL, set **after** `appendChild`. Text is never pinned to the browser's width: single-line text HUGs, multi-line keeps its width and HUGs in height (Figma's glyphs run slightly wider; FIXED clipped the last letter) |
| absolute child of a stack | `layoutPositioning = "ABSOLUTE"`, x/y relative to the parent |
| `solid` | `SOLID` with `opacity = a` |
| `linear` / `radial` | `GRADIENT_LINEAR` / `GRADIENT_RADIAL` with `gradientTransform` (formula below) |
| `rotation` | `relativeTransform [[cos, −sin, tx], [sin, cos, ty]]` about the box center |
| `image` | `figma.createImage(bytes).hash`. scaleMode: cover→FILL, contain→FIT, tile→TILE. With a `crop`, or `stretch`: CROP with `imageTransform [[w, 0, x], [0, h, y]]` (the crop fractions; identity for stretch) |
| `stroke` | `strokes`, `strokeAlign = INSIDE`, `strokeTop/Right/Bottom/LeftWeight`, `dashPattern` (dashed `[3w, 3w]`, dotted `[w, w]`) |
| `radius` | `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius` |
| effects | DROP_SHADOW / INNER_SHADOW (with `spread`; `radius` = CSS blur radius, 1:1), LAYER_BLUR / BACKGROUND_BLUR (the IR `radius` is already 2 × CSS `blur()` σ, set by the converter). Bottom-most first, like `fills` |
| `image` with `scale: "tile"` | `TILE` with `scalingFactor = tileSize.width / asset pixel width` |
| text | `createText()`. Fonts are loaded up front. Then `characters`, `setRangeFontName/FontSize/Fills/LetterSpacing/LineHeight/TextCase/TextDecoration` per run. `textAutoResize` WIDTH_AND_HEIGHT for one line, else HEIGHT with fixed width |
| vector | `figma.createNodeFromSvg(svg)`, placed at its bounds. If it throws → a rectangle filled with the `fallback` PNG (`SVG_IMPORT_FAILED`, warning, rasterized), or grey without one (error, placeholder) |
| blend mode | Same name, uppercased with `_` |

**`gradientTransform`** maps layer space (0–1 on each axis) to gradient space, where the gradient runs along x from 0 to 1. It was checked against the known top→bottom matrix `[[0, 1, 0], [−1, 0, 1]]`.
- **Linear**, for CSS angle θ on a w × h box:
  - `dx = sin θ`, `dy = −cos θ`, `L = w·|dx| + h·|dy|` (the CSS gradient-line length).
  - Row 1 is `[w·dx/L, h·dy/L, 0.5 − (w·dx + h·dy)/(2L)]`.
  - Row 2 is the same for the perpendicular direction.
- **Radial**, with center (cx, cy) and radii (rx, ry) as fractions of the box: `[[1/(2rx), 0, 0.5 − cx/(2rx)], [0, 1/(2ry), 0.5 − cy/(2ry)]]`.

**`imageTransform`** (CROP) maps layer space (0–1) to image space (0–1): the layer's top-left corner shows image point (x, y), its bottom-right (x + w, y + h). Not yet verified in Figma (see the Phase 5 log).

**Strokes** are `INSIDE`, which matches CSS borders. A box that clips its content gets its stroke drawn above the children: in Figma via the frame stroke, and in the preview via the overlay order. That way a clipped header doesn't cover the card's border.

## 5. Typography and fonts

**Inline formatting contexts** (`packages/convert/src/text.ts`). A block's children are split, in DOM order, into boxes and runs of inline content. Each run of inline content becomes **one** TextNode:
- **Plain inline** elements join the text as style runs: `display: inline`, static, `vertical-align: baseline`, no background, border, padding, shadow, filter, transform, clip or mask, opacity 1, the block's text-shadow, and only plain content inside (`strong`, `em`, `a`, `span`, `del`, `ins`…). `<br>` becomes a line break.
- Anything else (inline-block, padded or colored `<code>`, badges, images, offset or super/subscript spans) stays a box and splits the text around it.
- White space collapses across element boundaries (`Hello ` + ` <b>world</b>` → one space) and is trimmed at the ends; `pre`/`pre-wrap` keep theirs. Adjacent runs with the same style merge.
- Bounds: all line fragments of the run grouped into lines. One line hugs the text; several lines take the block's content width, so Figma wraps at the same width. With an explicit line-height each line grows by its half-leading.
- `text-overflow: ellipsis` (`truncate`) is drawn as clipped full text — Figma has no ellipsis truncation — with `UNSUPPORTED_CSS`. The characters are kept whole for editing.
- Approximated: text that starts mid-line after a split (or with `text-indent`) and wraps is drawn from the line start (`UNSUPPORTED_CSS`, approximated). Horizontal margins on inline elements are lost.

**Font names.** next/font renames families: `__notoSansDevanagari_e075aa` → "Noto Sans Devanagari", and its `__…_Fallback_…` (a metric-adjusted local font) is dropped from the stack.

- The plugin resolves each `families` stack against `figma.listAvailableFontsAsync()`, first match wins. Figma ships Google Fonts, so most web fonts resolve.
- Generic families: `system-ui`/`sans-serif`/`-apple-system` → Inter; `serif` → Noto Serif; `monospace` → Roboto Mono.
- Weight → nearest available style name. Names are normalized ("SemiBold" = "Semi Bold"); italic picks an "Italic" style.
- No match → Inter at the nearest weight + `FONT_SUBSTITUTED {from, to}`.
- **Font report before building:** after a bundle is dropped, the plugin resolves every distinct style (family stack + weight + italic) and lists what Figma will use, substitutions first, with run counts. The user installs missing fonts and drops the bundle again, or clicks **Build** (or **Cancel**).
- `text-transform` → `textCase` (UPPER/LOWER/TITLE). The characters are kept in their original case, so edits behave like CSS.
- **Post-build check:** if a text node's height in Figma differs from its IR bounds by more than half a line height (it wrapped onto a different number of lines) → `TEXT_REFLOW`, once per build with the count and an example node.

## 6. Components

V1 produces visual structure only, not Figma components. The path for later versions is: React fiber name (already captured in `source.component`) → repeated-structure detection → Figma component and instances. The IR can grow that additively (minor version).
