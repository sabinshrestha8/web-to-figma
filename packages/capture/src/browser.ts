import { type Browser, chromium } from "playwright";

// One Chromium per process and mode, kept on globalThis so Next.js hot reloads don't leak browsers.
const g = globalThis as { __w2fBrowser?: Promise<Browser>; __w2fHostedBrowser?: Promise<Browser> };
type Key = "__w2fBrowser" | "__w2fHostedBrowser";

/**
 * Hosted: Chromium resolves no host names at all, so a request that somehow escaped routing
 * (every one goes through pinnedFetch) still can't reach the network. `W2F_CHROMIUM_SANDBOX=1`
 * turns Chromium's own sandbox on where the container allows it (user namespaces or SYS_ADMIN).
 */
export function getBrowser(hosted = false): Promise<Browser> {
  const key: Key = hosted ? "__w2fHostedBrowser" : "__w2fBrowser";
  g[key] ??= chromium
    .launch({
      headless: true,
      ...(process.env.W2F_CHROMIUM_SANDBOX === "1" ? { chromiumSandbox: true } : {}),
      ...(hosted ? { args: ["--host-resolver-rules=MAP * ~NOTFOUND"] } : {}),
    })
    .catch((e: unknown) => {
      g[key] = undefined; // let the next call retry
      throw e;
    });
  return g[key];
}

export async function closeBrowser(): Promise<void> {
  for (const key of ["__w2fBrowser", "__w2fHostedBrowser"] as const) {
    const browser = g[key];
    g[key] = undefined;
    if (browser) await (await browser).close();
  }
}
