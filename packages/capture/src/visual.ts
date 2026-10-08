import type { Capture } from "@w2f/ir";
import { renderIRToHtml } from "@w2f/preview";
import type { Browser } from "playwright";
import { getBrowser } from "./browser.ts";

export interface DiffResult {
  /** Fraction of compared pixels whose largest channel difference exceeds the tolerance. */
  mismatch: number;
  width: number;
  height: number;
  /** True when the two images differ in size; only the overlapping area is compared. */
  sizeDiffers: boolean;
  /** PNG: the second image faded, mismatching pixels in red. */
  diff: Buffer;
}

/** tsx/esbuild `keepNames` wraps named functions in `__name(...)`, which pages don't define. */
const NAME_SHIM = "globalThis.__name = (f) => f;";

/** A page with every request refused: PNGs are decoded from bytes handed in as data. */
async function offlinePage(browser: Browser) {
  const context = await browser.newContext();
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.evaluate(NAME_SHIM);
  return { context, page };
}

/**
 * Pixel diff of two PNGs, decoded and compared by canvas in Chromium (no image dependency).
 * `tolerance` is per channel, 0–255: anti-aliasing noise below it is not a mismatch.
 */
export async function comparePngs(a: Buffer, b: Buffer, tolerance = 32): Promise<DiffResult> {
  const { context, page } = await offlinePage(await getBrowser());
  try {
    const out = await page.evaluate(
      async ({ a, b, tolerance }) => {
        const decode = async (b64: string) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          return createImageBitmap(new Blob([bytes], { type: "image/png" }));
        };
        const [ia, ib] = [await decode(a), await decode(b)];
        const width = Math.min(ia.width, ib.width);
        const height = Math.min(ia.height, ib.height);
        const pixels = (img: ImageBitmap) => {
          const c = new OffscreenCanvas(width, height);
          const ctx = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, width, height);
        };
        const pa = pixels(ia).data;
        const db = pixels(ib);
        const pb = db.data;
        let bad = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(
            Math.abs((pa[i] ?? 0) - (pb[i] ?? 0)),
            Math.abs((pa[i + 1] ?? 0) - (pb[i + 1] ?? 0)),
            Math.abs((pa[i + 2] ?? 0) - (pb[i + 2] ?? 0)),
          );
          if (d > tolerance) {
            bad++;
            pb.set([255, 0, 0, 255], i);
          } else {
            for (let k = 0; k < 3; k++) pb[i + k] = 255 - (255 - (pb[i + k] ?? 0)) / 4;
          }
        }
        const c = new OffscreenCanvas(width, height);
        (c.getContext("2d") as OffscreenCanvasRenderingContext2D).putImageData(db, 0, 0);
        const blob = await c.convertToBlob({ type: "image/png" });
        const bin = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
        return {
          mismatch: bad / (width * height),
          width,
          height,
          sizeDiffers: ia.width !== ib.width || ia.height !== ib.height,
          diff: btoa(s),
        };
      },
      { a: a.toString("base64"), b: b.toString("base64"), tolerance },
    );
    return { ...out, diff: Buffer.from(out.diff, "base64") };
  } finally {
    await context.close();
  }
}

/**
 * Screenshot of `renderIRToHtml(capture)` drawn over the original page, so the page's own webfonts
 * are loaded and text is measured fairly. The page is hidden under an opaque preview layer.
 * Test harness: loads `url` without the capture network policy, so only use it with trusted pages
 * (the fixture site). Not exported from the package.
 */
export async function previewScreenshot(
  url: string,
  capture: Capture,
  assetData: Record<string, string>,
  height: number,
): Promise<Buffer> {
  const browser = await getBrowser();
  const { width, dpr } = capture.viewport;
  const context = await browser.newContext({
    viewport: { width, height: capture.viewport.height },
    deviceScaleFactor: dpr,
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(NAME_SHIM);
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const assets = Object.fromEntries(
      Object.entries(assetData).map(([id, b64]) => [id, `data:image/png;base64,${b64}`]),
    );
    await page.evaluate(
      async ({ html, width, height, urls }) => {
        // Background images load asynchronously; decode them before anything is drawn.
        await Promise.all(
          urls.map((src) => {
            const img = new Image();
            img.src = src;
            return img.decode().catch(() => undefined);
          }),
        );
        document.documentElement.style.visibility = "hidden";
        const host = document.createElement("div");
        host.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;z-index:2147483647;visibility:visible;overflow:hidden`;
        // The preview is built from our own IR; set as markup inside an isolated shadow root.
        host.attachShadow({ mode: "open" }).innerHTML = html;
        document.body.append(host);
        window.scrollTo(0, 0);
        await Promise.all(
          Array.from(host.shadowRoot?.querySelectorAll("img") ?? [], (i) =>
            i.decode().catch(() => undefined),
          ),
        );
        // Webfonts load on first use: the preview's text may request faces the page never drew.
        await new Promise((r) => requestAnimationFrame(r));
        await document.fonts.ready;
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
      },
      { html: renderIRToHtml(capture, assets), width, height, urls: Object.values(assets) },
    );
    return await page.screenshot({
      type: "png",
      scale: "css",
      fullPage: true,
      clip: { x: 0, y: 0, width, height },
    });
  } finally {
    await context.close();
  }
}
