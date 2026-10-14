# Hosted capture service + Figma plugin URL import

The plugin can import a page from its URL alone. Users don't clone, install or run anything, and they don't handle a bundle file. The plugin sends the URL to a hosted **capture service** (`apps/server`). The service renders the page with the same capture engine as the CLI and returns the same `.w2f.json` bundle. The plugin then validates and builds it with the same code path as a dropped file.

```
Figma plugin UI (null-origin iframe)
  POST   /api/captures            { url, viewports, click?, waitFor? }  → 202 { id, status }
  GET    /api/captures/:id        poll ~1 s → queued (position) | running (progress) | done | failed | cancelled
  GET    /api/captures/:id/bundle gzipped .w2f.json (same schema as the CLI)  → readBundle → main thread builds
  DELETE /api/captures/:id        Cancel button (also on closing an in-flight import)
apps/server (node:http)  ─►  @w2f/capture convertUrls({ hosted: true, allowPrivateNetworks: false })
```

Dropping a `.w2f.json` file still works, as a fallback and for local or logged-in captures made with the CLI or web UI.

## API

All responses are JSON with `access-control-allow-origin: *`. Figma plugin iframes have a `null` origin, so a wildcard is the only value that works. No cookies are used; auth is a bearer header, so the wildcard grants nothing extra. Errors look like `{ error, diagnostics? }`.

| Route | Result |
|---|---|
| `GET /healthz` | `{ ok, running, queued }` |
| `POST /api/captures` | `202` job view. `400` invalid input (`INVALID_INPUT`), non-JSON body, or blocked URL (`URL_BLOCKED`); `401` bad or missing token; `413` body over 16 KB; `429` (with `retry-after: 60`) when this client already has a capture running, the queue is full, or the hourly rate limit is reached |
| `GET /api/captures/:id` | `{ id, status, progress, position?, bundleBytes?, diagnostics }` |
| `GET /api/captures/:id/bundle` | The bundle, gzipped if the client accepts it. `409` until `done` |
| `DELETE /api/captures/:id` | Cancels a queued or running capture |

Request body (strict; unknown keys are rejected):
- `url`: up to 2000 characters; `https://` is added if no scheme is given.
- `viewports`: 1–3 of `desktop` (1440×900), `tablet` (768×1024), `mobile` (390×844 @2x), or `WxH[@dpr]`.
- `click`: up to 5 selectors, clicked in order (for example, to open a dialog).
- `waitFor`: up to 5 selectors.
- `extraSettleMs`: 0–5000.

Selectors are Playwright selectors, not scripts; there is no way to send JavaScript. Unknown or expired ids return `404`. Results are kept for `W2F_RESULT_TTL_MS` after they finish, then deleted from memory. Nothing is ever written to disk.

## Run the service locally

```sh
pnpm install && pnpm browsers
W2F_ALLOW_PRIVATE=1 pnpm server        # http://localhost:8787; ALLOW_PRIVATE only to capture localhost pages
pnpm plugin:build                      # dev build talks to http://localhost:8787
```

In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and pick `apps/figma-plugin/manifest.json`. Run **Web to Figma (dev)**, enter a URL, and choose **Import website**. The dev manifest allows only `http://localhost:8787`, with a `reasoning` string as Figma requires for localhost.

To point a dev build at another service, run `W2F_API_URL=https://staging.example.com pnpm plugin:build` and add that origin to `manifest.json` `networkAccess.allowedDomains`. The build warns you if you forget.

## Environment variables (`apps/server/.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen address |
| `W2F_MAX_RUNNING` | `2` | Captures at once (each Chromium context can peak at about 200–500 MB) |
| `W2F_MAX_QUEUED` | `8` | Waiting captures before `429` |
| `W2F_RATE_PER_HOUR` | `30` | Captures per client per hour (client = token, else IP) |
| `W2F_API_TOKENS` | empty | Comma-separated bearer tokens; empty = open service |
| `W2F_TRUST_PROXY` | `0` | `1` = client IP from `X-Forwarded-For` (only behind your own proxy) |
| `W2F_RESULT_TTL_MS` | `600000` | How long a finished result can be downloaded |
| `W2F_MAX_BUNDLE_MB` | `60` | Larger results fail with `PAGE_TOO_LARGE` |
| `W2F_CHROMIUM_SANDBOX` | `0` | `1` = Chromium's own sandbox (needs a runtime that permits it) |
| `W2F_ALLOW_PRIVATE` | `0` | **Development only.** `1` lets captures reach localhost and private networks |

Plugin build-time variables: `W2F_API_URL` (required for `--release`, https only, not localhost) and `W2F_PLUGIN_ID` (the id Figma assigns).

## Deploy

The service needs a host that can run Chromium: a container with about 2 GB of RAM for the default `W2F_MAX_RUNNING=2`, and long-running instances. It doesn't fit serverless functions. Results live in memory, so run **one instance**, or route every request for one job to the same instance (session affinity on the job id). Scale up by raising `W2F_MAX_RUNNING` along with memory.

```sh
docker build -f apps/server/Dockerfile -t w2f-server .
docker run --rm -p 8787:8787 --env-file apps/server/.env w2f-server
curl http://localhost:8787/healthz
```

The image is `mcr.microsoft.com/playwright:v1.64.0-noble`, matching `playwright` in `packages/capture`. It installs only the server's workspace slice, runs as `pwuser`, has a `HEALTHCHECK` on `/healthz`, and shuts down cleanly on `SIGTERM`. When you bump Playwright, bump the image tag with it.

Any container host works (Fly.io, Render, Railway, Google Cloud Run with minimum instances 1 and CPU always allocated, a VM with Docker):
1. Build from the repo root with the Dockerfile above.
2. Set the environment variables (secrets in the platform's secret store, never in the repo).
3. Expose the port over **https**.
4. Point the health check at `/healthz`.
5. Recommended: an egress firewall that drops private, link-local and metadata ranges (see [security.md](security.md)). It's a second layer under the app-level controls.

## Build and publish the plugin

```sh
W2F_API_URL=https://capture.example.com W2F_PLUGIN_ID=<id from Figma> pnpm plugin:release
```

This writes the gitignored `apps/figma-plugin/release/`, containing `manifest.json`, `dist/code.js` and `dist/ui.html`. The manifest's `networkAccess.allowedDomains` is exactly the service origin, and the dev-only "Export PNG" button is hidden. The build refuses http and localhost URLs. Then follow [release.md](release.md#publish-the-plugin).

## Limits and what hosted mode can't do

- **Public pages only.** Each capture starts in a fresh, empty browser context: the service has no way to receive your cookies, saved sessions or credentials, so pages behind a login capture as their logged-out state. For those, capture locally (`pnpm w2f:login` + `pnpm w2f`, or the web UI) and drop the bundle into the plugin.
- No localhost or private-network pages (by design). Use the local tools for those.
- WebSockets are closed, so live dashboards capture their initial state.
- One capture at a time per client. Queue and hourly limits apply.
