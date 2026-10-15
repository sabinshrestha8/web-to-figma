// Renders icon.svg to the PNG sizes the manifest lists: node icons/render.mjs (from apps/extension).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const svg = readFileSync(new URL("icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({
    path: fileURLToPath(new URL(`icon-${size}.png`, import.meta.url)),
    omitBackground: true,
  });
}
await browser.close();
