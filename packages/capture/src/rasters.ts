import type { RasterRequest } from "@w2f/convert";
import { type Diagnostic, diag } from "@w2f/ir";
import type { Browser, Page } from "playwright";
import { LIMITS } from "./limits.ts";

/** Screenshot scale for a css-px size: device pixels when they fit Figma's image limit, else css. */
function scaleFor(width: number, height: number, dpr: number): "device" | "css" | null {
  const side = LIMITS.maxImageSide;
  if (width * dpr <= side && height * dpr <= side) return "device";
  return width <= side && height <= side ? "css" : null;
}

/**
 * Produce the pixels `rasterPlan` asked for. Islands are screenshots of the settled page with only
 * the island element visible (`isolate`), on a transparent background. Tiles are rendered alone on a
 * transparent page in a separate context with all network access refused, since the gradient CSS
 * comes from the untrusted page. Anything over the limits is reported, never silent.
 */
export async function renderRasters(
  browser: Browser,
  page: Page,
  /** Show only element `id` (null: restore the page). Returns false when the element is gone. */
  isolate: (id: number | null) => Promise<boolean>,
  requests: RasterRequest[],
  documentSize: { width: number; height: number },
  dpr: number,
  diagnostics: Diagnostic[],
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const reject = (key: string, why: string) =>
    diagnostics.push(
      diag("ASSET_REJECTED", `raster ${key} not captured: ${why}`, { fallback: "placeholder" }),
    );

  if (requests.length > LIMITS.maxRasters) {
    diagnostics.push(
      diag(
        "ASSET_REJECTED",
        `page needs ${requests.length} rasters; only the first ${LIMITS.maxRasters} were captured`,
        {
          detail: { requested: requests.length, limit: LIMITS.maxRasters },
          fallback: "placeholder",
        },
      ),
    );
  }
  const todo = requests.slice(0, LIMITS.maxRasters);

  try {
    for (const r of todo) {
      if (r.kind === "element") await island(r);
    }
  } finally {
    await isolate(null);
  }

  async function island(r: Extract<RasterRequest, { kind: "element" }>) {
    const { x, y, width, height } = r.rect;
    const scale = scaleFor(width, height, dpr);
    if (!scale) return reject(r.key, `larger than ${LIMITS.maxImageSide}px`);
    if (x < 0 || y < 0 || x + width > documentSize.width + 0.5 || y + height > documentSize.height + 0.5) {
      return reject(r.key, "element extends outside the page");
    }
    if (!(await isolate(r.id))) return reject(r.key, "element is no longer in the page");
    const png = await page.screenshot({
      type: "png",
      fullPage: true,
      scale,
      animations: "disabled",
      omitBackground: true,
      clip: r.rect,
    });
    out.set(r.key, png);
  }

  const tiles = todo.filter((r) => r.kind === "tile");
  if (tiles.length === 0) return out;
  const context = await browser.newContext({ deviceScaleFactor: dpr, javaScriptEnabled: false });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const tilePage = await context.newPage();
    await tilePage.setContent('<body style="margin:0;background:transparent"><div id="t"></div></body>');
    for (const t of tiles) {
      const scale = scaleFor(t.width, t.height, dpr);
      if (!scale || t.width < 1 || t.height < 1) {
        reject(t.key, `tile size ${t.width}×${t.height}px`);
        continue;
      }
      // Style is set as data through the DOM API; the CSS text never becomes markup or script.
      await tilePage.locator("#t").evaluate(
        (div: HTMLElement, s: { css: string; width: number; height: number }) => {
          div.style.width = `${s.width}px`;
          div.style.height = `${s.height}px`;
          div.style.backgroundImage = s.css;
        },
        { css: t.css, width: t.width, height: t.height },
      );
      const clip = { x: 0, y: 0, width: t.width, height: t.height };
      out.set(
        t.key,
        await tilePage.screenshot({ type: "png", fullPage: true, scale, omitBackground: true, clip }),
      );
    }
  } finally {
    await context.close();
  }
  return out;
}
