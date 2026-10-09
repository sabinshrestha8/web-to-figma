/**
 * pnpm drift <old.w2f.json> <new.w2f.json> [-o report.md] [--capture 0]
 * Node-level drift between two captures of the same page: moves, resizes, text, restyle,
 * layout, added and removed nodes. Pure IR comparison, no browser. Always exits 0 with a report
 * (an empty report is the passing state); use --max to fail above N changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { diffCaptures, renderDrift } from "@w2f/convert";
import { type Bundle, parseBundle } from "@w2f/ir";
import { inPath, outPath } from "./paths.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    capture: { type: "string", default: "0" },
    max: { type: "string" },
  },
});
const [oldPath, newPath] = positionals;
if (!oldPath || !newPath) {
  console.error("usage: pnpm drift <old.w2f.json> <new.w2f.json> [-o report.md] [--capture 0] [--max N]");
  process.exit(2);
}
function bundle(path: string): Bundle {
  const parsed = parseBundle(JSON.parse(readFileSync(inPath(path), "utf8")));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
  return parsed.value;
}
const max = values.max === undefined ? undefined : Number(values.max);
if (max !== undefined && !(Number.isInteger(max) && max >= 0))
  throw new Error(`bad --max "${values.max}", expected 0, 1, ...`);
const index = Number(values.capture);
if (!Number.isInteger(index) || index < 0)
  throw new Error(`bad --capture "${values.capture}", expected 0, 1, ...`);
const a = bundle(oldPath).ir.captures[index];
const b = bundle(newPath).ir.captures[index];
if (!a || !b) throw new Error(`capture index ${index} missing in one bundle`);
if (a.url !== b.url) console.error(`note: different urls (${a.url} vs ${b.url})`);
const report = diffCaptures(a.root, b.root);
const markdown = renderDrift(report);
if (values.out) writeFileSync(outPath(values.out), `${markdown}\n`);
console.log(markdown);
if (max !== undefined) process.exitCode = report.entries.length > max ? 1 : 0;
