# V1 release checklist

V1 is the CLI tool plus the Figma plugin (`pnpm w2f`, `compare`, `drift`, `figma-drift`, `drift:run`, `w2f:login`). Since then: the local web UI (`pnpm web`) and the hosted capture service behind the plugin's URL import ([hosting.md](hosting.md)). Nothing is published to npm.

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

1. Deploy the capture service over https and check `GET /healthz`
   ([hosting.md](hosting.md#deploy)).
2. First time only: in Figma desktop, **Plugins → Development → New plugin…**
   to get a plugin **id** from Figma (the `id` in `manifest.prod.json` is a
   placeholder). That id must never change after the first publish, or Figma
   treats it as a new plugin.
3. `W2F_API_URL=https://<service> W2F_PLUGIN_ID=<id> pnpm plugin:release`
   writes `apps/figma-plugin/release/` (manifest + dist). Its
   `networkAccess.allowedDomains` is exactly the service origin.
4. **Plugins → Development → Import plugin from manifest…** with
   `release/manifest.json`. Test: import a public URL, cancel one, import a
   blocked URL (`http://localhost`) and see `URL_BLOCKED`, and drop a bundle.
5. Publish from the plugin's menu in Figma (**Publish**), filling in: description, cover art,
   icon, support contact, and the network-access explanation. It talks only to
   the capture service, which renders the public URL you enter and keeps the
   result for 10 minutes. Mention that logged-in pages need the local tools.
6. Updates: rebuild with the same id and URL, import, and **Publish new version**.
   If the service URL changes, the manifest's `networkAccess` changes too, so
   keep the old service running until users have updated.
7. Keep `manifest.json` (the `(dev)` one) for local development.

## Publish the extension

Not published yet; users load it unpacked ([extension.md](extension.md)). To list it on the Chrome Web Store:
1. Add icons (16, 48 and 128 px) to `apps/extension/manifest.json`; the store requires a 128 px icon.
2. `pnpm extension:build`, then zip the *contents* of `apps/extension/dist` (with `manifest.json` at the root of the zip).
3. In the Chrome Web Store developer dashboard: upload the zip, and fill in the listing, the privacy practices and a privacy policy. Nothing is collected or sent: the capture stays on the device until the user downloads or copies it.
4. Justify each permission: `activeTab` + `scripting` to read the page the user captures; `<all_urls>` host access to read that page's images from any origin with the user's cookies. Broad host access gets a longer review.
5. Updates: bump `version` in the manifest, rebuild, upload.

## Post-release

- Update `docs/development.md` phase log, `docs/architecture.md` roadmap (V1.1, V2).
- Never commit real-app reports or bundles: they live in the gitignored `.data/`
  (see [testing.md](testing.md)).
