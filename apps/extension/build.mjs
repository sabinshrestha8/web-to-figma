// Bundles the extension into dist/ (load it unpacked from there, or zip it for the Chrome Web Store).
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
const common = { bundle: true, minify: true, target: "chrome120", logLevel: "warning" };
await Promise.all([
  build({ ...common, entryPoints: ["src/background.ts"], outfile: "dist/background.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/result.ts"], outfile: "dist/result.js", format: "iife" }),
  // Injected into the tab's isolated world; defines `__w2f` there for background.ts's collectInTab.
  build({
    ...common,
    entryPoints: ["../../packages/capture/src/collector/index.ts"],
    outfile: "dist/collector.js",
    format: "iife",
    globalName: "__w2f",
  }),
]);
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("src/result.html", "dist/result.html");
console.log("dist/ ready: chrome://extensions → Developer mode → Load unpacked → apps/extension/dist");
