# ADR-001: Rendering strategy

**Status:** Accepted (2026-10-08)

## Context
We need the *rendered* result of a React/Next.js page (the real DOM, computed styles and layout). Not its source code.

## Problem
Where and how is the page rendered so we can inspect it? The answer has to cover local dev servers and public sites, stay safe against untrusted pages, and keep V1 simple.

## Options considered
- **A.** Injected in-browser inspection
- **B.** Playwright/Chromium
- **C.** Browser extension or bookmarklet
- **D.** Next.js integration
- **E.** User-provided URL
- **F.** We start the user's project
- **G.** The Figma plugin loads the URL
- **H.** Hybrid

## Decision
**B + E**: Playwright Chromium, **running on the user's machine** inside the local app, rendering a user-supplied http(s) URL. Extraction uses **A** (an injected collector, see ADR-002).

## Reasoning
- The target users have their app on `localhost:3000`. A hosted renderer can't reach it; a local one can.
- Running locally removes SSRF against our own infrastructure as a V1 threat class.
- Playwright gives a real engine, plus control of viewport, DPR and reduced motion, plus network-level access to image bytes (no CORS), plus screenshots for raster fallback and diffing.
- A URL is framework-agnostic, so Vue/Svelte/plain HTML work for free.

## Consequences
- The user must have their app running. There's no auth beyond a pasted cookie header.
- The local app is a privileged service and needs Host/Origin guarding (ADR-006).
- A hosted mode later needs an egress-sandboxed worker.

## Rejected alternatives
- **C** (deferred to V2): best for authenticated pages, but it's a second distribution channel. The collector stays portable for it.
- **D**: couples us to Next internals and versions, and renders the same DOM anyway.
- **F**: runs untrusted install/build scripts; brittle (env vars, databases).
- **G**: the plugin iframe can't read cross-origin DOM, `X-Frame-Options` blocks framing, and there's no computed layout of another document.
