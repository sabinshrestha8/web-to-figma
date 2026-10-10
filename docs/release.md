# V1 release checklist

V1 is the CLI tool plus the Figma plugin (`pnpm w2f`, `compare`, `drift`, `figma-drift`, `drift:run`, `w2f:login`; no web UI, no npm packages, no hosted mode).

## Cut the release

1. `pnpm check` green on main; CI green on the release commit.
2. Fresh-machine install from the README succeeds (see below) — this is the Phase 9 gate.
3. `git tag v1.0.0 && git push --tags`.

## Fresh-machine install (the gate)

On a machine (or account) without the repo's `node_modules`, Playwright browsers or `.data/`:

```sh
git clone <repo-url> web-to-figma && cd web-to-figma
pnpm install
pnpm browsers   # Playwright's Chromium
pnpm check      # typecheck + lint + unit + integration (builds the fixture site)
pnpm plugin:build
```

Then end to end on the fixture site (or any URL): capture, import the bundle in Figma
desktop via **Plugins → Development → Import plugin from manifest…** with
`apps/figma-plugin/manifest.json`, export a frame PNG, `pnpm compare` it.

## Publish the plugin

1. `pnpm plugin:build`.
2. Make a publish copy of `apps/figma-plugin/`: replace `manifest.json` with
   `manifest.prod.json` (name `Web to Figma`). The prod `id` (`web-to-figma`)
   must never change after the first publish, or Figma treats it as a new plugin.
3. In Figma desktop: **Plugins → Development → Import plugin from manifest…**,
   then publish to Community from the plugin page. `networkAccess` stays
   `allowedDomains: ["none"]`: the plugin never touches the network, and the
   listing should say so.
4. Keep `manifest.json` (the `(dev)` one) for local development.

## Post-release

- Update `docs/development.md` phase log, `docs/architecture.md` roadmap (V1.1, V2).
- Never commit real-app reports or bundles: they live in the gitignored `.data/`
  (see [testing.md](testing.md)).
