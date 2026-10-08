# ADR-005: Figma integration and transport

**Status:** Accepted (2026-10-08)

## Context
Only the Figma Plugin API can create editable nodes in a file. Plugins run in a sandbox (main thread with the `figma` API) plus a UI iframe whose origin is `null`. Network access is declared in `manifest.json` (`networkAccess.allowedDomains`).

## Problem
How does the IR get from our local app into the plugin, and how is the plugin structured?

## Options considered
- **Transport:**
  - a file the user drops into the plugin;
  - the plugin pulls from `http://localhost:4317` by job code;
  - the plugin pulls from a hosted API;
  - the Figma REST API (it can't create nodes).
- **Structure:** monolithic builder vs **pure mapping functions + a thin builder**.

## Decision
- V1 transport is a **`.w2f.json` bundle file**, dropped or picked in the plugin UI and posted to the main thread. The manifest declares `allowedDomains: ["none"]`.
- `src/map/*.ts` are pure IR → Figma-property functions (unit-tested). `build.ts` creates nodes and assigns properties.
- Fonts are resolved and loaded up front, the build runs in chunks with progress, and post-build checks emit `TEXT_REFLOW`.

## Reasoning
- A file needs no CORS, auth or server, works offline, and leaks nothing.
- Pull-from-localhost is allowed by Figma (with `reasoning`). But a null-origin iframe means our API would serve CORS to *any* sandboxed page on the web, exposing captured data. Doing it safely needs a pairing token, which is V1.1.

## Consequences
- One extra user step (download, then drop).
- Bundle size is bounded (100 MB) by base64 images.

## Rejected alternatives
- Hosted pull: no hosted mode in V1.
- REST API: read-only for document nodes.
- React in the plugin UI: three screens don't need it.
