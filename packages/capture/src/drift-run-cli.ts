/**
 * pnpm drift:run [drift.config.json] [--accept] [--page NAME]...
 * Capture every page in the config, diff it against its baseline (and its Figma frame when the
 * config names one and FIGMA_TOKEN is set), append history and write report.html. The first run
 * of a page sets its baseline; --accept makes this run's captures the baselines.
 * Exit 0 within thresholds, 1 when a page failed or went over one, 2 on bad arguments or config.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeBrowser } from "./browser.ts";
import { runDrift } from "./drift-run.ts";
import { inPath } from "./paths.ts";

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      accept: { type: "boolean", default: false },
      page: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log("usage: pnpm drift:run [drift.config.json] [--accept] [--page NAME]...");
    return 0;
  }
  const config = inPath(positionals[0] ?? "drift.config.json");
  if (!existsSync(config)) {
    console.error(
      `error: no drift config at ${config}. Create .data/drift.config.json listing the pages to watch:
` +
        `  { "pages": [{ "name": "home", "url": "http://localhost:3000/" }] }
` +
        "(README: Watch pages for drift)",
    );
    return 2;
  }
  const { results, reportPath, ok } = await runDrift(config, {
    accept: values.accept,
    only: values.page ?? [],
    ...(process.env.FIGMA_TOKEN ? { figmaToken: process.env.FIGMA_TOKEN } : {}),
    log: (l) => console.error(l),
  });
  for (const r of results) {
    const figma = r.figma
      ? "entries" in r.figma
        ? `, figma ${r.figma.entries.length}`
        : ", figma skipped"
      : "";
    const nums = r.drift ? `${r.drift.entries.length} changes, ${r.pixelPercent}% pixels${figma}` : r.status;
    const flag = r.error ? `FAILED: ${r.error}` : r.over.length ? `OVER: ${r.over.join("; ")}` : "ok";
    console.log(`${r.name.padEnd(20)} ${nums} — ${flag}`);
  }
  console.log(`report: ${reportPath}`);
  return ok ? 0 : 1;
}

main()
  .then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 2;
    },
  )
  .finally(closeBrowser);
