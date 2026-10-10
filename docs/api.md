# Local API (deferred to Phase 7b; not implemented in V1)

> Design record for the future web UI. Nothing below exists in the code; the V1 interface is the CLI (see the README).

All routes:
- run in the Node runtime;
- sit behind the Host/Origin guard ([security.md](security.md));
- validate input and output with Zod;
- accept `application/json` only.

```
POST /api/conversions
  body { targets: [{ url }] (1–10),
         viewports: [{ width 240–3840, height 240–4000, dpr 1|2 }] (1–3),
         options?: { cookieHeader?, waitForSelector?, extraSettleMs?: 0–5000 } }
  202 { id }
  400 { diagnostics: Diagnostic[] }      invalid input or URL_BLOCKED
  403                                    guard rejected Host/Origin
  429                                    2 jobs already running

GET /api/conversions/:id
  200 { id, status: "queued"|"running"|"done"|"failed", stage, progress: 0–1,
        captures: [{ id, url, viewport, summary: { domNodes, irNodes, assets, fonts } }],
        diagnostics: Diagnostic[] }
  404

GET /api/conversions/:id/bundle               200 application/json (Content-Disposition: attachment; *.w2f.json)
GET /api/conversions/:id/captures/:cid/ir     200 IR Document (for the preview)
GET /api/conversions/:id/assets/:assetId      200 image bytes (screenshot, preview images)
```

- **Progress.** The client polls `GET /api/conversions/:id` every 500 ms. No SSE or websockets.
- **State.** Jobs live in an in-memory `Map`, artifacts in `.data/jobs/<id>/` (24 h TTL, swept at startup).
- **Errors.** Always `Diagnostic[]` ([diagnostics.md](diagnostics.md)), never bare strings.
