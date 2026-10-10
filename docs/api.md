# Local API (implemented in Phase 7b)

All routes:
- run in the Node runtime;
- sit behind the Host/Origin guard ([security.md](security.md));
- validate input with Zod (failures are 400 `INVALID_INPUT`);
- accept `application/json` only.

```
POST /api/conversions
  body { targets: [{ url }] (1–10),
         viewports: [{ width 240–3840, height 240–4000, dpr 1|2 } | "1440x900" | "390x844@2"] (1–3),
         options?: { waitFor?: string | string[], extraSettleMs?: 0–5000 } }
  202 { id }
  400 { diagnostics: Diagnostic[] }      invalid input or URL_BLOCKED
  403                                    guard rejected Host/Origin
  429                                    2 jobs already running

GET /api/conversions/:id
  200 { id, status: "queued"|"running"|"done"|"failed", stage: "queued"|"capturing"|"done"|"failed",
        progress: 0–1, captures: [{ id, url, viewport, irNodes, assets, fonts, screenshot }],
        diagnostics: Diagnostic[] }
  404                                    unknown id

GET /api/conversions/:id/bundle               200 application/json (Content-Disposition: attachment; *.w2f.json)
GET /api/conversions/:id/captures/:cid/ir     200 { capture, assetUrls } (for the preview)
GET /api/conversions/:id/assets/:assetId      200 image bytes (screenshot, preview images)
```

Bundle, IR and asset reads 404 when the id is unknown or the job isn't done.

- **Progress.** The client polls `GET /api/conversions/:id` every 500 ms. No SSE or websockets.
- **State.** Jobs live in an in-memory `Map`, artifacts in `.data/jobs/<id>/bundle.json` (24 h TTL, swept at startup). A restart forgets running jobs; hot reloads in `next dev` do too.
- **Errors.** Conversion problems are `Diagnostic[]`; transport rejections (403/404/429) are `{ error }`.
- **Deviations from the 7b draft:** no `cookieHeader` (login stays in the CLI); no per-capture DOM node count (it would need a pipeline change for a table number); `stage` is coarse (`capturing` covers settling through converting, which the runner can't observe).
