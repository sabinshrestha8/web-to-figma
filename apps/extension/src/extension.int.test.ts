/// <reference path="../../../tests/fixture-server.ts" />
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Bundle, parseBundle } from "@w2f/ir";
import { type BrowserContext, chromium, type Page, type Worker } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const fixture = inject("fixtureUrl");

let context: BrowserContext;
let worker: Worker;

beforeAll(async () => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: ROOT });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "w2f-ext-")), {
    channel: "chromium", // the full browser: headless shell can't load extensions
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
});
afterAll(() => context?.close());

/** What the toolbar button does, for `page`; returns the downloaded bundle. */
async function capture(page: Page): Promise<{ bundle: Bundle; text: string }> {
  const opened = context.waitForEvent("page", (p) => p.url().includes("result.html"));
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    if (!tab) throw new Error(`no tab for ${url}`);
    await (globalThis as unknown as { w2fCaptureTab(t: chrome.tabs.Tab): Promise<void> }).w2fCaptureTab(tab);
  }, page.url());
  const result = await opened;
  await result.locator("#status", { hasText: "Ready" }).waitFor({ timeout: 60_000 });
  const download = result.waitForEvent("download");
  await result.click("#download");
  const path = await (await download).path();
  const text = readFileSync(path, "utf8");
  const parsed = parseBundle(JSON.parse(text));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  await result.close();
  return { bundle: parsed.value, text };
}

describe("browser extension", () => {
  it("captures a logged-in page with the browser's own session", async () => {
    await context.addCookies([
      { name: "w2f_session", value: "fixture-session-token", domain: "127.0.0.1", path: "/", httpOnly: true },
    ]);
    const page = await context.newPage();
    await page.goto(`${fixture}/landing`);
    await page.evaluate(() => localStorage.setItem("w2f_user", "Ada"));
    await page.goto(`${fixture}/auth`);
    await page.getByText("Signed in as Ada").waitFor();

    const { bundle, text } = await capture(page);
    const c = bundle.ir.captures[0];
    expect(c?.url).toBe(`${fixture}/auth`);
    expect(c?.viewport).toMatchObject({ width: 1280, height: 800 });
    expect(c?.screenshot).toBeDefined();
    expect(text).toContain("Signed in as Ada");
    expect(text).not.toContain("fixture-session-token");
    await page.close();
  });

  it("fetches and decodes the page's images (WebP transcoded)", async () => {
    const page = await context.newPage();
    await page.goto(`${fixture}/image-heavy`);
    await page.waitForLoadState("networkidle");

    const { bundle } = await capture(page);
    const mimes = Object.values(bundle.ir.assets).map((a) => a.mime);
    expect(mimes).toContain("image/jpeg");
    expect(mimes.every((m) => ["image/png", "image/jpeg", "image/gif"].includes(m))).toBe(true);
    const unused = bundle.ir.diagnostics.filter(
      (d) => d.code === "ASSET_REJECTED" && d.message.includes("/img/"),
    );
    expect(unused).toEqual([]);
    await page.close();
  });
});
