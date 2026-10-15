/// <reference path="../../../tests/fixture-server.ts" />
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Bundle, type Node, parseBundle } from "@w2f/ir";
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

  it("grows an app shell's inner scroller so the whole page is captured, then restores it", async () => {
    const page = await context.newPage();
    await page.goto(`${fixture}/app-shell`);
    // Its content may grow (rows load once in view, as on scrolling); its own style must come back.
    const mainStyle = () => document.querySelector("main")?.getAttribute("style") ?? null;
    const before = await page.evaluate(mainStyle);
    const inlineStyles = () =>
      Array.from(document.querySelectorAll("[style]"))
        .map((el) => `${el.tagName} ${el.getAttribute("style")}`)
        .filter((s) => !s.endsWith(" "));
    const stylesBefore = await page.evaluate(inlineStyles);

    const { bundle, text } = await capture(page);
    const c = bundle.ir.captures[0];
    expect(text).toContain("End of report");
    expect(text).toContain("Loaded row 6"); // rendered once in view, then grown again to show it
    // 800px window + what <main> hid (30 rows of 112px and the closing line): all of it, once.
    expect(c?.root.bounds.height).toBeGreaterThan(3400);
    expect(c?.root.bounds.height).toBeLessThan(3700);
    expect(bundle.ir.diagnostics.map((d) => d.code)).toContain("SCROLL_CONTAINER_EXPANDED");
    // The window-tall fixed sidebar grows with the page, as in a taller window.
    const walk = (n: Node): Node[] => [n, ...(n.type === "box" ? n.children.flatMap(walk) : [])];
    const nav = c && walk(c.root).find((n) => n.source.tag === "nav");
    expect(nav?.bounds.height).toBe(c?.root.bounds.height);
    // The user's tab is back the way it was.
    // (Chrome may leave an empty style="" where none was: no styles, so nothing changes on screen.)
    const after = await page.evaluate(mainStyle);
    expect(after === "" ? null : after).toBe(before);
    expect(await page.evaluate(inlineStyles)).toEqual(stylesBefore);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
    await page.close();
  });

  it("grows a full-height scroller nested in the main one, without growing forever", async () => {
    const page = await context.newPage();
    await page.goto(`${fixture}/app-shell-nested`);
    const { bundle, text } = await capture(page);
    expect(text).toContain("End of cards");
    // Header 56 + summary 288 + the panel's 20 rows (112 each), padding and closing line ≈ 2.7k px;
    // growing <main> alone would repeat its 288 px on every round.
    const h = bundle.ir.captures[0]?.root.bounds.height ?? 0;
    expect(h).toBeGreaterThan(2600);
    expect(h).toBeLessThan(3200);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
    await page.close();
  });

  it("grows a scrolled, clipping panel inside the scrolling <main>", async () => {
    const page = await context.newPage();
    await page.goto(`${fixture}/app-shell-panel`);
    await page.evaluate(() => {
      (document.getElementById("panel") as HTMLElement).scrollTop = 300;
    });
    const { bundle, text } = await capture(page);
    expect(text).toContain("End of panel");
    expect(text).toContain("Footer");
    // Header 56 + summary 160 + 20 rows (112 each), padding, closing line and footer ≈ 2.6k px.
    const c = bundle.ir.captures[0];
    const h = c?.root.bounds.height ?? 0;
    expect(h).toBeGreaterThan(2500);
    expect(h).toBeLessThan(2900);
    // Captured from the top of the panel, not where it was scrolled to, and left as it was.
    const walk = (n: Node): Node[] => [n, ...(n.type === "box" ? n.children.flatMap(walk) : [])];
    const first = c && walk(c.root).find((n) => n.type === "text" && n.characters === "Panel row 1");
    expect(first?.bounds.y).toBeLessThan(280);
    expect(await page.evaluate(() => document.getElementById("panel")?.scrollTop)).toBe(300);
    // The backdrop always hides 200px more than its height: tried once, then left alone.
    const grown = String(
      bundle.ir.diagnostics.find((d) => d.code === "SCROLL_CONTAINER_EXPANDED")?.detail?.grown,
    );
    expect(grown).toContain("left as is");
    expect(grown).toMatch(/div#panel\S* \+\d+px/);
    await page.close();
  });

  it.each([1, 0.889])(
    "grows a SimpleBar panel, whose script sets its own heights, to the end (zoom %s)",
    async (zoom) => {
      const page = await context.newPage();
      await page.goto(`${fixture}/app-shell-simplebar`);
      // Like the dashboard it was reported on, which zooms its whole page out.
      if (zoom !== 1) await page.addStyleTag({ content: `body { zoom: ${zoom} }` });
      await page.locator(".simplebar-content-wrapper").waitFor();
      const { bundle, text } = await capture(page);
      const c = bundle.ir.captures[0];
      const walk = (n: Node): Node[] => [n, ...(n.type === "box" ? n.children.flatMap(walk) : [])];
      const end = c && walk(c.root).find((n) => n.type === "text" && n.characters === "End of dashboard");
      expect(text).toContain("Card 15");
      // Its 40×20 user space still fills its on-screen box.
      const bar = c && walk(c.root).find((n) => n.type === "vector");
      expect(bar?.type === "vector" && bar.svg).toMatch(
        zoom === 1 ? /^(?!.*viewBox)/ : /viewBox="0 0 (39\.9\d|40) (19\.9\d|20)"/,
      );
      // Header 56 + padding 16 + summary 224 + 5 rows of 400 (gap 16) + closing line ≈ 2.4k px.
      expect(end?.bounds.y).toBeGreaterThan(2300 * zoom);
      // Nothing around it cuts the end off, and no blank page below it.
      const root = c?.root.bounds.height ?? 0;
      expect(root).toBeGreaterThanOrEqual((end?.bounds.y ?? 0) + (end?.bounds.height ?? 0));
      expect(root).toBeLessThan((end?.bounds.y ?? 0) + 100);
      // The canvas far below the window is cropped from a screenshot taken there: red, not a placeholder.
      const chart = c && walk(c.root).find((n) => n.name === "canvas chart");
      const fill = chart?.type === "box" ? chart.fills.find((f) => f.type === "image") : undefined;
      if (fill?.type !== "image") throw new Error("the canvas has no image");
      expect(chart?.bounds.y).toBeGreaterThan(2000 * zoom);
      const rgb = await page.evaluate(async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d");
        ctx?.drawImage(img, 0, 0);
        return Array.from(ctx?.getImageData(img.width / 2, img.height / 2, 1, 1).data ?? []).slice(0, 3);
      }, bundle.assetData[fill.assetId] ?? "");
      expect(rgb).toEqual([220, 0, 0]);
      // Every clipping box around it reaches its bottom.
      const around = (n: Node, path: Node[]): Node[] | undefined =>
        n === end
          ? path
          : n.type === "box"
            ? n.children.map((k) => around(k, [...path, n])).find(Boolean)
            : undefined;
      const bottom = (end?.bounds.y ?? 0) + (end?.bounds.height ?? 0);
      for (const n of (c && around(c.root, [])) ?? [])
        if (n.type === "box" && n.clip)
          expect(n.bounds.y + n.bounds.height, n.name).toBeGreaterThanOrEqual(bottom);
      await page.close();
    },
  );

  it("leaves the page alone while a dialog is open", async () => {
    const page = await context.newPage();
    await page.goto(`${fixture}/dialog`);
    await page.click("text=Add employee");
    await page.getByRole("dialog").waitFor();
    const { bundle } = await capture(page);
    expect(bundle.ir.diagnostics.map((d) => d.code)).not.toContain("SCROLL_CONTAINER_EXPANDED");
    expect(bundle.ir.captures[0]?.root.bounds.height).toBe(800);
    await page.close();
  });
});
