# Development workflow

## Setup

```sh
pnpm install
pnpm check        # typecheck + lint + test (what CI runs)
pnpm test -- -u      # regenerate docs/ir.schema.json after a schema change
pnpm format       # Biome format + safe fixes
```

Requires Node ≥ 20.19 and pnpm 9. CI uses Node 20 (the supported floor).

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
| 7 | Drift watch (reshaped from "Web app UX", 2026-10-10) | Config of watched pages, baselines, node + pixel + Figma diff per run, history, HTML report, CI gate | Unchanged page passes, changed page fails the gate with crops in the report |
| 7b | Web app UX | Next.js flow, job runner, API, guard, preview, diagnostics table, multi-route/viewport | The full user journey works from a clean clone |
| 8 | Hardening | Full fixture suite, hostile fixtures, perf budgets, security tests, compare script | All fixtures within thresholds; hostile tests pass |
| 9 | V1 release | Production config, user and dev docs, plugin publish prep, release checklist | Fresh-machine install from the docs succeeds |
| 10 | Hosted plugin flow | Capture service (`apps/server`), DNS-pinned hosted capture, plugin URL import, Docker + release build | URL → Figma from the plugin alone, against a running service |
| 11 | Browser extension | Capture the open tab (logged in, dialogs open) with the same collector; plugin paste import | A logged-in fixture page → bundle → plugin, through the loaded extension |

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

### Phase 6 follow-up: drift tooling + review fixes (2026-10-09)

- **Capture:** `--wait-for` (repeatable) and `--extra-settle-ms`. All selectors share one 60 s budget, so several missing selectors stay a warning instead of adding up past the 90 s job clock.
- **Drift:** `pnpm drift` and `pnpm figma-drift` (testing.md). The Figma side now maps radius, clip, strokes, effects, blend, gradients and image fills, and skips hidden paints. Styles compare with tolerance (gap and padding within 1 px), so float noise no longer shows up as "fills, stroke, radius, clip, effects changed".
- **Layout fixes found in review**, each with a test that failed before:
  - cross-axis `fill` only for children the browser actually stretched (an `h-8` avatar in a default flex row came out stretched to the row height);
  - FILL is simulated the Figma way (equal split), so unequal `flex-grow` is no longer accepted as fill;
  - absolute children keep their paint-order slot (a `-z-10` backdrop was moved on top of the content);
  - candidate B's center/end alignment gets the right cross padding (centered `mx-auto` blocks never verified).
- **Plugin:** an Auto Layout frame pins both sizing modes to FIXED and restores its measured size after `layoutMode` is set, so it can't collapse to its content.

### Phase 7: Drift watch (2026-10-10)

Reshaped from "Web app UX": drift (production vs baseline, production vs Figma) is the differentiator, and the engine already existed. The conversion web UI moves to 7b.

- **`pnpm drift:run [drift.config.json] [--accept] [--page NAME]...`** (`packages/capture/src/drift-run.ts`, `drift-run-cli.ts`). A bare config name is read from `.data/`. For every page, it captures, then:
  - on the first run, saves the baseline;
  - otherwise diffs nodes (`diffCaptures`) and pixels (`comparePngs`, `diff.png`) against the baseline;
  - diffs the configured Figma frame when `FIGMA_TOKEN` is set, and the report says when it was skipped.
- **Config** (Zod, strict): `pages[]` with `name` (path-safe, unique), an http(s) `url`, `viewport`, `storageState` (relative to the config), `click`, `waitFor`, `extraSettleMs`, `figma {file,node}`. Thresholds `maxChanges` / `maxPixelPercent` / `maxFigmaChanges`, top-level or per page. `out` (default `drift/`, relative to the config) and `blockPrivate`.
- **Outputs** under `out/`:
  - `<page>/{baseline,latest}.{w2f.json,png}` and `diff.png`;
  - `history.jsonl`, one row per page per run;
  - `report.html`: summary table, per-page trend sparkline, capture warnings (an expired login shows as `PAGE_REDIRECTED`), changes grouped by kind with baseline/now crops of the screenshot, node outlined (first 40 per section).
- **Gate:** exit 1 when a page failed or went over a threshold, 2 on bad arguments/config. One failing page doesn't stop the others. A baseline whose viewport no longer matches fails with "rerun with --accept".
- **Drift entries** now carry `before`/`after` page bounds (for the crops). `fetchFigmaFrame` is shared by `figma-drift` and `drift:run`; `parseViewport` moved to `run.ts`.
- **Security:** everything from the page in the report is HTML-escaped (mutation-checked); URLs are http(s) only and still go through the capture network policy; page names can't escape `out/`.
- **Scheduling** is left to cron, Task Scheduler or CI (README). No daemon.
- **Tests:** config validation and report escaping/crops/gate/trend (unit); a full loop on the fixture site (integration): baseline set → unchanged passes → changed page trips the gate with crops → `--accept` → passes; a blocked page fails without stopping the run; Figma skipped without a token.
- **Verified by hand:** CLI exit codes 0/1/2; report rendered and inspected (crops clipped and labelled).
- No IR schema change (still 1.4).

### Phase 7 follow-up: ignore live content (2026-10-10)

Two runs of `drift:run` on the real dashboard gave 5 changes and 0.02% pixels:
- 4 were SVG icons whose React `useId` ids are regenerated on every load. **Fixed:** markup is compared with canonical ids (`canonicalIds`).
- The other was the header clock, plus 3 charts whose axes changed with live data. These are real changes but not UI drift, so they need an ignore mechanism.

- **`ignore` selectors** (drift config per page, `pnpm w2f --ignore`; IR 1.5). The collector flags matching elements; convert sets `ignore` on their nodes. The flag survives flattening, and a paragraph holding an ignored inline (`Updated <time>`) is ignored as a whole.
- **Drift** checks only an ignored node's bounds, never its content or children. Its area (union over both captures) is painted out of both screenshots before the pixel diff, and the report says how many regions were masked.
- **`IGNORE_SELECTOR_UNUSED`** (warning): a selector that's invalid CSS or matches nothing, so a typo can't silently ignore nothing.
- **Tests:**
  - unit tests for boxes, flattened wrappers, a nested inline in a paragraph, drift bounds-only and `ignoredRects`, all mutation-checked;
  - an integration test on the new `/live` fixture: noisy without `ignore`; 0 changes, 0% pixels and 4 masked regions with it (mutation-checked: without the mask it's 0.89%); both unused-selector warnings.
- **Limit:** an ignored element with `display: contents` has no box, so nothing is flagged; use a selector for its children.

### Phase 8: Hardening (2026-10-10)

- **Hostile fixtures** (`fixtures/site/app/hostile/*`, all zero-React `route.ts` handlers) + `packages/capture/src/hardening.int.test.ts`:
  - `hang` (a page whose script never yields) fails with `TIMEOUT` instead of hanging;
  - `many-elements` (20k elements over the 15k collector limit) fails with `PAGE_TOO_LARGE`;
  - `huge-image` (a valid 12 MB BMP over the 10 MB asset limit) still captures, with `ASSET_REJECTED` and a grey placeholder. The BMP path matters: `imagePlan` only requests bytes for `loaded` images, so an invalid 12 MB body would report `IMAGE_FAILED`, never `ASSET_REJECTED`.
- **Full fixture suite:** new `mobile` (390×844, cards assert a vertical stack) and `nested-complex` (deep nesting, margin siblings, absolute overlays kept in paint order) pages, both in the visual diff. Measured: mobile 0.12%, nested-complex 3.92%.
- **`NEGATIVE_ZINDEX`** (info): the nested-complex `-z-10` backdrop exposed that nothing reported below-fill painting. Figma has no below-fill, so the child stays in paint order, above the parent fill; the diagnostic says so once per page. Unit-tested in `convert.test.ts`, asserted end to end on the fixture. No IR version change (still 1.5; only the diagnostic enum grew).
- **Perf budgets asserted** (`hardening.int.test.ts`): landing at 1440px captures in ~3s (budget 8s), image-heavy bundle 0.53 MB (budget 15 MB).
- **Compare script:** `--capture N` picks the viewport (same convention as `drift`), `--max` rejects non-numbers and negatives instead of silently exiting 0. Verified by hand against a two-viewport bundle (exit codes 0/1, both error paths).
- **Left for later:** cross-origin POST → 403 needs `apps/web` (Phase 7b); the preview still paints negative-z children above the parent fill (the 3.92% remainder, documented in testing.md).

### Phase 9: V1 release (2026-10-10)

V1 is the CLI tool plus the Figma plugin. The web UI stays deferred (7b).

- **Production config:** MIT `LICENSE` (was: none); `apps/figma-plugin/manifest.prod.json` (name `Web to Figma`, stable prod `id`; the `(dev)` manifest stays for local work). The prod id must never change after the first Community publish. Nothing is published to npm (all packages `private`); versions left as-is, release is a `v1.0.0` tag (see `docs/release.md`).
- **Docs match the code:** architecture §2/§5/§6/§10 rewritten CLI-first (no more `pnpm start`, job runner, `.data/jobs`); scope matrix auth cell now says storage-state file, not pasted cookie; `api.md` bannered as deferred 7b design; `security.md` server-exposure threat/control marked deferred; `development.md` CI Node fixed (20, not 24).
- **Release checklist** (`docs/release.md`): cut steps, the fresh-install gate, plugin publish steps, post-release notes. README docs table links it.
- **Gate, run in a clean clone to a temp dir:** `pnpm install` (34s) → `pnpm browsers` → `pnpm check` green (unit 225, integration 63) → `pnpm plugin:build` (15 KB code / 454 KB UI) → capture landing (2.7s) → `pnpm compare` self-diff 0.00%, `--max 0` passes. Figma import/export still needs the desktop app (semi-automated by design).
- **Cleanup:** removed the ignored root `drift.md` (a real-app report; testing.md says never commit those).
- **Limit:** Playwright browsers are shared via the OS cache, so a same-machine clone doesn't re-prove the browser download; everything else was genuinely fresh.

### Hotfix: notched fieldset outlines (2026-10-11)

From a production bundle (MUI dashboard): floating labels were all correctly sized, positioned and absolute, but every outlined select draws its top border through the label in Figma — the browser cuts a notch (fieldset legend) that Figma has no primitive for. New `NOTCHED_OUTLINE` info diagnostic (fieldset + top border + nonzero legend), unit-tested and mutation-checked, plus a `selects` fixture asserting it end to end. Pixels unchanged (nothing to map it to); mapping.md documents the limit.

### Hotfix: outlines as outside strokes (2026-10-11)

Same bundle: a dropdown's top edge, painted by an `outline` in the browser, was missing in Figma — outlines were reported and skipped. A visible outline now maps to a uniform outside stroke (Figma draws outside strokes the way CSS draws outlines: past the border box, over neighbors). Exotic styles draw solid and nonzero offsets are ignored, both reported; on a bordered element the inside border still wins. IR 1.6 adds the optional stroke `align` (absent means inside, so old bundles load unchanged).

### Hotfix: pseudo-element detection (2026-10-11)

Same bundle, still hunting a hairline the IR can't explain after eliminating fills, borders, shadows, outlines and vectors: the one remaining unrecorded painter is `::before/::after` content (the `PSEUDO_ELEMENT_SKIPPED` code existed but was never emitted). The collector now flags painted pseudos — text/counter/image glyphs, non-transparent backgrounds, visible borders — while clearfixes and hidden pseudos stay quiet. Geometry still needs CDP (V1.1); for now the warning names the node instead of silence.

### Phase 7b: Web app UX (2026-10-10)

Un-deferred: V1 users asked whether every flow needs the terminal, so the browser UI now exists for public URLs (login stays in the CLI).

- **`apps/web`** (Next 16, `pnpm web` → `127.0.0.1:4317`): form (URLs, viewports as objects or `1440x900` strings, wait-for, settle), 500 ms polling, per-capture screenshot vs IR preview, counts, filterable diagnostics table, bundle download.
- **Job runner** (`lib/jobs.ts`): in-memory `Map`, max 2 non-terminal jobs (else 429), artifacts in `.data/jobs/<id>/bundle.json`, 24 h sweep once per process on first API use (a startup hook via `instrumentation.ts` gets Edge-bundled despite `runtime = "nodejs"` — tried, reverted), crash fails loudly instead of sticking at running.
- **API** (`lib/api.ts`, all logic unit-testable without a server): strict Zod input (`INVALID_INPUT`, new fatal code), URL-policy pre-check (400 `URL_BLOCKED`), Host/Origin/JSON guard (403), thin Next routes. Deviations from the `api.md` draft: no `cookieHeader`, no DOM-node count, coarse `stage`, IR endpoint returns `{ capture, assetUrls }`.
- **Found while verifying on the dev server** (both real bugs, both fixed):
  1. `instrumentation.ts` was also compiled for the Edge runtime, where `node:fs` fails — the sweep never ran. Fix: `export const runtime = "nodejs"`.
  2. The collector entry was resolved from `import.meta.url`, which bundlers rewrite to the build output (Turbopack even statically evaluates `require.resolve`, so that can't anchor it either). `in-page.ts` now resolves from the server working directory with an `import.meta` fallback for plain runtimes.
- **Tests:** guard table tests (incl. rebinding host, wrong port, cross-origin POST, non-JSON), validation/400/404/429 handler tests with fake stores, admission + sweep unit tests, and `flow.int.test.ts` (POST → poll → bundle → IR → asset PNG on the fixture site). The 403 was also proven over real HTTP with a raw `Host` header (fetch-level clients normalize it, so the unit tests spoof `Request` objects instead).
- **Verified by hand:** `next build` green; full journey on `next dev` (POST → done, bundle attachment, page renders, evil-host and cross-origin 403s, unknown-id 404s). CI now also runs `pnpm --filter @w2f/web build`, since only a real build catches the bundler class of bugs above.
- **Found in review:** job dirs are created before the record is registered, so an unwritable disk can't leave a phantom job occupying a 429 slot; the startup sweep was proven by aging a dir 25h and restarting the server (it vanished).
- No IR version change (still 1.5; only the diagnostic enum grew).

### Phase 7b follow-up: web login (2026-10-10)

Designers can't use the terminal, and logged-in pages were CLI-only even with the web UI. The UI now has a login flow for them.

- **Login endpoints** (`lib/session.ts`, `lib/api.ts`): `POST /api/login` opens the URL in a visible browser on the local machine (the existing `saveLogin`, headed by default); closing the window saves `.data/auth.json` — the same file `pnpm w2f:login` writes, so CLI and web sessions are interchangeable. One open login at a time (else 429); `GET /api/login/:id` polls it; `GET /api/session` reports metadata only (cookie count, domains, origins — values never leave the server); `DELETE /api/session` forgets it.
- **Capture wiring:** `session: true` on a conversion loads the file (`loadStorageState`, value-free errors) into the capture context. The UI has a **Saved session** card (log in, status, forget) and a per-capture checkbox, disabled without a session.
- **Tests:** store states and file handling with fake saves; redaction proven with a known token (metadata contains domains, never the token); handler codes (202/429/400/404, missing-file 400); an integration test that seeds a session through the real `saveLogin` and captures the `/auth` fixture as Ada with the token absent from the bundle.
- **Caught by the tests:** the new integration test first failed with `PAGE_REDIRECTED` to `/landing` — the seeded cookie carried the wrong value. The fixture guard only accepts `fixture-session-token`; the test now uses it. The wiring was always right.

### Phase 10: Hosted plugin flow (2026-10-14)

Community users should be able to import a URL from the plugin alone. The local web app can't be hosted (127.0.0.1 guard, headed login, disk jobs), so there's a new standalone service.

- **Hosted capture mode** (`packages/capture`): `pinnedFetch` makes each browser request from Node with one vetted DNS answer (the rebinding fix: the check and the connect use the same address), no keep-alive and no redirect following. Chromium runs with `--host-resolver-rules=MAP * ~NOTFOUND`, so it has no network of its own. WebSockets are closed. `signal` cancels a capture by closing its context. Local mode is unchanged (parity test on image-heavy).
- **`apps/server`** (node:http, no framework): `POST/GET/DELETE /api/captures`, `/bundle` (gzip), `/healthz`, CORS `*` for Figma's null origin. In-memory queue (`W2F_MAX_RUNNING`/`W2F_MAX_QUEUED`), one active capture per client, hourly rate, optional bearer tokens, a TTL on results, a bundle cap, and redacted JSON logs. Dockerfile on `mcr.microsoft.com/playwright:v1.64.0-noble`.
- **Plugin:** URL, viewport and options UI; `remote.ts` client (server-reported progress only, cancel → `DELETE`, readable errors); `readBundle` shared with drag-and-drop; token in `figma.clientStorage`; builds immediately when no font is substituted. `build.mjs --release` bakes in `W2F_API_URL` (https, non-local) and writes a manifest allowing only that origin.
- **Found while verifying:** (1) the queue check refused a job with a free slot when `W2F_MAX_QUEUED=0`; (2) a sandboxed iframe without `allow-forms` never fires `submit`, so the plugin's Import button did nothing in a null-origin iframe. It's a click handler now; (3) `node --import tsx` resolves from the working directory, so the Dockerfile runs from `apps/server`.
- **Verified:** server unit (16) and end-to-end (2, real Chromium on the fixture site) tests; plugin client tests; the built `ui.html` driven in a sandboxed null-origin iframe against the running service (import + dialog click, invalid URL, metadata IP → `URL_BLOCKED`, cancel in 195 ms); a production-style filtered install, started like the image's CMD, captured `https://example.com` in 3.5 s.
- **Not verified here:** the Docker image (no Docker on this machine), so CI now has a `server-image` job: it builds the image, runs it, and checks `/healthz`, a blocked metadata URL and a real `https://example.com` capture. The `check` job also runs the release build. Also not verified: the plugin inside Figma itself, and any deployment or Community publish.

### Phase 10 follow-up: logged-in pages from the plugin (2026-10-14)

A service on your own machine can now use the saved login: `W2F_SESSION=.data/auth.json` (the same file `pnpm w2f:login` and the web UI write) is loaded into every capture, re-read per job (so a fresh login needs no restart), and an unreadable file gives a `400` "log in again". The server refuses to start with a session and no `W2F_API_TOKENS`: CORS is `*`, so otherwise any website could drive it and read logged-in captures.

- **No capture change was needed.** A new test proved that hosted mode's pinned fetch already carries the context's cookies (routed request headers include them); stripping the cookie there makes the test fail.
- **Tests:**
  - the start refusal;
  - the session reaching `execute`, with the cookie value absent from the logs;
  - a missing file giving `400` without capturing;
  - end to end through HTTP on the `/auth` fixture ("Signed in as Ada", no redirect, the cookie absent from the bundle). Mutation-checked: the test fails without passing the session along.
- **Verified:**
  - the built plugin UI in a null-origin iframe: a 401 message without the token; with it, the logged-in fixture;
  - the user's real leave page, through a service using their saved login (no private networks), with the two Assign clicks: done in 18.6 s, no redirect, 1440×900, and the MUI dialog present. Only structure was inspected; the result lived only in that service's memory.

### Phase 11: Browser extension (2026-10-14)

A published plugin can't capture logged-in pages through a deployed service, and most real pages are behind a login. The extension captures the tab the user already has open, with the collector the CLI uses.

- **`apps/extension`** (Chrome MV3, esbuild). The toolbar button or Alt+Shift+F does the following:
  1. `captureVisibleTab`;
  2. `collector.js` in the isolated world;
  3. `collect()`;
  4. a `result.html` tab takes the capture once from the service worker's memory.
- **Assembly** (`bundle.ts`, pure with injected browser parts): images are fetched with the user's cookies and decoded by the collector's `decodeImage`. Raster islands are cropped from the screenshot (on-screen only). Then `snapshotToIR` → `parseDocument`. **Download .w2f.json** and **Copy for the plugin** finish it. What it can't do (off-screen islands, tiles, `blob:` images) is reported as `ASSET_REJECTED`.
- **Shared code:** `sniffImage` moved to a Buffer-free `capture/src/sniff.ts`. `@w2f/capture` exports `./collector`, `./limits` and `./sniff`. The test snapshot builders moved to `convert/src/testing.ts`.
- **Plugin:** Ctrl+V imports a pasted bundle (pastes into its fields are left alone), and the hints point to the extension for logged-in pages.
- **Verified:**
  - unit tests (4) and integration tests (2: the loaded extension in Playwright's Chromium on the logged-in `/auth` fixture and on image-heavy, downloading through the real button). Mutation-checked: breaking image fetching fails the image test;
  - end to end in one browser: the dialog fixture with the dialog open → extension → **Copy** → Ctrl+V into the built plugin UI in a sandboxed null-origin iframe → the plugin got the bundle and started its font check. The texts match a CLI `--click` capture of the same dialog.
- **Not verified here:** Edge, a real Ctrl+V inside Figma desktop, and the user's real logged-in app through the extension. Not published to the Chrome Web Store (no icons yet; [release.md](release.md#publish-the-extension)).

### Phase 11 follow-up: Firefox, app shells, paste in Figma (2026-10-15)

- **Firefox:** one manifest serves both browsers (`background.scripts` next to `service_worker`, a gecko id, `data_collection_permissions: none`), and `web-ext lint` reports 0 errors. When Firefox withholds `<all_urls>`, the result tab asks for it. Browser and error pages now get a clear "can't be read by extensions" message.
- **App shells:** the collector's `unrollInPlace`/`restoreUnroll` grow the main inner scroller and its ancestors for the capture, then restore them. This is skipped while a dialog or menu is open. Tested on the app-shell fixture (800 → 2816 px, page restored). Follow-up: window-tall elements outside the scroller (100vh / `inset-y-0` sidebars) grow by the same amount; the fixture's sidebar is now fixed and checked full height in both the CLI and extension tests. Then, from a real dashboard: the extension waits and regrows for widgets that render once in view (fixture: rows loaded by an IntersectionObserver); a `flex-wrap` row that fit on one line maps to a non-wrapping stack, so wider Figma text can't push its last item down; the space before an inline box ("You have <b>20</b>") is kept so Auto Layout doesn't butt them together.
- **Paste in Figma:** Figma desktop sends Ctrl+V to the canvas unless a plugin text field has focus, so bundles now go into a dedicated paste box. If the paste event carries no text, the input handler reads the box instead. **Copy** reports the size it copied, or why it failed.
- **Verified by the user in Firefox + Figma desktop:** a capture of their real dashboard; Download → drop, and Copy → paste, both imported.
