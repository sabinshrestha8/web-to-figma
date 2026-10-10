# Testing strategy

`pnpm test` runs Vitest across the whole repo (any `*.test.ts`). `pnpm check` = typecheck + lint + test, which is what CI runs.

| Level | Tool | Covers | From |
|---|---|---|---|
| Unit | Vitest | IR schema, validation, migrations, bundle | Phase 1 ✓ |
| Unit | Vitest | CSS parsers (color, shadow, gradient, border, radius, filter, transform, font), `bakeScale`, `flatten`, z-order, `rasterPlan` ✓ (Phase 3); inline formatting contexts, white space, decorations, text-shadow, next/font names, plugin font plan and `TEXT_REFLOW` ✓ (Phase 4); **layout simulator** (table-driven), z-order, plugin `map/*` (IR → Figma prop objects), URL policy (IP encodings, IPv6, redirects), Host/Origin guard | Phases 2–7 |
| Consistency | Vitest (`tests/`) | `docs/ir.schema.json` matches Zod; every diagnostic code is documented | Phase 1 ✓ |
| Integration | Vitest + Playwright | `tests/fixture-server.ts` (Vitest globalSetup) serves the prebuilt `fixtures/site` on `127.0.0.1:4400` → capture → convert. Phase 2 has structural assertions (`packages/capture/src/capture.int.test.ts`); normalized IR snapshots come with more fixtures | Phase 2 |
| Visual regression | Playwright | `packages/capture/src/fidelity.int.test.ts`: the reference screenshot vs a screenshot of `renderIRToHtml(ir)` (`@w2f/preview`). The preview is drawn in a shadow root over the original page so its webfonts are loaded. `comparePngs` decodes both PNGs on a canvas in an offline Chromium page, with no image dependency; a pixel mismatches when any channel differs by more than 32. Budget ≤ 5% per fixture. Measured: landing 0.01%, card-grid 0.02%, boxes 0.13%, article 0.00%, image-heavy 0.09%, svg-icons 0.03%, nav 0.01%, form 0.13%, dashboard 0.00%. A guard test proves an emptied IR exceeds the budget. The boxes fixture also has IR assertions for every box property | Phase 3 ✓ |
| Figma integration | Manual + script | Select the built frame, then the plugin's **Export selected frame (PNG)** button exports it at 1× (`exportAsync`). `pnpm compare .data/x.w2f.json export.png [-o .data/diff.png] [--max 5]` diffs it against the bundle's reference screenshot (or pass two PNGs). Exits non-zero over `--max` | Phase 3 ✓ |
| Drift | CLI | `pnpm drift .data/old.w2f.json .data/new.w2f.json [-o .data/drift.md] [--max N]`: node-level diff of two captures of the same page (moved, resized, text, restyled, layout, added, removed), 1 px geometry tolerance. `pnpm figma-drift --file KEY --node FRAME_ID --bundle .data/prod.w2f.json`: the same report for a Figma frame (read-only REST, needs `FIGMA_TOKEN` with `file_content:read`) against a production capture. Style compares tolerate a Figma round trip (float colors, recomputed gradient angles, image bytes unknown). Reports of real apps hold their structure: keep them in `.data/`, never commit them. `pnpm drift:run` repeats both for a config of pages against stored baselines; `drift-run.int.test.ts` runs the full baseline → pass → fail → accept loop on the fixture site, and the `/live` fixture (a clock and random bars) proves `ignore`: noisy without it, 0 changes and 0% pixels with it | Phase 6 ✓, 7 ✓ |
| Security | Vitest + hostile fixtures | Done in Phase 2: redirect to metadata, two-hop redirect chain, and blocked subresource (`fixtures/site/app/hostile/*`); URL policy table tests (`policy.test.ts`). Still to come: infinite loop → `TIMEOUT`; 50k elements → `PAGE_TOO_LARGE`; huge image → `ASSET_REJECTED`; redirect to `169.254.169.254` → blocked; cross-origin POST → 403 | Phase 8 |
| Performance | Integration | §Performance budgets in [security.md](security.md), with CI margins | Phase 8 |

## Why the Figma side is semi-automated

The Figma plugin API only exists inside Figma. Automation has two parts:
1. Everything up to "plain Figma property objects" is pure and unit-tested.
2. The remaining thin `build.ts` is checked by running the plugin on the fixture bundles and diffing exported PNGs.

Full automation via the Figma REST images API is on the roadmap.

## Fixtures (`fixtures/site`, Next.js App Router + Tailwind v4; one page uses CSS Modules)

| # | Fixture | Expected behavior (summary) |
|---|---|---|
| 1 | landing | Hero, CTA buttons as horizontal stacks; text runs for mixed-weight headings |
| 2 | card-grid ✓ | Grid → `grid` layout with 6 single-cell children; card radius + shadow |
| 3 | dashboard ✓ | Sidebar + main as horizontal stack, main fill; stat cards row with flex-grow; a chart canvas → `RASTERIZED` |
| 4 | nav ✓ | Sticky header as a horizontal `space-between` stack; hero CTA row as a centered stack |
| 5 | form ✓ | Vertical field stack; inline checkbox row; end-aligned actions; native checkbox → `RASTERIZED` |
| 6 | article ✓ | A wrapped paragraph with strong/em/link/colored span is one text node with a run per style; del/ins decorations; `<br>`; title text-shadow; padded `<code>` stays a box; an uninstalled font stays first in the stack for the font report (`fidelity.int.test.ts`) |
| 7 | mobile | Captured at 390×844; vertical stacks |
| 8 | image-heavy ✓ | PNG/JPEG/WebP, `<picture>`, next/image, SVG-as-img, `data:` URL, lazy image below the fold, rounded+bordered avatar, a 5000 px image (downscaled to 4096); object-fit cover/cover-top (crop)/contain/fill/none (crop); background cover/contain/tile/gradient-over-image; one 404 → `IMAGE_FAILED` placeholder and no raster islands (`fidelity.int.test.ts`). Images generated with Chromium's canvas |
| 9 | svg-icons ✓ | Stroke icons with `currentColor`, a class-set stroke width, a `<symbol>`/`<use>` sprite, class fills with a `display:none` shape, a gradient with a class-set `stop-color`, `<text>`, an inline icon; a hostile svg (script, `onload`/`onclick`, `<style>`, foreignObject, external `<image>`, `javascript:` link, `<animate>`). All become vectors with fallbacks; nothing hostile survives |
| 10 | nested-complex | Deep nesting, absolute overlays, z-index ordering, margins → measured or absolute fallback |

Each fixture's expectations will live in an `expect.ts` next to the page. For now (Phase 2, one fixture) they're in `capture.int.test.ts`.

## Rules

- Tests live next to the code (`*.test.ts`).
- Table-driven tests for parsers and layout.
- Never skip a test silently. If an environment can't run something (e.g. Figma), the phase report says so.
