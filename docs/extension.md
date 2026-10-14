# Browser extension (`apps/extension`)

The extension captures the page **you are looking at, in your own browser**, so logged-in pages, open dialogs and menus, and anything else on screen come along as they are. It makes the same `.w2f.json` bundle as the CLI, web UI and capture service, and the Figma plugin imports it by drop or paste. No server is involved, and nothing leaves your machine.

```
toolbar button / Alt+Shift+F
  service worker: captureVisibleTab (PNG of the viewport) → inject collector.js (isolated world) → collect()
  result.html (extension page): fetch images (your cookies) → decode → crop islands from the screenshot
                                → snapshotToIR → parseDocument → Download .w2f.json / Copy for the plugin
Figma plugin: drop the file, or Ctrl+V the copied bundle
```

## Install (unpacked, for now)

```sh
pnpm install
pnpm extension:build      # writes apps/extension/dist
```

In Chrome or Edge, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick `apps/extension/dist`. After a pull, run `pnpm extension:build` again and press the reload icon on the extension's card. A bundle imports into a plugin built from the same checkout.

## Use

1. Open the page and get it into the state you want: logged in, dialog open, scrolled to the top.
2. Click the **Web to Figma** toolbar button (pin it from the puzzle-piece menu), or press **Alt+Shift+F**. The shortcut doesn't move focus, so menus that close on blur stay open. You can change it at `chrome://extensions/shortcuts`.
3. A result tab opens and converts the capture. Choose **Download .w2f.json** and drop the file into the plugin, or choose **Copy for the plugin**, click the plugin window and press **Ctrl+V**.

The frame size is your window's viewport. For a mobile or tablet frame, open DevTools device mode at the size you want, then capture.

## Differences from the Playwright capture

Each of these shows up as a diagnostic in the result tab, never silently:

- **Only what's loaded now.** There's no navigation, settle or lazy-load scroll; the capture is the page as it is. App-shell pages whose `<main>` scrolls are captured at window height (the CLI unrolls them).
- **Raster islands** (canvas, video, iframes, native checkboxes, images that wouldn't decode) are crops of the visible-tab screenshot. Only on-screen ones are captured, and a crop includes anything drawn over the element. Off-screen ones become placeholders (`ASSET_REJECTED`): scroll to them and capture again.
- **Repeating background tiles** aren't rendered (`ASSET_REJECTED`); the CLI and web UI render them.
- **Images** are fetched again from the result page with your cookies. Images from `blob:` URLs, or that the server won't serve twice, become placeholders.
- **Reference screenshot:** only when the page is scrolled to the top, and only the visible part of it.

## Permissions (why each is needed)

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Run the collector in the tab you clicked the button on |
| `host_permissions: <all_urls>` | Read the page's images from any origin, with your cookies, as the tab did |

The collector runs in Chrome's isolated world, so page scripts can't see or tamper with it. It never sends anything anywhere. The capture is held in the service worker's memory until the result tab takes it, then dropped. Bundles contain no cookies or storage values. They do contain the page's text and images, so treat them like a screenshot of the page.

## Tests

- `apps/extension/src/bundle.test.ts` covers the assembly: crops relative to the scroll position, the off-screen and missing-image diagnostics, and a valid bundle.
- `apps/extension/src/extension.int.test.ts` loads the built extension into Playwright's Chromium and runs the capture on the fixture site. It checks a logged-in page through the browser's own cookie and localStorage, with the cookie absent from the bundle, and images fetched and transcoded (WebP → PNG/JPEG). It downloads the bundle through the real button.
