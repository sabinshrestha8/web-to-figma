import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { JSHandle, Page } from "playwright";

// Bundled on first use. Passing functions to page.evaluate would break under tsx/esbuild
// `keepNames` helpers, so the page only ever receives this self-contained IIFE.
let source: Promise<string> | undefined;

/**
 * The collector entry. Plain runtimes (CLI, tests) resolve it next to this module, but a
 * bundler (Next.js routes) rewrites import.meta.url to the build output — and even statically
 * evaluates require.resolve, so that can't anchor it either. The workspace layout reached
 * from the server's working directory is opaque to static analysis, so it works in both.
 * (The server must start from its package dir, which `pnpm --filter @w2f/web` guarantees.)
 */
function collectorEntry(): string {
  const fromWorkspace = join(
    process.cwd(),
    "..",
    "..",
    "packages",
    "capture",
    "src",
    "collector",
    "index.ts",
  );
  if (existsSync(fromWorkspace)) return fromWorkspace;
  return fileURLToPath(new URL("./collector/index.ts", import.meta.url));
}

function collectorSource(): Promise<string> {
  source ??= build({
    entryPoints: [collectorEntry()],
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
