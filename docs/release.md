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

## Share without publishing

`pnpm share` builds the plugin and the extension, then writes two files to the gitignored `share/` folder:
- `web-to-figma-<version>-<commit>.zip` holds `INSTALL.txt`, `figma-plugin/` and `extension/`. Send it to someone who doesn't have the source.
- `extension-store-upload.zip` has the extension files at the root, ready for addons.mozilla.org signing (an unlisted upload gives a permanent Firefox install) or the Chrome Web Store.

Both parts must come from the same build, so resend the whole zip after changes. The plugin in it is the dev build, so its URL import needs a capture service on the friend's machine; the extension route needs nothing else.

## Publish the extension

Not published yet; users load it unpacked ([extension.md](extension.md)). `pnpm share` writes `share/extension-store-upload.zip` (the built extension with `manifest.json` at the root), which is what both stores take. Icons are in `apps/extension/icons` (`icon.svg` is the source; `node icons/render.mjs` redraws the PNGs).

**Firefox, signed but unlisted** (installs permanently, no public listing):
1. Sign in at addons.mozilla.org (a free account), open the Developer Hub and choose **Submit a New Add-on**.
2. Choose **On your own** (self-distribution), upload `extension-store-upload.zip`, and answer the source-code question: the build is minified, so upload a zip of the repository source with the build steps (`pnpm install`, `pnpm extension:build`) if asked.
3. Signing is automatic and usually takes minutes. Download the signed `.xpi`; dropping it on Firefox (or opening it via `about:addons` → gear → **Install Add-on From File**) installs it for good.
4. Updates: bump `version` in the manifest, rebuild, upload again. The add-on id `web-to-figma@w2f.local` must not change.

**Chrome Web Store:**
1. In the Chrome Web Store developer dashboard (one-time registration fee): upload `extension-store-upload.zip`, and fill in the listing, the privacy practices and a privacy policy. Nothing is collected or sent: the capture stays on the device until the user downloads or copies it.
2. Justify each permission: `activeTab` + `scripting` to read the page the user captures; `<all_urls>` host access to read that page's images from any origin with the user's cookies. Broad host access gets a longer review.
3. Updates: bump `version` in the manifest, rebuild, upload.

## Post-release

- Update `docs/development.md` phase log, `docs/architecture.md` roadmap (V1.1, V2).
- Never commit real-app reports or bundles: they live in the gitignored `.data/`
  (see [testing.md](testing.md)).
