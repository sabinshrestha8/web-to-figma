# ADR-008: Asset handling

**Status:** Accepted (2026-10-08)

## Context
Pages reference images by URL: cross-origin, lazy-loaded, WebP/AVIF, sometimes huge. Figma's `createImage` accepts only PNG, JPEG and GIF, up to 4096 px per side, and the plugin has no network access (ADR-005).

## Problem
How do image bytes get from the page into Figma reliably and safely?

## Options considered
- The plugin fetches URLs.
- The server refetches URLs.
- **Capture response bytes inside the rendering browser.**
- In-page canvas reads (tainted by CORS).
- Transcode with `sharp` vs **with the same Chromium**.

## Decision
- Capture image response bytes at the network layer during rendering, keyed by URL.
- Transcode to PNG and downscale to ≤ 4096 px with canvas in the same Chromium.
- Asset ID = sha256 of the final bytes (dedupe).
- Ship as base64 in the bundle.
- Failures → placeholder + `IMAGE_FAILED` / `ASSET_REJECTED`.

## Reasoning
- No second fetch (works for authenticated and cookie-bound images) and no CORS.
- No native dependency.
- Same-content images are stored once.

## Consequences
- Base64 inflates the bundle by about 33%; bounded by the limits.
- Images that load after the settle window are missed (reported).

## Rejected alternatives
- The plugin or server refetching: CORS, auth, SSRF surface.
- `sharp`: native builds, Windows friction, duplicate decoding.
