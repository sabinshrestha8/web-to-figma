# web-to-figma

Convert a rendered React/Next.js page into an **editable** Figma design: real frames, text, vectors and Auto Layout, not a screenshot.

```
Rendered web UI → DOM + computed layout → UI IR (versioned, neutral) → Figma plugin → editable design
```

**Status:** Phase 6 of 9: layout engine. Pages convert end to end with **verified Auto Layout**: flex, wrap, block stacking and grids become stacks and fixed-track grids wherever a simulation reproduces the measured positions within 1 px, absolute positioning elsewhere. Boxes carry borders, radii, gradients, shadows, blurs, opacity, blend, clipping, rotation and z-order. Each paragraph is one editable text layer with style runs (bold, italic, links, colors, decorations, text-shadow), and the plugin shows a font report before building. Images are real image fills (object-fit and background sizing mapped, WebP/AVIF/oversize transcoded), and inline SVG icons are editable vectors. Canvas, video and iframes arrive as raster islands. See [docs/development.md](docs/development.md).

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

This writes one bundle with one capture per viewport. Diagnostics go to stderr. `--block-private` applies the hosted-mode network policy.

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

The diff PNG shows mismatching pixels in red. `--max 5` makes it exit non-zero above 5%.

## Docs

| | |
|---|---|
| [architecture.md](docs/architecture.md) | Product, scope matrix, system design, tech choices, risks, roadmap |
| [ir-schema.md](docs/ir-schema.md) | The intermediate representation + [ir.schema.json](docs/ir.schema.json) |
| [mapping.md](docs/mapping.md) | DOM → IR → Figma, layout verification rules, typography |
| [security.md](docs/security.md) | Threat model, limits, performance |
| [diagnostics.md](docs/diagnostics.md) | Error/warning codes, observability |
| [testing.md](docs/testing.md) | Test levels, fixtures, visual regression |
| [api.md](docs/api.md) | Local HTTP API |
| [development.md](docs/development.md) | Workflow, phase plan, Definition of Done, phase log |
| [adr/](docs/adr) | Architecture decision records |
