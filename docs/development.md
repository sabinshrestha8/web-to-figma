# Development workflow

## Setup

```sh
pnpm install
pnpm check        # typecheck + lint + test (what CI runs)
pnpm test -u      # regenerate docs/ir.schema.json after a schema change
pnpm format       # Biome format + safe fixes
```

Requires Node ≥ 20.19 and pnpm 9. CI uses Node 24.

## Coding rules

- TypeScript strict with `noUncheckedIndexedAccess`; no `any` (Biome errors on it); no bare `catch {}`.
- Pure functions for all transformation logic; side effects stay at the edges (Playwright, Figma API, HTTP).
- Validate at every trust boundary (API input, bundle import) with the Zod schemas from `@w2f/ir`.
- Limits and tunables live in a constants module, never inline.
- Workspace packages export TypeScript source directly (`"exports": "./src/index.ts"`). Consumers (Vitest, esbuild, Next) compile it, so there's no build step per package.
- Imports use explicit `.ts` extensions (works with bundlers and Node type stripping).
- A package is created in the phase that first needs it.

## Phase plan

Build a thin end-to-end slice early, then widen fidelity one area at a time.

| # | Phase | Goal | Done when |
|---|---|---|---|
| 0 | Architecture | Proposal + approval | Approved ✓ |
| 1 | Bootstrap + IR | Monorepo, tooling, CI, `packages/ir`, docs + ADRs | Schema round-trips; unknown major rejected ✓ |
| 2 | Walking skeleton | URL → Chromium → collector (rect, bg color, basic text) → IR → bundle via CLI → plugin builds **absolute** frames, rects, text | `fixtures/landing` appears in Figma as editable layers at the right positions (±2 px) |
| 3 | Box fidelity | Borders, radius, shadows, gradients, opacity, blend, clip, blur, transforms, z-order, raster islands, flatten, `packages/preview` + visual diff | Visual diff ≤ 5% on landing and card-grid |
| 4 | Typography | Runs, inline formatting contexts, line metrics, transform/decoration, font resolution + report, `TEXT_REFLOW` | Article paragraphs are single text nodes with correct runs; missing fonts reported |
| 5 | Images & SVG | Response capture, transcode/downscale, object-fit, bg images, SVG sanitize + `createNodeFromSvg`, fallbacks | No broken images on image-heavy; icons are editable vectors |
| 6 | Layout engine | Candidates A/B, simulator, flex/wrap/block/grid, sizing, absolute children | nav, card-grid, form, dashboard emit Auto Layout; no visual regression vs Phase 5 |
| 7 | Web app UX | Next.js flow, job runner, API, guard, preview, diagnostics table, multi-route/viewport | The full user journey works from a clean clone |
| 8 | Hardening | Full fixture suite, hostile fixtures, perf budgets, security tests, compare script | All fixtures within thresholds; hostile tests pass |
| 9 | V1 release | Production config, user and dev docs, plugin publish prep, release checklist | Fresh-machine install from the docs succeeds |

## Definition of Done (every phase)

1. Scope implemented as stated; anything cut is listed under Known Issues.
2. `pnpm check` green locally; CI green (or the reason it can't run, stated).
3. New logic has tests: table tests for parsers and layout; integration and visual checks wherever the phase touches the pipeline.
4. Manually verified as described in the report (Figma phases: named fixtures, screenshots, diff %).
5. No diagnostic code without a docs row; no `any`; no bare `catch`.
6. Docs updated (mapping, scope matrix, an ADR if a decision changed).
7. Phase report posted, then **stop** for approval.

## Phase report log

### Phase 1: Bootstrap + IR (2026-10-08)

- pnpm monorepo, TypeScript 7 strict, Biome, Vitest 4, GitHub Actions CI.
- `packages/ir`: Zod schema (document, captures, box/text/vector nodes, paints, effects, stroke, layout), diagnostics + `diag()`, `migrate`, `parseDocument`, `parseBundle`.
- Generated `docs/ir.schema.json`; repo-level docs↔code consistency tests.
- Deviations from the proposal:
  - The IR has no `fonts` list (it's derivable from text runs).
  - Text color is solid-only (text gradients are unsupported in V1).
  - Image paint scale uses neutral names (`cover|contain|stretch|tile|none`) plus `position`.
  - `effects` moved to all node types (for text-shadow).
  - Added `gridCell`.
  - Vitest 4 instead of 5 (local Node 20).

### Phase 2: Walking skeleton (2026-10-08)

- `packages/capture`:
  - URL policy (`net.BlockList`, IPv4-mapped unmapping, per-host DNS verdicts).
  - Playwright capture: a fresh context per capture, settle sequence, limits/timeouts.
  - In-page collector: bundled by esbuild at runtime, oklch → sRGB through a canvas, text line rects.
  - Reference screenshot.
  - `convertUrls` produces a bundle and self-validates it.
  - `pnpm w2f` CLI.
- `packages/convert`: CSS parsers; `snapshotToIR` with absolute layout only, solid fills and plain text.
- `apps/figma-plugin`:
  - The UI iframe validates the bundle with zod and decodes assets. The sandbox `code.js` (7 KB) holds no zod.
  - Pure `map/*` (fonts, paint, text, geometry).
  - `build.ts`: Section, one frame per capture, a hidden reference layer, chunked build, "unbuilt feature" diagnostics.
- `fixtures/site`: Next 16 + Tailwind 4 landing page, plus hostile redirect and subresource routes.
- **Security finding:** Playwright does not route the follow-up request of a fulfilled 3xx. Redirects are now followed or re-navigated by our own code, with the policy checked on every hop (see `security.md`). There's a regression test for this.
- **Fix found while verifying on a real app** (an auth guard redirecting `/` to `/login`, where `/login` was slow on its first `next dev` compile): the capture used to snapshot whatever was on screen once the 5s network wait ended, which gave a blank page and no warning. Now:
  - Settling repeats while the page is navigating: committed navigations, pending main-frame navigation requests (waited on up to the 30s navigation limit), and page-initiated 3xx redirects. The limit is 3 extra rounds; past that you get a warning.
  - New warnings: `PAGE_REDIRECTED` (the captured URL differs from the one requested) and `EMPTY_CAPTURE` (nothing but `html`/`body`).
  - Fixtures `self-redirect/{hard,soft,slow}`. Mutation-checked: the hard/slow test fails without the fix.
- Deviations:
  - The fixture server uses the fixed port 4400 instead of a random one.
  - CI runs Node 20 (the supported floor) instead of 24.
  - Figma-side fidelity was checked manually by the user in Figma desktop (2026-10-08) on a real app's login page. Comparing the Figma screenshot with the reference screenshot, every element sits at the same constant offset (+18, −26 px, from the viewer's scroll and canvas offset) within about 2 px, so relative positions match. Not automated.
  - The Phase 2 converter ignores borders, radius, shadows, images, SVG, background images and placeholders **without diagnostics**. Phase 3 must emit `UNSUPPORTED_CSS` for anything it still can't map.

### Phase 3: Box fidelity (2026-10-08)

- **IR 1.1:** adds the optional image-paint `tileSize`. `effects[]` is bottom-most first, like `fills`.
- **`packages/convert`:**
  - Parsers: borders (widest side's color; `BORDER_COLORS_MIXED`), radii (CSS overlap scaling; elliptical approximated), box-shadow, `filter` / `backdrop-filter`, `transform` + `rotate` / `scale`, and linear/radial gradients and background layers.
  - Pattern tiles; z-order (`stackKey` / `paintOrder`); `flatten`; leaf rotation.
  - `bakeScale` (descendants of `transform: scale()` get their painted lengths).
  - `rasterPlan` / raster islands; diagnostic aggregation (`report.ts`).
  - Every unmapped property emits `UNSUPPORTED_CSS` or `RASTERIZED`.
- **`packages/capture`:**
  - Raster islands are screenshotted in isolation (`collectorHandle` + `isolate`). Tiles render in a JS-disabled, network-blocked context.
  - Limits `maxRasters` and `maxImageSide`.
  - `comparePngs`, `previewScreenshot` (test harness), and `pnpm compare`.
- **`packages/preview`:** `renderIRToHtml(capture, assets)`, used by the visual diff.
- **`apps/figma-plugin`:**
  - Gradients via `gradientTransform`; strokes with per-side weights and dash patterns; shadows and blurs; blend modes; rotation via `relativeTransform`.
  - Tile `scalingFactor`; the **Export selected frame (PNG)** button.
- **Fixtures:** `boxes` (one cell per box feature, plus raster islands) and `card-grid`.
- **Verification:** visual diff with the budget at 5%: landing 0.01%, card-grid 0.02%, boxes 0.13%. On a real app's login page: 0.68%, where the remainder is text anti-aliasing (see below).
- **Found on the real app and fixed:**
  1. Island crops included every pixel in their rect. A page-sized `<svg>` inside an `opacity:.15` container came out as a ghost of the whole page. Fix: isolation.
  2. The whole app sits inside `transform: scale(.9375)`. Computed lengths were unscaled, so the dot grid drifted and text was 6% too large. Fix: `bakeScale`.
- **Gotchas:**
  - tsx/esbuild `keepNames` injects `__name` into functions passed to `page.evaluate` (fixed with a shim).
  - `inPage` re-evaluates the collector per call, so element references are kept on a `JSHandle` instead.
  - Tailwind v4's `rotate-*` / `scale-*` set the CSS `rotate` / `scale` properties, not `transform`.
  - Tailwind's `rounded-full` computes to `3.40282e+38px`.

#### Between Phase 3 and 4: logged-in capture (2026-10-08)

- `pnpm w2f … --storage-state auth.json`: start the capture with a saved session (cookies + localStorage, saved by `pnpm w2f:login <url>`). Requested by the user, to capture a dashboard behind a login.
- `packages/capture/src/storage-state.ts`: Zod-validated loader with value-free error messages. The CLI prints a one-line error instead of a stack trace.
- Fixture `/auth`: a server-side cookie guard plus client-side localStorage. Integration tests cover: redirected without a session; captured with one; token absent from the bundle.
- `tests/fixture-server.ts` now refuses to start if port 4400 is already taken. Before, the tests silently ran against whatever server was there.
- `pnpm w2f:login <url>` (`packages/capture/src/login.ts`): opens a visible browser with a fresh profile and saves cookies and localStorage to `.data/auth.json` when the window closes. It snapshots every second, so closing the whole browser still saves. `playwright` is only a dependency of `@w2f/capture`, so `pnpm exec playwright …` at the root never worked. Added `pnpm browsers` and fixed the README and CI to use it.
- **App-shell pages** (the document doesn't scroll; a large inner element does, as in MUI admin layouts): the capture used to stop at the fold. `unrollScroller` (capture.ts) now grows the viewport by the scroller's hidden height (max 3 rounds, capped at the capture height limit) and lets the app re-lay itself out, with no CSS overrides. It reports this as `SCROLL_CONTAINER_EXPANDED` (info). The IR keeps the requested viewport. IR 1.2 adds the code. Fixture `/app-shell`; the test is mutation-checked. On the user's dashboard the capture went from 1440×900 to 1440×2664, and no assets were rejected.

### Phase 4: Typography (2026-10-08)

- **Collector:** text is collapsed but not trimmed. Whitespace-only separators between inline siblings are kept even without a rect (probed: Chrome reports none for the space at a line wrap). New style props `text-decoration-line`, `vertical-align`.
- **`packages/convert/src/text.ts`:** inline formatting contexts. Each run of a block's inline content (text, `strong`/`em`/`a`/`span`/`del`/`ins`, `<br>`) is one TextNode with merged style runs; inline elements with their own box stay boxes. White space collapses across elements. Decorations propagate as in CSS. text-shadow → text effects (the Phase 3 `UNSUPPORTED_CSS` is gone).
- **next/font names** are restored (`__inter_53f2d8` → Inter; `…_Fallback_…` dropped). Found in the user's dashboard capture, where every run asked for a family Figma could never match.
- **Preview:** text-node shadows render as `text-shadow`.
- **Plugin:** font report. Dropping a bundle resolves fonts (`planFonts`) and lists them before **Build**/**Cancel**. `FONT_SUBSTITUTED` per requested style. `TEXT_REFLOW` after building (`reflowed`, aggregated). The UI keeps the bundle's capture diagnostics next to the build's.
- **Fixture:** `article`. Visual diff unchanged on the earlier fixtures (landing 0.01%, card-grid 0.02%, boxes 0.13%); article 0.08%.
- No IR schema change (still 1.2).

### Phase 5: Images & SVG (2026-10-08)

- **IR 1.3:** `crop` on image paints, `fallback` on vector nodes (both optional; 1.x documents still load).
- **Collector:** `<img>` facts (`currentSrc`, natural size, loaded/failed/pending); `collector/svg.ts` serializes and sanitizes inline svg (computed paint as attributes, `<use>` inlined, hostile content stripped). Style props `object-fit`, `object-position`.
- **Capture:** the network guard keeps image response bytes; `images.ts` sniffs, size-checks and decodes them in an isolated, offline context (`collector/decode.ts`): PNG/JPEG/GIF pass through, the rest is transcoded, oversize is downscaled, SVG is rendered at its drawn size × dpr. Found while building it: the decoder hung in a JavaScript-disabled context (`Image.decode()` never settles there), so the decode context keeps JS on; it only ever holds our own page.
- **Convert:** `images.ts` (`imagePlan`, `objectFitRect`, `backgroundRect`, `placementPaint`). `<img>` and `url()` backgrounds become image paints (stretch / cover / cover + crop / contain / tile); failed images become placeholders; inline svg becomes a `VectorNode`. Raster islands remain only for undecoded or still-loading images and oversized svg.
- **Plugin:** vectors via `createNodeFromSvg` (fallback PNG + `SVG_IMPORT_FAILED` if Figma rejects one); crop and stretch via CROP + `imageTransform`.
- **Preview:** crops render as background size/position.
- **Fixtures:** `image-heavy`, `svg-icons`. Visual diff: landing 0.01%, card-grid 0.02%, boxes 0.13% (unchanged), article 0.00%, image-heavy 0.09%, svg-icons 0.03%. The image-heavy bundle is 0.52 MB.
- **To verify in Figma:** the CROP `imageTransform` direction (`img-cover-top`, `img-none` and `img-fill` show it: the red corner must stay top-left and `img-fill` must look stretched) and that the icons import as editable vectors with their colors.

### Phase 6: Layout engine (2026-10-08)

- **Collector:** 25 new `STYLE_PROPS` (flex direction/wrap/justify/align/gaps/order/grow/shrink/basis/self, grid templates and placement, margins, box-sizing, width/height). Still ~85 whitelisted props, never the full ~300.
- **`packages/convert/src/layout.ts`** (new): pure candidates + simulator, wired bottom-up into `snapshotToIR`.
  - **Candidate A, from CSS intent:** flex direction (incl. reverse → reversed child order + `reverse`), padding, gap/crossGap, justify start/center/end/space-between, align start/center/end, flex-grow → main-axis `fill`, stretch → cross-axis `fill`. Anything else (space-around/evenly, baseline, wrap-reverse, per-item align-self) falls through to B.
  - **Simulator:** Figma Auto Layout (padding, gap, alignment, fill distribution, greedy wrap) on the measured child sizes. Every in-flow child within **1 px** → accept; fill children must also size within 1 px.
  - **Candidate B, from measurements:** monotonic stacking with a constant gap (±0.5 px) → gap; first offset → padding; consistent cross offsets/centers/ends → align. Covers block flow, margins, and space-evenly/around (read back as start + padding).
  - **Grid:** explicit px tracks (or implicit rows from tallest child) with single-cell items → `grid` with fixed tracks + `gridCell`; spans fail to B/fallback.
  - **Fallback:** `layout: none`, children absolute at measured coordinates, `LAYOUT_ABSOLUTE_FALLBACK` (info).
  - Absolute/fixed children always stay absolute; `flatten` still runs first per mapping §3.
- **Plugin:** pure `map/layout.ts` (`stackProps`/`gridProps`/`sizingProp`, table-tested) + `build.ts` applies stack/grid frame props, `strokesIncludedInLayout` when bordered, per-child sizing after append, `ABSOLUTE` + measured x/y for out-of-flow children, `appendChildAt` for grid cells. The `setGridChildPosition` API exists in typings 1.141 as documented (risk retired).
- **Fixtures:** new `nav` (sticky space-between header, centered CTA row), `form` (vertical field stack, checkbox row, end-aligned actions; native checkbox → `RASTERIZED`), `dashboard` (sidebar + filling main, stat-card row with flex-grow, chart canvas → `RASTERIZED`).
- **Verification:** layout asserts (nav stacks, card-grid 3-col grid, form stacks, dashboard shell + fill) in `fidelity.int.test.ts`. Visual diff, budget 5%: landing 0.01%, card-grid 0.02%, boxes 0.13%, article 0.00%, image-heavy 0.09%, svg-icons 0.03% (all identical to Phase 5), nav 0.01%, form 0.13%, dashboard 0.00%.
- **To verify in Figma:** import a bundle and check the nav header resizes as a space-between stack, the card grid as fixed tracks, the dashboard main column fills, and that absolute children (e.g. badges) stay pinned.
- No IR schema change (still 1.3).
