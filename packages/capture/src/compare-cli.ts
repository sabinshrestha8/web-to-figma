/**
 * pnpm compare <a.png | bundle.w2f.json> <b.png> [-o diff.png] [--max 5] [--capture 0]
 * Pixel diff of two screenshots, e.g. a Figma "Export PNG" of a built frame against the capture's
 * reference screenshot. Given a bundle, the selected capture's reference screenshot is used.
 * Exits 1 when the mismatch is above --max percent (or the inputs are bad);
 * missing arguments print usage and exit 2.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseBundle } from "@w2f/ir";
import { closeBrowser } from "./browser.ts";
import { inPath, outPath } from "./paths.ts";
import { comparePngs } from "./visual.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    max: { type: "string", default: "5" },
    capture: { type: "string", default: "0" },
  },
});
const [a, b] = positionals;
if (!a || !b) {
  console.error("usage: pnpm compare <a.png> <b.png> [-o diff.png] [--max 5] [--capture 0]");
  process.exit(2);
}
const max = Number(values.max);
if (!Number.isFinite(max) || max < 0) throw new Error(`bad --max "${values.max}", expected a percent >= 0`);
const index = Number(values.capture);
if (!Number.isInteger(index) || index < 0)
  throw new Error(`bad --capture "${values.capture}", expected 0, 1, ...`);
/** A PNG file, or the reference screenshot inside a .w2f.json bundle. */
function png(path: string): Buffer {
  if (!path.endsWith(".json")) return readFileSync(inPath(path));
  const bundle = parseBundle(JSON.parse(readFileSync(inPath(path), "utf8")));
  if (!bundle.ok) throw new Error(`${path}: ${bundle.diagnostics.map((d) => d.message).join("; ")}`);
  const shot = bundle.value.ir.captures[index]?.screenshot;
  const data = shot && bundle.value.assetData[shot];
  if (!data) throw new Error(`${path} has no reference screenshot for capture ${index}`);
  return Buffer.from(data, "base64");
}

try {
  const r = await comparePngs(png(a), png(b));
  const pct = r.mismatch * 100;
  if (values.out) writeFileSync(outPath(values.out), r.diff);
  console.log(
    `${pct.toFixed(2)}% of ${r.width}×${r.height} pixels differ${r.sizeDiffers ? " (sizes differ; compared the overlap)" : ""}`,
  );
  process.exitCode = pct > max ? 1 : 0;
} finally {
  await closeBrowser();
}
