# Architecture

Web → Figma converts a **rendered** React/Next.js page into an editable Figma design. It never reads React source. It reads the browser's DOM, computed styles and layout, normalizes them into a versioned intermediate representation (IR), and has a Figma plugin build real nodes from that IR.

```
Rendered web UI → DOM + computed layout → UI IR (versioned, neutral) → Figma translation → editable design
```

There's no AI/LLM in the shipped product. Every step is deterministic.

## 1. Product definition

V1 is a **local developer tool**:
- Point it at a URL, usually `localhost:3000` running your app.
- Pick routes and viewports, review what was detected, and download a `.w2f.json` bundle.
- The Figma plugin turns the bundle into editable layers.

Every approximation is reported as a diagnostic ([diagnostics.md](diagnostics.md)). Nothing is silently wrong.

**Prior art:** html.to.design (divRIOTS) sells this pipeline commercially. This project assumes building the product is the goal.

## 2. User journey

1. `pnpm start` runs the local web app on `127.0.0.1:4317`.
2. **New conversion.** Enter a URL or a base URL plus routes. Pick viewports (1440×900, 768×1024, 390×844, or custom).
3. **Progress.** Stages: queued → loading → settling → extracting → assets → converting → done.
4. **Results.**
   - The original screenshot next to the IR preview (the IR rendered back to HTML), with node outlines.
   - Counts of DOM nodes, IR nodes, assets and fonts.
   - A diagnostics table you can filter.
5. **Download** `name.w2f.json`.
6. **Figma plugin.** Drop in the file. It shows a font report, then builds with a progress bar, then shows the post-build diagnostics.
7. **Result:** a Section holding one frame per (route × viewport).

## 3. V1 scope matrix

| Area | Supported | Partial (approximated + diagnostic) | Unsupported (diagnostic + fallback) |
|---|---|---|---|
| Input | http(s) URL incl. localhost; multiple routes × viewports per job | Pages behind auth (pasted cookie header, local only) | Project-folder mode, file:// |
| Boxes | bg color, opacity, per-corner radius, per-side border width (one color), dashed/dotted, overflow clip, box-shadow (inset, spread), blend modes | Per-side border colors (dominant color), elliptical radii (min), `outline` | `border-image`, `mask`, `clip-path` (→ raster) |
| Paint | solid, linear-gradient, multiple bg layers | radial/conic gradient, `background-size/position` | repeating gradients (→ first layer) |
| Layout | flex row/col incl. reverse, gap, padding, justify start/center/end/space-between, align start/center/end/stretch, flex-grow → fill, wrap; absolute/fixed children; uniform block stacking | CSS Grid → Figma `GRID` when tracks are explicit/uniform; `space-around/evenly` and margins when a measured gap verifies | Anything failing verification → absolute positioning |
| Text | family stack, weight, italic, size, line-height, letter-spacing, align, color, decoration, text-transform, wrapping, mixed inline styles (runs), text-shadow | Font substitution, vertical-align, `::placeholder` | `::before/::after` content, vertical writing modes, text gradients |
| Images | `<img>`, `<picture>`, CSS bg images, object-fit/position; WebP/AVIF/SVG-as-img → PNG; >4096px downscaled | Lazy images (page is pre-scrolled) | Broken/oversize (→ placeholder + error) |
| SVG | inline SVG / icon components → editable vectors, `currentColor` and CSS inlined | `<use>` sprites (inlined) | SVG Figma rejects → raster island |
| Effects | `filter: blur` → layer blur, `backdrop-filter: blur` → background blur | rotate / scale transforms | skew, 3D, other filters |
| Replaced | inputs, textarea, select, button as styled boxes + text | Native checkboxes/radios → raster | canvas, video, iframe, WebGL → raster island |
| Stacking | DOM order + positioned/z-index order within a parent | Cross-parent stacking contexts | — |
| Output | One frame per capture in a Section; semantic layer names | — | Components, variants, variables |

## 4. Non-goals (V1)

- AI/LLM at runtime, semantic component detection, design-system inference, source reconstruction.
- SaaS, billing, enterprise auth, collaboration, version history, multiplayer.
- **Hosted/multi-tenant mode.** It needs a network-egress sandbox; see [security.md](security.md).
- **Project-folder mode.** It would execute untrusted install/build scripts.
- Animations (we capture one settled frame with reduced motion), responsive reconstruction, CSS variables/tokens, Tailwind semantics.

## 5. System architecture

A modular monolith with two runtimes: the local Node app and the Figma plugin sandbox. There's no database, queue or Redis.
- Jobs live in an in-memory `Map`.
- Artifacts live under `.data/jobs/<id>/` with a 24h sweep at startup.
- Concurrency is capped by a small semaphore (2 jobs).

```
 ┌──────────────── Local machine ────────────────────────────────────────┐
 │  apps/web (Next.js, 127.0.0.1 only)                                   │
 │   UI ──POST /api/conversions──► job runner (in-process, semaphore=2)  │
 │                     packages/capture (Node)                           │
 │   URL policy ─► Playwright Chromium (1 browser, 1 context per job)    │
 │                   │ page.route(): policy check + asset byte capture   │
 │                   │ settle: fonts.ready, scroll for lazy, reducedMotion│
 │                   │ page.evaluate(collector IIFE) ──► RawSnapshot      │
 │                   │ full-page screenshot (fidelity ref + raster crops)│
 │                     packages/convert (pure: no browser, no Figma)     │
 │   RawSnapshot ─► normalize ─► flatten ─► inferLayout(verify) ─► IR    │
 │                     packages/ir (zod schema, version, migrate)        │
 │   IR + assets ─► Bundle (.w2f.json) ─► download                        │
 └───────────────────────────────────────────────────────────────────────┘
                        │ file (drag & drop) — no network in V1
 ┌──────────────── Figma ────────────────────────────────────────────────┐
 │ apps/figma-plugin  ui.html (file input, progress, report)             │
 │   └─postMessage─► code.js: parseBundle ─► resolveFonts ─► loadFonts   │
 │        ─► build: map/*.ts (pure IR→props) + thin create/apply         │
 │        ─► post-build checks (text reflow) ─► diagnostics              │
 └───────────────────────────────────────────────────────────────────────┘
```

## 6. Components

| Component | Runs in | Responsibility | Status |
|---|---|---|---|
| `packages/ir` | anywhere | Zod schema and types, `SCHEMA_VERSION`, `parseDocument`, `migrate`, `parseBundle`, diagnostic codes | **Phase 1 ✓** |
| `packages/capture` | Node | URL policy, Playwright lifecycle, settle, asset capture/transcode, collector injection, screenshot, dev CLI | Phase 2 |
| `packages/capture/collector` | page | Zero-dependency DOM walker bundled to an IIFE → `RawSnapshot`. Reusable by a future browser extension | Phase 2 |
| `packages/convert` | anywhere | Pure: `snapshotToIR`, CSS parsers, `flatten`, layout inference + Auto Layout simulator, z-order | Phase 2+ |
| `packages/preview` | browser/Node | `renderIRToHtml(ir)`, used by the web preview and the visual regression tests | Phase 3 |
| `apps/web` | Node + browser | UI, API, job store | Phase 7 |
| `apps/figma-plugin` | Figma | Bundle import, fonts, node building, post-build checks | Phase 2+ |
| `fixtures/site` | Node | Next.js fixture app (10 pages + hostile pages) with expectations | Phase 2+ |

Packages are created in the phase that first needs them. Nothing is scaffolded ahead of time.

## 7. Data flow

1. Input: `URL × viewport`.
2. Navigate (30s cap), then settle.
3. Capture produces:
   - a `RawSnapshot`: a flat element list with rects, whitelisted computed styles, text line rects, image sources, sanitized SVG, and the React fiber name if present;
   - asset bytes;
   - a full-page screenshot.
4. Convert: `snapshotToIR` → `flatten` → `inferLayout` → `orderChildren` gives a validated IR `Document`.
5. Package as a `Bundle { format, ir, assetData: { sha256 → base64 } }`.
6. The plugin runs `parseBundle`, resolves fonts, builds, then reports.

## 8. Rendering strategy

**Decision: Playwright Chromium, run on the user's machine, with URL input.** See [ADR-001](adr/001-rendering-strategy.md). Options considered:

| Option | Verdict |
|---|---|
| A. In-browser DOM inspection | **Used** as the extraction mechanism ([ADR-002](adr/002-extraction-mechanism.md)) |
| B. Playwright/Chromium | **Chosen runtime** |
| C. Browser extension | V2, for authenticated pages; reuses the collector unchanged |
| D. Next.js integration | Rejected: couples us to Next internals, and it's the same DOM anyway |
| E. User-provided URL | **Chosen input** |
| F. Local project integration | Deferred: runs untrusted scripts |
| G. Figma plugin fetching the URL | Rejected: can't read cross-origin DOM, and framing gets blocked |
| H. Hybrid | B + E now, C later |

## 9. Technology

| Concern | Choice | Not chosen |
|---|---|---|
| Language | TypeScript 7 strict (`noUncheckedIndexedAccess`) | — |
| Runtime | Node ≥ 20.19 (CI: Node 24 LTS) | — |
| Monorepo | pnpm workspaces | Turborepo/Nx (add when build time hurts) |
| Web | Next.js App Router, Node runtime, `serverExternalPackages: ['playwright']` | Separate Express server |
| Browser automation | Playwright, Chromium only | Puppeteer |
| Schema | Zod 4 (+ `z.toJSONSchema`) | io-ts, ajv-first |
| Bundling (collector, plugin) | esbuild | webpack, vite |
| Test | Vitest 4, Playwright, pixelmatch | Jest |
| Lint/format | Biome | ESLint + Prettier |
| Image processing | The Chromium we already run (canvas) | sharp (native dependency) |
| Web state | React state + polling | Redux/Zustand/React Query |
| Storage | In-memory + `.data/` | Postgres/Redis/S3 |
| Plugin UI | Vanilla TS | React |

Vitest is pinned to 4.x because Vitest 5 requires Node ≥ 22.12. We'll move to 5 once local Node is upgraded.

## 10. Repository structure

```
web-to-figma/
  apps/web/              Next.js UI + API                    (Phase 7)
  apps/figma-plugin/     manifest, code.ts, ui, map/*.ts     (Phase 2)
  packages/ir/           schema, diagnostics, migrations, bundle, validate
  packages/capture/      browser, policy, settle, assets, collector, cli
  packages/convert/      snapshot-to-ir, css parsers, flatten, layout, order
  packages/preview/      IR → HTML
  fixtures/site/         Next.js fixture app + hostile pages
  tests/                 repo-level consistency tests (docs ↔ code)
  docs/                  this documentation + adr/
```

Each package boundary is a **runtime** boundary: page, Node, pure, or Figma. `convert` never depends on Playwright or Figma, so the core logic is unit-testable in milliseconds.

## 11. Risk register

| Risk | L | I | Mitigation |
|---|---|---|---|
| CSS layout ≠ Auto Layout | H | H | Verify-by-simulation, absolute fallback ([ADR-004](adr/004-layout-mapping.md)) |
| Text wraps differently in Figma | H | M | Fixed widths for multi-line text, `TEXT_REFLOW` check, font report |
| Fonts missing in Figma | M | M | Stack matching, Google Fonts coverage, substitution warnings |
| Pseudo-elements not measurable | M | M | Warning now; CDP fallback if the fixtures need it |
| Stacking contexts misordered | M | M | Per-parent z-order, a hostile fixture |
| Figma SVG/image import limits | M | L | Raster crop fallback; pre-transcode and downscale |
| Figma `GRID` API typings evolve | M | L | Verify at Phase 6 start; absolute fallback |
| Local server abused (CSRF/rebinding) | L | H | Host/Origin guard, JSON only, 127.0.0.1 bind |
| Huge pages slow Figma | M | M | Caps, flatten, chunked build |
| Playwright bundled into Next routes | L | M | `serverExternalPackages`, browser singleton on `globalThis` |
| Competing product exists | — | H | Product decision; flagged above |

## 12. V1 limitations

- Everything in the Partial and Unsupported columns of §3.
- One settled state per capture (no hover or open states).
- No auth beyond a pasted cookie.
- No components or variables.
- One frame per viewport (no responsive reconstruction).
- Local use only.
- The Figma-side visual comparison is semi-automated.

## 13. Roadmap

- **V1.1:** plugin pull-by-code with a pairing token; pseudo-elements via CDP; project-folder mode.
- **V2:** browser extension reusing the collector (authenticated pages); hosted mode with an egress-sandboxed worker.
- **Later:**
  - repeated structure → Figma components;
  - CSS variables → Figma variables and tokens;
  - multi-breakpoint frames;
  - React fiber → component mapping;
  - Figma REST-based visual tests;
  - opt-in AI-assisted grouping as an offline step.
