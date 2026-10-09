/**
 * pnpm compare <a.png | bundle.w2f.json> <b.png> [-o diff.png] [--max 5]
 * Pixel diff of two screenshots, e.g. a Figma "Export PNG" of a built frame against the capture's
 * reference screenshot. Given a bundle, its first capture's reference screenshot is used.
 * Exits 1 when the mismatch is above --max percent.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { parseBundle } from "@w2f/ir";
import { closeBrowser } from "./browser.ts";
import { comparePngs } from "./visual.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", short: "o" }, max: { type: "string", default: "5" } },
});
const [a, b] = positionals;
if (!a || !b) {
  console.error("usage: pnpm compare <a.png> <b.png> [-o diff.png] [--max 5]");
  process.exit(2);
}
/** A PNG file, or the reference screenshot inside a .w2f.json bundle. */
function png(path: string): Buffer {
  if (!path.endsWith(".json")) return readFileSync(path);
  const bundle = parseBundle(JSON.parse(readFileSync(path, "utf8")));
  if (!bundle.ok) throw new Error(`${path}: ${bundle.diagnostics.map((d) => d.message).join("; ")}`);
  const shot = bundle.value.ir.captures[0]?.screenshot;
  const data = shot && bundle.value.assetData[shot];
  if (!data) throw new Error(`${path} has no reference screenshot`);
  return Buffer.from(data, "base64");
}

try {
  const r = await comparePngs(png(a), png(b));
  const pct = r.mismatch * 100;
  if (values.out) {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, r.diff);
  }
  console.log(
    `${pct.toFixed(2)}% of ${r.width}×${r.height} pixels differ${r.sizeDiffers ? " (sizes differ; compared the overlap)" : ""}`,
  );
  process.exitCode = pct > Number(values.max) ? 1 : 0;
} finally {
  await closeBrowser();
}
