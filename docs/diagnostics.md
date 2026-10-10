# Diagnostics, error handling and observability

The converter never fails silently. Anything that wasn't converted exactly is a `Diagnostic`:

```ts
{ code, severity: "fatal"|"error"|"warning"|"info", message,
  captureId?, nodeId?, detail?: Record<string, string|number>,
  fallback?: "absolute"|"rasterized"|"substituted"|"approximated"|"skipped"|"placeholder" }
```

| Severity | Meaning |
|---|---|
| fatal | The job (or the bundle import) stops. Nothing is produced. |
| error | One node lost a feature (e.g. a broken image); the conversion continues. |
| warning | Approximated: the output differs visibly or structurally from the source. |
| info | An expected, documented fallback. The output is visually right but less editable. |

## Aggregation

Converter warnings are grouped per capture: one diagnostic per (code, message), with `detail.count` and the first node as `nodeId`. A page with 300 shadowed buttons reports one line, not 300 (`packages/convert/src/report.ts`).

## Codes

Source: [`packages/ir/src/diagnostics.ts`](../packages/ir/src/diagnostics.ts). `tests/docs.test.ts` fails if a code is missing from this table or listed with the wrong severity.

| Code | Severity | When | Fallback |
|---|---|---|---|
| `NAVIGATION_FAILED` | fatal | Page didn't load (DNS, TLS, HTTP ≥ 400 on the document) | — |
| `URL_BLOCKED` | fatal | URL violates the network policy ([security.md](security.md)). A blocked **subresource** is downgraded to a warning (one per blocked URL) and the capture continues | `skipped` (subresource) |
| `TIMEOUT` | fatal | Navigation, evaluation or job wall clock exceeded | — |
| `PAGE_TOO_LARGE` | fatal | Element count above the cap | — |
| `BUNDLE_INVALID` | fatal | IR or bundle failed validation (the message carries the path) | — |
| `INVALID_INPUT` | fatal | The web API rejected the request body (shape or viewport ranges; the message carries the path) | — |
| `SCHEMA_VERSION_UNSUPPORTED` | fatal | IR major version newer than this build, or no migration exists | — |
| `FIGMA_BUILD_FAILED` | fatal | The plugin threw while creating nodes (error text in `message`); the partially built Section is removed | — |
| `IMAGE_FAILED` | error | An `<img>` failed in the page (404, undecodable) → grey placeholder; a background image the capture didn't get → layer skipped; a raster island with no pixels | placeholder / skipped |
| `ASSET_REJECTED` | error | An image or raster not used: over the size/pixel/count limits, unrecognized format, or not decodable by the isolated decoder. The element falls back to a raster island (img) or loses the layer (background) | placeholder |
| `SVG_IMPORT_FAILED` | error | Figma rejected the SVG markup. With a fallback PNG it's built instead and reported as a warning; without one, a grey placeholder | rasterized / placeholder |
| `FONT_SUBSTITUTED` | warning | The font used in Figma differs from the stack's first family, weight or italic (generic families like `sans-serif` always count). Once per requested style (family + weight + italic), also listed in the pre-build font report; `detail.from`/`detail.to`/`detail.runs` | substituted |
| `UNSUPPORTED_CSS` | warning | A property with visible effect has no mapping (`detail.property`), or the plugin can't build an IR feature yet (`detail.feature`, once per build) | approximated / skipped |
| `BORDER_COLORS_MIXED` | warning | Per-side border colors differ | approximated |
| `TEXT_REFLOW` | warning | A built Figma text node's height differs from the browser's by more than half a line (it wrapped differently: metrics, kerning, a substituted font), or hug text renders wider than measured and overflows a clipped parent (cut glyphs). Once per build per case; `detail.count`, `nodeId` of an example | approximated |
| `PSEUDO_ELEMENT_SKIPPED` | warning | `::before/::after` with visible content | skipped |
| `PAGE_HEIGHT_CLIPPED` | warning | Page taller than the capture height cap | — |
| `IGNORE_SELECTOR_UNUSED` | warning | An `ignore` selector (capture `--ignore`, drift config `ignore`) is not valid CSS or matched no element, so it ignores nothing (`detail.selector`) | — |
| `SCROLL_CONTAINER_EXPANDED` | info | The document doesn't scroll but a large inner element does (app-shell layout). The viewport was made taller until its content fits (`detail.capturedHeight`), so viewport-sized elements (100vh) are drawn that tall. The IR keeps the requested viewport | — |
| `PAGE_REDIRECTED` | warning | The captured URL differs from the requested one (server redirect, or the page navigated itself, e.g. an auth guard sending you to `/login`), or the page kept navigating past the settle limit (`detail.requested`/`detail.captured`) | — |
| `EMPTY_CAPTURE` | warning | The capture has no text and no elements besides `html`/`body`: usually a blank, loading or mid-navigation page. Check the reference screenshot | — |
| `RASTERIZED` | warning | canvas/video/iframe/native control captured as an image | rasterized |
| `LAYOUT_ABSOLUTE_FALLBACK` | info | Auto Layout candidate failed verification (`detail.reason`) | absolute |
| `NEGATIVE_ZINDEX` | info | A negative z-index has no Figma equivalent: kept in paint order, so Figma draws it above the parent fill (once per page; `detail.count`, `nodeId` of an example) | approximated |

## Rules

- Recoverable problems are returned as data: `Result<T> = {ok:true, value} | {ok:false, diagnostics}`, or `{ value, diagnostics }` for partial success. Only fatal conditions throw (Phase 2 adds a typed `ConversionError`).
- **Never a bare `catch {}`.** Every catch converts to a diagnostic or rethrows.
- New code → add it to `DIAGNOSTIC_CODES` **and** to this table.
- Validation diagnostics are capped at 20 per parse so a broken file doesn't flood the UI.

## Observability

One structured JSON log line per pipeline stage, from a ~10-line `log()` helper (no logging library):

```json
{"ts":"…","jobId":"…","stage":"extract","durationMs":412,"domNodes":2310,"irNodes":980,
 "diagnostics":{"LAYOUT_ABSOLUTE_FALLBACK":12,"FONT_SUBSTITUTED":1}}
```

Tracked: job start/end, duration per stage, DOM and IR node counts, diagnostic counts by code, image and font failures, plugin build failures (reported back to the UI). Query strings and cookies are never logged.
