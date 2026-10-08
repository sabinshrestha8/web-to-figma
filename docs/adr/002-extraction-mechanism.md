# ADR-002: Extraction mechanism

**Status:** Accepted (2026-10-08)

## Context
Inside the rendered page we need element boxes, computed styles, text line boxes, image sources and SVG markup.

## Problem
Use an injected script, or Chrome DevTools Protocol `DOMSnapshot.captureSnapshot`?

## Options considered
1. **Injected collector.** A zero-dependency TS module bundled to an IIFE and run via `page.evaluate`.
2. **CDP DOMSnapshot.** One call that returns the DOM, whitelisted computed styles, layout and text boxes, including pseudo-elements.

## Decision
The injected collector returns a `RawSnapshot` (a flat list). All interpretation happens later, in pure Node code (`packages/convert`).

## Reasoning
- Portable: the same file can become a browser-extension content script (the V2 path for authenticated pages).
- Uses standard DOM APIs (`getComputedStyle`, `getBoundingClientRect`, `Range.getClientRects`, canvas color normalization). Easy to debug in any DevTools.
- Keeping the collector "dumb" (it collects facts, never decides) means the hard logic is pure and unit-testable without a browser.

## Consequences
- `::before/::after` boxes can't be measured. That's a `PSEUDO_ELEMENT_SKIPPED` warning (a documented limitation).
- It's somewhat slower than CDP. Acceptable at the V1 limits (15k elements).

## Rejected alternatives
CDP DOMSnapshot: Chromium-only, unusable from an extension, and its output is harder to reason about. It stays the planned fallback **for pseudo-elements only** if the fixtures show they matter.
