import { type Browser, chromium } from "playwright";

// One Chromium per process, kept on globalThis so Next.js hot reloads don't leak browsers.
const g = globalThis as { __w2fBrowser?: Promise<Browser> };

export function getBrowser(): Promise<Browser> {
  g.__w2fBrowser ??= chromium.launch({ headless: true }).catch((e: unknown) => {
    g.__w2fBrowser = undefined; // let the next call retry
    throw e;
  });
  return g.__w2fBrowser;
}

export async function closeBrowser(): Promise<void> {
  const browser = g.__w2fBrowser;
  g.__w2fBrowser = undefined;
  if (browser) await (await browser).close();
}
