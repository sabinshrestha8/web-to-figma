# web-to-figma

Convert a rendered React/Next.js page into an **editable** Figma design: real frames, text, vectors and Auto Layout, not a screenshot.

```
Rendered web UI → DOM + computed layout → UI IR (versioned, neutral) → Figma plugin → editable design
```

**Status:** V1 released (Phase 9 of 9). Pages convert end to end with **verified Auto Layout**: Pages convert end to end with **verified Auto Layout**: flex, wrap, baseline rows, block stacking and grids become stacks and fixed-track grids wherever a simulation reproduces the measured positions within 1 px, absolute positioning elsewhere. Boxes carry borders, radii, gradients (blended like CSS), shadows, blurs, opacity, blend, clipping, rotation and z-order. Each paragraph is one editable text layer with style runs, and CSS ellipsis truncation becomes Figma's native truncation (IR 1.4). Images are real image fills, inline SVG icons are editable vectors, and canvas, video and iframes arrive as raster islands. Captured pages can be diffed node by node against an older capture or against a Figma frame. See [docs/development.md](docs/development.md).

## Quickstart (development)

```sh
pnpm install
pnpm browsers   # installs Playwright's Chromium
pnpm check   # typecheck + lint + unit + integration (builds the fixture site)
```

Requires Node ≥ 20.19 and pnpm 9.

### Capture a page

```sh
pnpm w2f http://localhost:3000/ -v 1440x900 -v 390x844@2 -o my-page.w2f.json
```

This writes one bundle with one capture per viewport, to `.data/my-page.w2f.json`: bare file names (here and in `compare`, `drift`, `figma-drift`) live in the gitignored `.data/`, and are read from there when not in the current folder. A path with a folder (`./x.w2f.json`, `out/x.png`) is used as given. Diagnostics go to stderr. `--block-private` applies the hosted-mode network policy.

For pages that load content late, `--wait-for <selector>` (repeatable; all selectors share one 60 s budget) and `--extra-settle-ms <ms>` hold the capture until it's there.

### Capture a page behind a login

The capture runs in its own fresh browser, so your normal browser login doesn't carry over (you'd get the login page and a `PAGE_REDIRECTED` warning). To capture a logged-in page, save a session once, then pass it in:

```sh
pnpm w2f:login https://app.example.com/login
# log in in the browser window that opens, then close the window: saves .data/auth.json
pnpm w2f https://app.example.com/dashboard --storage-state .data/auth.json -o dashboard.w2f.json
```

`auth.json` holds live session cookies and localStorage, so treat it like a password. Keep it in `.data/` (gitignored) and delete it when you're done. The tool only reads it; it's never copied into the bundle or logs.

### Import into Figma (desktop app)

1. `pnpm plugin:build`
2. In Figma: **Plugins → Development → Import plugin from manifest…**, then pick `apps/figma-plugin/manifest.json`.
3. Run **Web to Figma (dev)** and drop the `.w2f.json` file onto it.

The plugin builds one frame per capture inside a Section. Each frame contains a hidden, locked **Reference screenshot** layer: unhide it to compare against the browser.

### Measure Figma fidelity

Select a built frame and click **Export selected frame (PNG)** in the plugin, then:

```sh
pnpm compare my-page.w2f.json export.png -o diff.png   # % of pixels differing from the reference screenshot
```

The diff PNG shows mismatching pixels in red. `--max 5` makes it exit non-zero above 5%, `--capture 1` diffs the second viewport.

### Detect drift

Node-level changes (moved, resized, text, restyled, layout, added, removed), as a Markdown report:

```sh
pnpm drift before.w2f.json after.w2f.json -o drift.md            # two captures of the same page
FIGMA_TOKEN=… pnpm figma-drift --file KEY --node FRAME_ID --bundle after.w2f.json -o drift.md   # Figma frame vs production
```

`--capture N` picks the viewport (default 0) and `--max N` exits non-zero above N changes. `figma-drift` reads the frame through the read-only REST API; the token needs `file_content:read`.

### Watch pages for drift

List the pages in `.data/drift.config.json`:

```json
{
  "maxChanges": 0,
  "maxPixelPercent": 1,
  "pages": [
    { "name": "dashboard", "url": "https://app.example.com/dashboard", "viewport": "1440x900",
      "storageState": "auth.json", "waitFor": ["[data-loaded]"],
      "ignore": ["header time", ".MuiChartsSurface-root"],
      "figma": { "file": "FILE_KEY", "node": "12:34" }, "maxFigmaChanges": 20 }
  ]
}
```

```sh
pnpm drift:run                 # capture every page, diff against its baseline (first run sets it)
pnpm drift:run --accept        # make this run the new baseline (after an intended change)
pnpm drift:run --page dashboard
```

Results land in `.data/drift/`: `report.html` (changes grouped by kind with baseline/now crops, trend, gate result), `history.jsonl`, and per page the baseline, latest capture and `diff.png`. It exits 1 when a page fails or goes over a threshold (`maxChanges`, `maxPixelPercent`, `maxFigmaChanges`, top-level or per page), so it can gate CI. Figma is compared when `FIGMA_TOKEN` is set. To run it on a schedule, use cron, Task Scheduler or a CI job. `storageState` is relative to the config file.

`ignore` lists CSS selectors of live content (clocks, dates, counters, charts). For those elements only position and size are compared, and their area is masked out of the pixel diff, so the gate stays quiet when only the data changed. A selector that is invalid or matches nothing is reported as `IGNORE_SELECTOR_UNUSED`. `pnpm w2f --ignore <selector>` does the same for one-off captures compared with `pnpm drift`.

## Docs

| | |
|---|---|
| [architecture.md](docs/architecture.md) | Product, scope matrix, system design, tech choices, risks, roadmap |
| [ir-schema.md](docs/ir-schema.md) | The intermediate representation + [ir.schema.json](docs/ir.schema.json) |
| [mapping.md](docs/mapping.md) | DOM → IR → Figma, layout verification rules, typography |
| [security.md](docs/security.md) | Threat model, limits, performance |
| [diagnostics.md](docs/diagnostics.md) | Error/warning codes, observability |
| [testing.md](docs/testing.md) | Test levels, fixtures, visual regression |
| [api.md](docs/api.md) | Local HTTP API (deferred design, not in V1) |
| [release.md](docs/release.md) | V1 release checklist, fresh-machine install, plugin publish |
| [development.md](docs/development.md) | Workflow, phase plan, Definition of Done, phase log |
| [adr/](docs/adr) | Architecture decision records |
