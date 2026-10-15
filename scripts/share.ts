// pnpm share: builds the Figma plugin and the browser extension and packs them for someone without
// the source code. Writes share/web-to-figma-<version>-<commit>.zip (to send) and
// share/extension-store-upload.zip (extension files at the root, for addons.mozilla.org signing or
// the Chrome Web Store).
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zip } from "./zip.ts";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "apps", "figma-plugin");
const EXTENSION = join(ROOT, "apps", "extension", "dist");

execSync("pnpm plugin:build", { cwd: ROOT, stdio: "inherit" });
execSync("pnpm extension:build", { cwd: ROOT, stdio: "inherit" });

const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
const entry = (path: string, file: string) => ({ path, data: readFileSync(file) });

const version = JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8")).version as string;
const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
const dirty = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim() !== "";
const build = `${version} (${commit}${dirty ? ", with uncommitted changes" : ""})`;

const extensionFiles = files(EXTENSION).map((f) => entry(relative(EXTENSION, f), f));
const install = `Web to Figma ${build}

Turn a web page you have open (logged in or not, dialogs included) into an editable Figma design.
Two parts: a browser extension that captures the page, and a Figma plugin that builds it.
Keep both from this same zip: a capture from a newer extension may not import into an older plugin.

1. FIGMA PLUGIN (Figma desktop app)
   Unzip this file somewhere you'll keep it (the plugin runs from that folder).
   In Figma desktop: Plugins > Development > Import plugin from manifest...
   and pick figma-plugin/manifest.json.

2. BROWSER EXTENSION
   Firefox (128 or newer):
     Open about:debugging#/runtime/this-firefox > Load Temporary Add-on...
     and pick extension/manifest.json.
     Firefox removes it when it restarts; load it again the same way.
   Chrome / Edge / Brave:
     Open chrome://extensions (Edge: edge://extensions), turn on Developer mode,
     click Load unpacked and pick the extension folder.
   Optional: pin "Web to Figma" from the puzzle-piece (extensions) menu.

3. USE IT
   a. Open the page in a normal tab and wait until it has loaded. Open the dialog or menu if you
      want it in the design.
   b. On that tab press Alt+Shift+F (or click the Web to Figma toolbar button).
   c. A "Web to Figma" tab opens. If Firefox asks, allow access to the page's images. Wait for "Ready".
   d. In Figma, run Plugins > Development > Web to Figma (dev), then either:
        - click "Download .w2f.json" and drop the file onto the plugin, or
        - click "Copy for the plugin", click the plugin's paste box and press Ctrl+V.
      Click Build if it asks about fonts.

NOTES
   - The frame is as large as your browser window. For a phone-sized frame, use the browser's
     responsive design mode (Ctrl+Shift+M) first.
   - Browser pages can't be captured: error pages, about: / chrome:// pages, add-on stores, PDFs.
   - The plugin's "Import website" (URL) box needs a capture service and won't work on its own;
     use the extension.
   - Everything stays on your computer: nothing is sent to any server.
`;

const out = join(ROOT, "share");
mkdirSync(out, { recursive: true });
const name = `web-to-figma-${version}-${commit}.zip`;
writeFileSync(
  join(out, name),
  zip([
    { path: "INSTALL.txt", data: Buffer.from(install.replaceAll("\n", "\r\n")) },
    entry("figma-plugin/manifest.json", join(PLUGIN, "manifest.json")),
    ...files(join(PLUGIN, "dist")).map((f) => entry(`figma-plugin/${relative(PLUGIN, f)}`, f)),
    ...extensionFiles.map((e) => ({ ...e, path: `extension/${e.path}` })),
  ]),
);
writeFileSync(join(out, "extension-store-upload.zip"), zip(extensionFiles));
console.log(`\nshare/${name}            send this (install steps in INSTALL.txt)`);
console.log("share/extension-store-upload.zip   for Mozilla signing / Chrome Web Store upload");
if (dirty) console.warn("Note: built from uncommitted changes.");
