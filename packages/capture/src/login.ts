import { writeFileSync } from "node:fs";
import { type BrowserContext, chromium, type Page } from "playwright";

type State = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * Open `url` in a visible browser with a fresh profile; when the user closes the window, write that
 * context's cookies + localStorage to `out` for `pnpm w2f --storage-state`. The user types their own
 * credentials; we never see them, only the resulting session.
 */
export async function saveLogin(
  url: string,
  out: string,
  /** Tests stand in for the user with `act` (log in, then close the page). */
  opts: { headless?: boolean; act?: (page: Page) => Promise<void> } = {},
): Promise<number> {
  const browser = await chromium.launch({ headless: opts.headless ?? false });
  try {
    const context = await browser.newContext({
      viewport: null,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const page = await context.newPage();
    await page.goto(url);
    // Closing the last window can take the whole browser down before we read it, so keep a recent
    // snapshot while the user logs in and fall back to it.
    let last: State = { cookies: [], origins: [] };
    const snap = () =>
      context.storageState().then(
        (s) => {
          last = s;
        },
        () => undefined, // browser already gone: keep the previous snapshot
      );
    const timer = setInterval(snap, 1000);
    const closed = page.waitForEvent("close", { timeout: 0 }).catch(() => undefined);
    await opts.act?.(page);
    await closed;
    clearInterval(timer);
    await snap();
    const state = last;
    writeFileSync(out, JSON.stringify(state, null, 2), { mode: 0o600 });
    return state.cookies.length + state.origins.length;
  } finally {
    await browser.close().catch(() => undefined); // may already be closed by the user
  }
}
