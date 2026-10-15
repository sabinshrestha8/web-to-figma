# web-to-figma

Convert a rendered React/Next.js page into an **editable** Figma design: real frames, text, vectors and Auto Layout, not a screenshot.

```
Rendered web UI → DOM + computed layout → UI IR (versioned, neutral) → Figma plugin → editable design
```

**Status:** V1 ready. Phase 10 added URL import in the Figma plugin through a deployable capture service (not yet deployed or published). Phase 11 added a browser extension (Firefox, Chrome, Edge) that captures the open tab, logged in or not (not yet on the add-on stores). Pages convert end to end with **verified Auto Layout**: flex, wrap, baseline rows, block stacking and grids become stacks and fixed-track grids wherever a simulation reproduces the measured positions within 1 px, absolute positioning elsewhere. Boxes carry borders, radii, gradients (blended like CSS), shadows, blurs, opacity, blend, clipping, rotation and z-order. Each paragraph is one editable text layer with style runs, and CSS ellipsis truncation becomes Figma's native truncation (IR 1.4). Images are real image fills, inline SVG icons are editable vectors, and canvas, video and iframes arrive as raster islands. Captured pages can be diffed node by node against an older capture or against a Figma frame. See [docs/development.md](docs/development.md).

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

To capture a state that needs a click (a form dialog, a menu, a tab), pass `--click <selector>` (repeatable, clicked in order after the page settles), e.g. `--click 'button:has-text("Add employee")' --wait-for '[role=dialog]'`. Any Playwright selector works. A click that finds nothing within 15 s is a warning, and the page is captured without it. With clicks, the capture keeps the requested viewport (the screen behind a dialog does not scroll), so an app that scrolls inside an element is not grown to full height. In the web UI, put one selector per line in **Click first**. A button that first selects a tab or mode and opens the form on a second press needs its selector twice.

For pages that load content late, `--wait-for <selector>` (repeatable; all selectors share one 60 s budget) and `--extra-settle-ms <ms>` hold the capture until it's there.

### Capture a page behind a login

The capture runs in its own fresh browser, so your normal browser login doesn't carry over (you'd get the login page and a `PAGE_REDIRECTED` warning). To capture a logged-in page, save a session once, then pass it in:

```sh
pnpm w2f:login https://app.example.com/login
# log in in the browser window that opens, then close the window: saves .data/auth.json
pnpm w2f https://app.example.com/dashboard --storage-state .data/auth.json -o dashboard.w2f.json
```

`auth.json` holds live session cookies and localStorage, so treat it like a password. Keep it in `.data/` (gitignored) and delete it when you're done. The tool only reads it; it's never copied into the bundle or logs.

### Web UI (no terminal per command)

```sh
pnpm web   # http://127.0.0.1:4317
```

Enter URLs and viewports, watch progress, compare each capture's screenshot with its IR preview, filter the diagnostics table, and download the bundle.

To capture a logged-in page from the UI instead, open the **Saved session** card and enter the login URL: a browser window opens on your machine — log in there, then close it. Tick **Capture with the saved session** on later captures. It reads and writes the same `.data/auth.json` as `pnpm w2f:login`, so the two are interchangeable; treat the file like a password.

### Import into Figma (desktop app)

1. `pnpm plugin:build` — again after every pull: a bundle only imports into a plugin built from the same checkout.
2. In Figma: **Plugins → Development → Import plugin from manifest…**, then pick `apps/figma-plugin/manifest.json`.
3. Run **Web to Figma (dev)** and drop the `.w2f.json` file onto it, or import a URL directly (next section).

### Import a URL straight from the plugin

```sh
W2F_ALLOW_PRIVATE=1 pnpm server   # the capture service on http://localhost:8787 (ALLOW_PRIVATE only for localhost pages)
```

In the plugin, enter a URL, pick a viewport and press **Import website**. The service renders the page, the plugin downloads the bundle and builds it, with real progress and a Cancel button. **Options** takes click-first and wait-for selectors (for a dialog) and an access token. Deployed, the same service lets Community users import public pages with nothing installed. For pages behind a login, start it with your saved login and a token (`W2F_SESSION=.data/auth.json W2F_API_TOKENS=<token> pnpm server`), then paste the token under **Options → Access token** ([details](docs/hosting.md#pages-behind-a-login-service-on-your-own-machine)), or use the browser extension (next section). Deploying, env vars, the API and publishing: [docs/hosting.md](docs/hosting.md).

### Capture the page you're looking at (browser extension)

The extension captures the tab you have open, exactly as you see it: **logged-in pages, open dialogs and menus**, and dashboards whose inner panel scrolls. It uses your browser's own login, and nothing leaves your machine.

| Browser | Status |
|---|---|
| Firefox 128+ | Works (tested end to end with Figma desktop) |
| Chrome 121+, Edge, Brave, Opera, Vivaldi | Works in Chromium (automated tests); same engine, not tried in each browser |
| Safari, mobile browsers | Not supported |

**1. Build it** (again after every pull, together with `pnpm plugin:build`):

```sh
pnpm install
pnpm extension:build   # writes apps/extension/dist
```

**2. Load it.** It isn't on the add-on stores yet:
- **Firefox:** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `apps/extension/dist/manifest.json`. Firefox removes temporary add-ons when it restarts, so load it again after a restart. After a rebuild, click **Reload** on its card.
- **Chrome / Edge / Brave:** open `chrome://extensions` (Edge: `edge://extensions`) → turn on **Developer mode** → **Load unpacked** → pick the `apps/extension/dist` folder. After a rebuild, click the reload icon on its card.
- Optional: pin **Web to Figma** to the toolbar from the puzzle-piece (extensions) menu.

**3. Capture:**
1. Open your page in a normal tab and wait until it has loaded. Log in, and open the dialog or menu if you want it in the design.
2. On that tab, press **Alt+Shift+F**, or click the **Web to Figma** toolbar button.
3. A **Web to Figma** result tab opens. If Firefox asks, choose **Allow access to the page's images**. Wait for **Ready**.

**4. Import into Figma.** In Figma desktop, run **Plugins → Development → Web to Figma (dev)** (setup in the previous section), then either:
- choose **Download .w2f.json** and drop the file onto the plugin, or
- choose **Copy for the plugin**, click the plugin's paste box (*"Copied with the browser extension? Click here and press Ctrl+V."*) and press **Ctrl+V**.

Then click **Build** if the plugin asks about fonts.

**Good to know:**
- The frame is as wide and tall as your browser window. For a mobile frame, open DevTools' responsive/device mode first.
- The page is scrolled through once (and back), so sections that fade in on scroll are captured. Pages that scroll inside a panel are captured in full. With a dialog open, you get just the screen.
- Canvas, video and iframes are copied from screenshots, taken further down the page for those below the window. One larger than the window becomes a placeholder; one hanging off the window's edge keeps just the part on screen.
- Browser pages can't be captured: error pages ("Problem loading page"), `about:`/`chrome://` pages, add-on stores and PDFs.

Sending it to someone without the source: [Share the plugin and extension](#share-the-plugin-and-extension).

More details, limits and permissions: [docs/extension.md](docs/extension.md).

The plugin builds one frame per capture inside a Section. Each frame contains a hidden, locked **Reference screenshot** layer: unhide it to compare against the browser.

### Share the plugin and extension

To give the Figma plugin and the browser extension to someone who doesn't have the source:

```sh
pnpm share
```

It builds both, then writes two files to the gitignored `share/` folder:
- `web-to-figma-<version>-<commit>.zip` holds `INSTALL.txt`, `figma-plugin/` and `extension/`. Send this one. They unzip it somewhere they'll keep it and follow `INSTALL.txt`: import `figma-plugin/manifest.json` in Figma desktop, load `extension/` in their browser, then capture with **Alt+Shift+F**.
- `extension-store-upload.zip` has the extension files at the root, for addons.mozilla.org signing or the Chrome Web Store ([docs/release.md](docs/release.md)).

Commit first: a build from uncommitted changes still works, but it's labelled "with uncommitted changes" and the commit in the name won't identify it. After a fix, run `pnpm share` again and send the new zip. Both parts must come from the same zip. They replace the old folder with the new one, then reload the extension (`chrome://extensions` reload icon, or **Load Temporary Add-on…** again in Firefox). The plugin's URL import needs a capture service; the extension route needs nothing else.

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

Results land in `.data/drift/`: `report.html` (changes grouped by kind with baseline/now crops, trend, gate result), `history.jsonl`, and per page the baseline, latest capture and `diff.png`. It exits 1 when a page fails or goes over a threshold (`maxChanges`, `maxPixelPercent`, `maxFigmaChanges`, top-level or per page), so it can gate CI. Figma is compared when `FIGMA_TOKEN` is set. To run it on a schedule, use cron, Task Scheduler or a CI job. `storageState` is relative to the config file. `click` (a list of selectors) watches a state behind a click, such as a form dialog.

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
| [api.md](docs/api.md) | Local web app HTTP API |
| [extension.md](docs/extension.md) | Browser extension: capture the open tab (logged-in pages, dialogs) |
| [hosting.md](docs/hosting.md) | Hosted capture service: API, run, deploy, env vars, plugin release |
| [release.md](docs/release.md) | V1 release checklist, fresh-machine install, plugin publish |
| [development.md](docs/development.md) | Workflow, phase plan, Definition of Done, phase log |
| [adr/](docs/adr) | Architecture decision records |
