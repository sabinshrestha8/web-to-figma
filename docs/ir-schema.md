# UI IR schema

Source of truth: [`packages/ir/src/schema.ts`](../packages/ir/src/schema.ts) (Zod 4). TypeScript types come from `z.infer`.
- Generated JSON Schema: [`ir.schema.json`](ir.schema.json). It's kept in sync by `tests/docs.test.ts`; run `pnpm test -u` to regenerate it.
- Current version: **`1.4`**. Changelog: 1.1 adds optional `tileSize` (CSS px) to image paints, used with `scale: "tile"`. 1.2 adds the diagnostic code `SCROLL_CONTAINER_EXPANDED`. 1.3 adds optional `crop` (x, y, width, height as fractions of the image) to image paints and an optional `fallback` asset (PNG of the same markup) to vector nodes. 1.4 adds optional `truncate` (one line ending in "…" at its bounds) to text nodes.

The IR is **independent of React, CSS and Figma**. It describes boxes, text and vectors with *verified* layout. CSS facts (margins, `display`, `justify-content: space-evenly`, …) live only in the capture snapshot. Any target that understands stacks, grids and absolute positioning can consume the IR, Figma or otherwise.

## Shape

```
Document   schemaVersion "1.4", generator {name, version}, captures[≥1], assets {sha256 → AssetMeta}, diagnostics[]
Capture    id, url, title, viewport {width, height, dpr}, root: BoxNode, screenshot?: AssetId
Node       BoxNode | TextNode | VectorNode            (discriminated by `type`)
  common   id, name, bounds {x,y,width,height}, rotation?, opacity, blendMode, effects[],
           position flow|absolute|fixed, sizing {horizontal, vertical: fixed|hug|fill},
           gridCell? {row, column}, source {tag, selector, component?}
BoxNode    fills[] (bottom first), stroke? {color, weights{t,r,b,l}, style solid|dashed|dotted},
           radius [tl,tr,br,bl], clip, layout, children[]
TextNode   characters, runs[{start, end, style}], align left|center|right|justify,
           autoResize width-and-height|height, lineCount, truncate?
TextStyle  families[] (CSS stack), weight 1–1000, italic, size, lineHeight px|"auto",
           letterSpacing px, transform, decoration, color
VectorNode svg (sanitized markup, ≤ 500 KB), fallback? (asset id)
Paint      solid {color} | linear {angle, stops} | radial {center, radius, stops}
           | image {assetId, scale cover|contain|stretch|tile|none, position, tileSize?}
Effect     shadow {inset, offset, blur, spread, color} | layer-blur {radius} | background-blur {radius}
           (effects[] bottom-most first, like fills. shadow.blur = CSS blur radius; blur radius = 2σ of CSS blur(σ))
Layout     none | stack {direction, reverse, wrap, gap, crossGap, padding, justify, align}
                 | grid {columns[{size}], rows[{size}], columnGap, rowGap, padding}
AssetMeta  mime png|jpeg|gif, width, height, byteLength
```

## Conventions

- **Units.** CSS px. Colors are sRGB floats 0–1 (the converter rounds to 4 dp; lengths to 0.01 px).
- **`bounds` are absolute page coordinates** of the untransformed box, with `rotation` applied about the center. Consumers convert to parent-relative coordinates themselves. Keeping one coordinate space makes layout verification and preview trivial.
- **Images aren't nodes.** An `<img>` is a `BoxNode` with an `image` paint, which is exactly Figma's model. Rectangles and lines are childless boxes.
- **Text runs** must tile `[0, characters.length)` contiguously. An inline formatting context (`<p>Hi <b>there</b></p>`) is one TextNode with several runs.
- **Gradient angle** follows the CSS convention: 0° points up, clockwise.
- **`position` on `image` paints, and `Point`,** are fractions of the box (0–1).
- **Asset IDs** are the sha256 hex of the bytes, which gives dedupe for free.

## Invariants enforced by validation

Structural typing is enforced by Zod. On top of that, the document-level checks are:
- Every `image` paint's `assetId` and every capture `screenshot` exists in `assets`.
- Node IDs are unique across the whole document.
- Text runs tile the characters exactly.

## Versioning and migration

- `schemaVersion` is `"major.minor"`.
- **Minor bump** = additive optional fields only. A reader accepts any minor of its own major; unknown fields are stripped.
- **Major bump** = breaking. Requires a step in `MIGRATIONS` (`packages/ir/src/migrations.ts`) that upgrades major *n* → *n+1*.
- A document from a **newer major** is rejected with `SCHEMA_VERSION_UNSUPPORTED` ("update the plugin").
- `parseDocument(input)` = `migrate` → `Document.safeParse`. It returns `Result<Document>`, i.e. `{ok, value}` or `{ok:false, diagnostics}`. This is the only entry point for untrusted IR.

## Bundle (`.w2f.json`)

```json
{ "format": "w2f-bundle", "ir": { "schemaVersion": "1.4", … }, "assetData": { "<sha256>": "<base64>" } }
```

`parseBundle` validates the envelope, runs `parseDocument` on `ir`, and requires `assetData` keys to match `ir.assets` exactly.
