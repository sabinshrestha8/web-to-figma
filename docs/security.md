# Security, limits and performance

## Threat model (V1 = local tool)

1. The user points the tool at a **hostile page**, which runs arbitrary JS in our Chromium.
2. (Deferred to 7b: V1 has no local server.) **A malicious website the user visits** tries to drive the local app at `127.0.0.1:4317`, via CSRF or DNS rebinding, to make our browser fetch things.
3. A **crafted bundle** is loaded into the Figma plugin.

## Controls

| Boundary | Control |
|---|---|
| Local web app exposure (deferred to 7b; no server in V1) | Bind `127.0.0.1` only. Reject any request whose `Host` isn't `127.0.0.1:PORT` / `localhost:PORT` (defeats DNS rebinding). Reject a non-same-origin `Origin`. API accepts only `application/json` (forces a preflight, which we never grant). |
| URL policy (`capture/policy.ts`) | Schemes http/https only. **Always block** link-local `169.254.0.0/16` and `fe80::/10` (cloud metadata), `0.0.0.0/8`, multicast, broadcast. Loopback and private ranges are **allowed in local mode** (that's the use case) behind an `allowPrivateNetworks` flag that hosted mode turns off. Hostnames are resolved and IP encodings normalized (decimal, octal, hex, IPv4-mapped IPv6). |
| Subrequests and redirects | `context.route("**/*")` checks every request; `routeWebSocket` checks `ws:`. Requests are fetched with `maxRedirects: 0` and **redirects are never handed back to the browser**: Playwright does not route the follow-up request of a fulfilled 3xx (verified: Chromium went straight to the second hop). Subresource hops are followed in the handler, each `Location` checked, max 10, cookies/authorization dropped on cross-origin hops. Main-frame hops are aborted and re-navigated with `page.goto`, so each hop is a fresh routed request and the page keeps its real URL. A blocked main navigation is fatal; a blocked subresource is a warning. Regression test: `fixtures/site/app/hostile/redirect-chain`. |
| Untrusted page JS | Chromium sandbox **on** (never `--no-sandbox`). A fresh `BrowserContext` per job: no profile, no user cookies, `serviceWorkers: "block"`, `acceptDownloads: false`, permissions denied, dialogs auto-dismissed, popups closed. |
| Raster islands and tiles | Islands are screenshots of the already-loaded page, shown in isolation by an `!important` style the collector injects and removes afterwards. Page JS is still live, so a hostile page can change what its own crops show, but that only affects its own pixels, never anything outside the page. Pattern tiles render in a **separate context with JavaScript disabled and every request aborted**; their CSS is set through the DOM API (`style.backgroundImage`), never as markup, so a hostile `background-image` value can't inject elements or fetch anything. |
| Preview / visual-diff harness | `previewScreenshot` loads the URL **without** the capture network policy, so it's a test harness for trusted fixture pages only. It isn't exported from `@w2f/capture` and no product path calls it. |
| Untrusted SVG | Sanitized in the collector (`collector/svg.ts`, full list in mapping.md §1): `script`, `foreignObject`, `style`, `iframe`, animations, `on*`/`class`/`style` attributes, and every `href` or `url()` that isn't a fragment or an inline raster image are removed, so the markup can neither run nor fetch. Checked by the hostile icon in `fixtures/site/app/svg-icons` (and a mutation check: without the sanitizer that test fails). Figma's SVG parser doesn't execute script anyway; the preview shows vectors only through `<img>`, which never runs script. |
| Untrusted images | Bytes are the page's own responses, kept by the network guard (no second fetch, so no new request the policy didn't see; `data:` URLs decoded in Node). The format is sniffed from the bytes. Decoding runs in a **separate context with every request aborted**, in a blank page holding only our decoder, one image at a time with a 10 s timeout; a crashed or stuck decoder page is replaced and only that image is lost. SVG images render through `<img>`, which never runs script or loads subresources. Size limits below are checked before (bytes) and after (pixels) decoding. |
| Plugin input | `parseBundle` (Zod) is the only entry point. Node count ≤ 20,000. `createImage` re-validates the bytes. Manifest `networkAccess.allowedDomains: ["none"]`, so the plugin can't exfiltrate. |
| Credentials | `--storage-state <file>` (local mode only): a Playwright storage state (cookies + localStorage) saved by the user with `pnpm w2f:login <url>`. It's Zod-validated on load, and errors name fields, never values. It's loaded into that capture's fresh context only. The browser's own cookie rules decide where cookies go (their domain), and cross-origin redirect hops drop `cookie`/`authorization` headers. It's never written to the bundle or logs: an integration test asserts the session token isn't in the bundle. `pnpm figma-drift` reads `FIGMA_TOKEN` from the environment, sends it only to `api.figma.com` (one read-only `GET /v1/files/:key/nodes`), and never prints or stores it. |

## Limits (V1 defaults)

| Limit | Value | On breach |
|---|---|---|
| Concurrent jobs | 2 | HTTP 429 |
| Job wall clock | 90 s | `TIMEOUT` |
| Navigation | 30 s | `TIMEOUT` |
| Collector `evaluate` | 20 s | `TIMEOUT` |
| Elements per page | 15,000 | `PAGE_TOO_LARGE` |
| Capture height | 16,000 px | clip + `PAGE_HEIGHT_CLIPPED` |
| Images per capture (img, url() backgrounds, svg fallbacks) | 300 | extras → `ASSET_REJECTED` |
| Bytes per image | 10 MB | `ASSET_REJECTED` |
| Image response bytes held per capture | 100 MB | not kept → `ASSET_REJECTED` |
| Decoded pixels per image | 50 MP (output ≤ 4096 px per side) | reject / downscale |
| Decode time per image | 10 s | decoder page replaced, `ASSET_REJECTED` |
| SVG markup | 500 KB | raster fallback |
| Raster islands + tiles per capture | 200 | extras → `ASSET_REJECTED`, grey placeholder |
| Raster side | 4096 px (device pixels, else CSS pixels) | `ASSET_REJECTED`, grey placeholder |
| Bundle size | 100 MB | `PAGE_TOO_LARGE` |
| Plugin nodes per bundle | 20,000 | `BUNDLE_INVALID` |

All limits live in one constants module per package. There are no magic numbers inline.

## Hosted mode (not in V1)

App-level IP checks are TOCTOU-vulnerable to DNS rebinding: Chromium does its own resolution. A hosted deployment **requires** Chromium inside a container whose **egress firewall** drops loopback, private, link-local and metadata ranges at the network layer, plus per-tenant isolation. That's a prerequisite for ever enabling `allowPrivateNetworks: false` in production.

## Performance

- **Browser.** One Chromium, launched lazily and kept on `globalThis` (survives Next hot reload). About 1 s once, then each job gets a new context in about 50 ms.
- **Collector.** One `getComputedStyle` per element, whitelisted reads. Target: 5,000 elements in under 1 s.
- **Convert.** Pure and close to linear. Layout simulation is O(children) per container.
- **Figma.** Fonts load once up front; build in chunks of 200 nodes yielding between them; one undo step. Target: 3,000 nodes in under 10 s.
- **Node reduction.** Flatten plus inline text collapse; we expect a 40–60% reduction from DOM elements (measured on fixtures).
- **End-to-end budget.** A fixture page at 1440 px in under 8 s; the image-heavy bundle under 15 MB. Asserted in Phase 8.
