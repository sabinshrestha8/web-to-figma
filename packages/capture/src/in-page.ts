import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { JSHandle, Page } from "playwright";

// Bundled on first use. Passing functions to page.evaluate would break under tsx/esbuild
// `keepNames` helpers, so the page only ever receives this self-contained IIFE.
let source: Promise<string> | undefined;

function collectorSource(): Promise<string> {
  source ??= build({
    entryPoints: [fileURLToPath(new URL("./collector/index.ts", import.meta.url))],
    bundle: true,
    format: "iife",
    globalName: "__w2f",
    write: false,
    target: "chrome120",
    logLevel: "silent",
  }).then((r) => {
    const out = r.outputFiles[0];
    if (!out) throw new Error("collector bundle produced no output");
    return out.text;
  });
  return source;
}

/** Evaluate `call` (an expression using `__w2f.*`) in the page. Nothing leaks into page globals. */
export async function inPage<T>(page: Page, call: string): Promise<T> {
  const src = await collectorSource();
  return (await page.evaluate(`(() => { ${src}; return ${call}; })()`)) as T;
}

/** The collector module as a live handle, for calls that must share in-page state (element refs). */
export async function collectorHandle(page: Page): Promise<JSHandle<typeof import("./collector/index.ts")>> {
  const src = await collectorSource();
  return page.evaluateHandle(`(() => { ${src}; return __w2f; })()`);
}
