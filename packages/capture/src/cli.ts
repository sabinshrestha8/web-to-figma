import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { BoxNode, Node } from "@w2f/ir";
import { closeBrowser } from "./browser.ts";
import type { Viewport } from "./capture.ts";
import { convertUrls } from "./run.ts";
import { loadStorageState } from "./storage-state.ts";

const USAGE = `usage: pnpm w2f <url...> [-v 1440x900[@2]]... [-o out.w2f.json] [--storage-state auth.json] [--block-private] [--wait-for selector] [--extra-settle-ms 0-5000]

  -v, --viewport       viewport WIDTHxHEIGHT[@DPR], repeatable (default 1440x900)
  -o, --out            bundle path (default capture.w2f.json)
      --storage-state  start logged in, from a file saved by \`pnpm w2f:login <login url>\`
      --block-private  refuse loopback/private addresses (hosted-mode policy)
      --wait-for       capture only after this selector exists (slow dashboards)
      --extra-settle-ms  extra quiet wait after settling, 0-5000`;

function parseExtraSettleMs(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 5000)
    throw new Error(`bad --extra-settle-ms "${s}", expected 0-5000`);
  return n;
}

function parseViewport(s: string): Viewport {
  const m = /^(\d+)x(\d+)(?:@([12]))?$/.exec(s);
  if (!m) throw new Error(`bad viewport "${s}", expected e.g. 1440x900 or 390x844@2`);
  return { width: Number(m[1]), height: Number(m[2]), dpr: Number(m[3] ?? 1) };
}

const count = (n: Node): number => 1 + (n.type === "box" ? n.children.reduce((s, c) => s + count(c), 0) : 0);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      viewport: { type: "string", short: "v", multiple: true },
      out: { type: "string", short: "o", default: "capture.w2f.json" },
      "block-private": { type: "boolean", default: false },
      "storage-state": { type: "string" },
      "wait-for": { type: "string" },
      "extra-settle-ms": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const waitForSelector = values["wait-for"]?.trim();
  if (waitForSelector !== undefined && (waitForSelector === "" || waitForSelector.length > 500)) {
    throw new Error(`bad --wait-for selector, expected 1-500 characters`);
  }

  const started = Date.now();
  const result = await convertUrls({
    urls: positionals,
    viewports: (values.viewport ?? ["1440x900"]).map(parseViewport),
    allowPrivateNetworks: !values["block-private"],
    ...(values["storage-state"] ? { storageState: loadStorageState(values["storage-state"]) } : {}),
    ...(waitForSelector ? { waitForSelector } : {}),
    ...(values["extra-settle-ms"] !== undefined
      ? { extraSettleMs: parseExtraSettleMs(values["extra-settle-ms"]) }
      : {}),
    onProgress: (done, total, url) => console.error(`[${done + 1}/${total}] ${url}`),
  });
  const diagnostics = result.ok ? result.value.ir.diagnostics : result.diagnostics;
  for (const d of diagnostics) console.error(`  ${d.severity.padEnd(7)} ${d.code}  ${d.message}`);
  if (!result.ok) return 1;

  const json = JSON.stringify(result.value);
  writeFileSync(values.out, json);
  const roots: BoxNode[] = result.value.ir.captures.map((c) => c.root);
  const nodes = roots.reduce((s, r) => s + count(r), 0);
  console.log(
    `wrote ${values.out}: ${roots.length} capture(s), ${nodes} nodes, ${(json.length / 1024).toFixed(0)} KB in ${Date.now() - started} ms`,
  );
  return 0;
}

main()
  .then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      // Bad arguments or an unreadable --storage-state file: one line, no stack.
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 2;
    },
  )
  .finally(closeBrowser);
