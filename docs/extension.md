# Browser extension (`apps/extension`)

The extension captures the page **you are looking at, in your own browser**, so logged-in pages, open dialogs and menus, and anything else on screen come along as they are. It makes the same `.w2f.json` bundle as the CLI, web UI and capture service, and the Figma plugin imports it by drop or paste. No server is involved, and nothing leaves your machine.

```
toolbar button / Alt+Shift+F
  service worker: captureVisibleTab (PNG of the viewport) → inject collector.js (isolated world) → collect()
  result.html (extension page): fetch images (your cookies) → decode → crop islands from the screenshot
                                → snapshotToIR → parseDocument → Download .w2f.json / Copy for the plugin
Figma plugin: drop the file, or Ctrl+V the copied bundle into its paste box
```

## Browsers

| Browser | Status |
|---|---|
| Firefox 128+ (desktop) | Works; tested end to end with Figma desktop |
| Chromium | Covered by the integration tests |
| Chrome 121+, Edge, Brave, Opera, Vivaldi, Arc | Same engine and manifest; expected to work, not tried individually |
| Safari | No: it needs repackaging with Xcode and an Apple developer account |
| Mobile | No (Figma desktop is needed anyway) |

One `manifest.json` serves both engines. Firefox uses `background.scripts` and Chrome uses `background.service_worker`; each ignores the other's key. `web-ext lint` warns about `service_worker`, and that warning is expected.

## Install (unpacked, for now)

```sh
pnpm install
pnpm extension:build      # writes apps/extension/dist
```

**Firefox (128+):** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and pick `apps/extension/dist/manifest.json`. A temporary add-on is removed when Firefox restarts. To keep it installed, it must be signed by Mozilla (an unlisted, self-distributed submission on addons.mozilla.org). The first time you capture, the result tab may ask you to **Allow access to the page's images**: Firefox lets you withhold "all sites" access, and without it only same-site images can be read.

**Chrome or Edge:** open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick `apps/extension/dist`. After a pull, run `pnpm extension:build` again and press the reload icon on the extension's card. A bundle imports into a plugin built from the same checkout.

## Use

1. Open the page and get it into the state you want: logged in, dialog open, scrolled to the top.
2. Click the **Web to Figma** toolbar button (pin it from the puzzle-piece/extensions menu), or press **Alt+Shift+F**. The shortcut doesn't move focus, so menus that close on blur stay open. You can change it at `chrome://extensions/shortcuts`, or in Firefox at `about:addons` → gear menu → **Manage Extension Shortcuts**.
3. A result tab opens and converts the capture. Choose **Download .w2f.json** and drop the file into the plugin, or choose **Copy for the plugin**, click the plugin's paste box ("Copied with the browser extension?…") and press **Ctrl+V**. Figma desktop sends Ctrl+V to the canvas unless a plugin text field has focus.

The frame size is your window's viewport. For a mobile or tablet frame, open DevTools device mode at the size you want, then capture.

## Troubleshooting

| You see | Do this |
|---|---|
| "… can't be read by extensions" | You captured a browser page (error page, `about:`/`chrome://`, add-on store, PDF) or a tab that didn't load. Open the real page, wait for it, capture again |
| The bottom is cut off, or there's blank space below the page | Check the `SCROLL_CONTAINER_EXPANDED` line on the result tab: it says which panels were grown. Send that line with the bundle if it's wrong |
| "This capture is no longer available" | The result tab was reloaded or opened later. Capture again |
| Images missing (placeholders) | In Firefox, allow access to the page's images when asked. `blob:` images and images drawn off screen can't be read |
| Pasting does nothing in Figma | Click inside the plugin's paste box first: Figma sends Ctrl+V to the canvas otherwise. Or use **Download** and drop the file |
| "Copy failed …" | Use **Download** and drop the file |
| The plugin says the bundle is from a newer version | Run `pnpm plugin:build` and `pnpm extension:build` from the same checkout, then reload both |
| The add-on is gone in Firefox | Temporary add-ons are removed on restart: load it again from `about:debugging` |

## Differences from the Playwright capture

Each of these shows up as a diagnostic in the result tab, never silently:

- **Only what's loaded now.** There's no navigation, settle or lazy-load scroll; the capture is the page as it is.
- **App shells** (dashboards where the window doesn't scroll but an inner panel does): for a moment the extension grows every window-sized panel that cuts content off (the scrolling one, a fixed-height or `overflow: hidden` panel inside it, a full-height panel under a summary), innermost first, each by what it hides and its parents with it, until nothing is cut off. Then it collects and puts the page back, scroll positions included (`SCROLL_CONTAINER_EXPANDED`). Panels you'd scrolled are captured from their top. Smaller scrolling boxes (a card's list, a sidebar) stay as they are. So do hidden elements, and any element that growing doesn't help (one whose script resets its height, or a backdrop always taller than itself): it's tried once, then put back. The diagnostic lists what was grown and by how much. Elements exactly as tall as the window (a 100vh or fixed full-height sidebar) grow with it, as the CLI draws them; a panel that is window-tall by coincidence grows too. First, each of those panels is scrolled from top to bottom a screen at a time (then put back), so widgets that render once they come into view do. They get another moment after growing (up to ~1.5 s), and the panels grow again to fit them. Right before collecting, the extension grows them once more, because the page's own scripts (resize observers, "100vh" hooks) can set heights back in the meantime, and it makes sure every container reaches the bottom of what it holds. The CLI doesn't do this yet: it grows the window by what the outer panel hides. This is skipped while a dialog or menu is open, because then the visible screen is what you want.
- **Raster islands** (canvas, video, iframes, native checkboxes, images that wouldn't decode) are crops of the visible-tab screenshot. Only ones within the window are captured (below the fold of an expanded app shell counts as off screen), and a crop includes anything drawn over the element. Off-screen ones become placeholders (`ASSET_REJECTED`): scroll to them and capture again.
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
