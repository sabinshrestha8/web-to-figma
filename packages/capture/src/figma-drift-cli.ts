/**
 * pnpm figma-drift --file KEY --node FRAME_ID --bundle prod.w2f.json [--capture 0] [-o report.md] [--max N]
 * Diff a Figma frame (via the read-only REST API) against a production capture: the same grouped
 * Markdown report as `pnpm drift`, but "Figma says X, production says Y". Needs FIGMA_TOKEN
 * (file_content:read) in the environment. The Figma frame is rebased onto the capture origin, so
 * canvas position never counts as drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { diffCaptures, renderDrift } from "@w2f/convert";
import { type Bundle, parseBundle } from "@w2f/ir";
import { fetchFigmaFrame } from "./figma-api.ts";
import { inPath, outPath } from "./paths.ts";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    node: { type: "string" },
    bundle: { type: "string" },
    out: { type: "string", short: "o" },
    capture: { type: "string", default: "0" },
    max: { type: "string" },
  },
});
if (!values.file || !values.node || !values.bundle) {
  console.error(
    "usage: pnpm figma-drift --file KEY --node FRAME_ID --bundle prod.w2f.json [-o report.md] [--capture 0] [--max N]",
  );
  process.exit(2);
}
const token = process.env.FIGMA_TOKEN;
if (!token) {
  console.error("FIGMA_TOKEN is not set (Figma → Account settings → Security → Personal access tokens)");
  process.exit(2);
}
const parsed = parseBundle(JSON.parse(readFileSync(inPath(values.bundle), "utf8")));
if (!parsed.ok) throw new Error(`bundle: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
const bundle: Bundle = parsed.value;
const max = values.max === undefined ? undefined : Number(values.max);
if (max !== undefined && !(Number.isInteger(max) && max >= 0))
  throw new Error(`bad --max "${values.max}", expected 0, 1, ...`);
const index = Number(values.capture);
if (!Number.isInteger(index) || index < 0)
  throw new Error(`bad --capture "${values.capture}", expected 0, 1, ...`);
const cap = bundle.ir.captures[index];
if (!cap) throw new Error(`capture index ${index} missing in the bundle`);

const figmaRoot = await fetchFigmaFrame(values.file, values.node, token, cap.root.bounds);
const report = diffCaptures(figmaRoot, cap.root);
const markdown = renderDrift(report);
if (values.out) writeFileSync(outPath(values.out), `${markdown}\n`);
console.log(markdown);
if (max !== undefined) process.exitCode = report.entries.length > max ? 1 : 0;
