import { imagePlan, type RawSnapshot, rasterPlan } from "@w2f/convert";
import { ConversionError, type Diagnostic, diag, type Result } from "@w2f/ir";
import type { BrowserContext, Page, Request, Route } from "playwright";
import { getBrowser } from "./browser.ts";
import { type DecodedImage, decodeImages } from "./images.ts";
import { collectorHandle, inPage } from "./in-page.ts";
import { LIMITS } from "./limits.ts";
import { createPolicy, type Policy } from "./policy.ts";
import { renderRasters } from "./rasters.ts";
import type { StorageState } from "./storage-state.ts";

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export interface CaptureOptions {
  /** Default true (local mode). Hosted deployments must pass false. */
  allowPrivateNetworks?: boolean;
  /** Start logged in: cookies + localStorage from `loadStorageState`. Local mode only. */
  storageState?: StorageState;
  /**
   * Playwright selectors of content that must exist before the snapshot (e.g. data that replaces
   * loading skeletons). Repeatable: every selector must appear. A selector that never appears is
   * a warning, not a failure: the current state is captured as-is.
   */
  waitForSelectors?: string[];
  /** Extra quiet wait after settling, 0–5000 ms (docs/api.md). */
  extraSettleMs?: number;
}

export interface CaptureOutput {
  snapshot: RawSnapshot;
  /** PNG of the top of the page (≤ LIMITS.maxReferenceHeight CSS px), for reference and diffing. */
  screenshot: Buffer;
  /** PNG per fulfilled `rasterPlan` key (raster islands and pattern tiles). */
  rasters: Map<string, Buffer>;
  /** Decoded image per fulfilled `imagePlan` key. */
  images: Map<string, DecodedImage>;
  diagnostics: Diagnostic[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reject with a TIMEOUT ConversionError if `p` takes longer than `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ConversionError(diag("TIMEOUT", `${what} took longer than ${ms / 1000}s`))),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Wait until no request has been in flight for `networkQuietMs`, capped at `networkSettleCapMs`. */
async function networkQuiet(inflight: () => number) {
  const deadline = Date.now() + LIMITS.networkSettleCapMs;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (inflight() > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= LIMITS.networkQuietMs) return;
    await sleep(50);
  }
}

const MAX_REDIRECTS = 10;

interface NetworkEvents {
  blocked(d: Diagnostic, nav: boolean): void;
  /** A main-frame navigation redirected to an already-checked URL; navigate() re-issues it. */
  redirect(url: string): void;
  /** The body of an image response, by request URL (decoded later, see images.ts). */
  image(url: string, body: Buffer): void;
}

/**
 * Every request is checked against the policy and fetched with redirects disabled. Redirects are
 * never handed back to the browser: Playwright does not route the follow-up request of a fulfilled
 * 3xx (verified against Chromium), so the browser would reach the next hop unchecked.
 * Subresource hops are followed here; main-frame hops are aborted and re-navigated, so each one is
 * a fresh, routed request and the page keeps its real URL.
 */
function guardNetwork(context: BrowserContext, page: Page, policy: Policy, on: NetworkEvents) {
  const handle = async (route: Route) => {
    const req = route.request();
    const nav = req.isNavigationRequest() && req.frame() === page.mainFrame();
    const blocked = await policy.check(req.url(), !nav);
    if (blocked) {
      on.blocked(blocked, nav);
      return route.abort("blockedbyclient");
    }
    const origin = new URL(req.url()).origin;
    let target = req.url();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Credentials stay with their origin when a subresource redirects elsewhere.
      const headers = { ...req.headers() };
      if (new URL(target).origin !== origin) {
        delete headers.cookie;
        delete headers.authorization;
      }
      const response = await route
        .fetch({ url: target, headers, maxRedirects: 0 })
        .catch((e: unknown) => e as Error);
      if (response instanceof Error) return route.abort("failed"); // same as the browser failing it
      const location =
        response.status() >= 300 && response.status() < 400 ? response.headers().location : undefined;
      if (!location) {
        const type = response.headers()["content-type"] ?? "";
        if (req.resourceType() === "image" || type.startsWith("image/"))
          on.image(req.url(), await response.body());
        return route.fulfill({ response });
      }
      const next = new URL(location, target).href;
      const verdict = await policy.check(next, !nav);
      if (verdict) {
        on.blocked(verdict, nav);
        return route.abort("blockedbyclient");
      }
      if (nav) {
        on.redirect(next);
        return route.abort("aborted");
      }
      target = next;
    }
    return route.abort("failed"); // too many redirects
  };
  return Promise.all([
    context.route("**/*", handle),
    context.routeWebSocket(/.*/, async (ws) => {
      const blocked = await policy.check(ws.url().replace(/^ws/, "http"), true);
      if (blocked) {
        on.blocked(blocked, false);
        return ws.close();
      }
      ws.connectToServer();
    }),
  ]);
}

interface NavState {
  blocked?: Diagnostic;
  redirect?: string;
}

async function navigate(page: Page, url: string, state: NavState) {
  let response = await page
    .goto(url, { waitUntil: "load", timeout: LIMITS.navigationMs })
    .catch((e: unknown) => e as Error);
  for (let hop = 0; state.redirect && !state.blocked; hop++) {
    if (hop === MAX_REDIRECTS)
      throw new ConversionError(diag("NAVIGATION_FAILED", `more than ${MAX_REDIRECTS} redirects`));
    const next = state.redirect;
    state.redirect = undefined;
    response = await page
      .goto(next, { waitUntil: "load", timeout: LIMITS.navigationMs })
      .catch((e: unknown) => e as Error);
  }
  if (state.blocked) throw new ConversionError(state.blocked);
  if (response instanceof Error) {
    const code = response.name === "TimeoutError" ? "TIMEOUT" : "NAVIGATION_FAILED";
    throw new ConversionError(diag(code, response.message.split("\n")[0] ?? response.message));
  }
  if (response && response.status() >= 400) {
    throw new ConversionError(diag("NAVIGATION_FAILED", `HTTP ${response.status()} for ${url}`));
  }
}

const MAX_SELF_NAVIGATIONS = 3;

/** Live counters fed by page/context events. */
interface Activity {
  inflight: number;
  /** Main-frame documents committed (incl. same-document history navigations). */
  navigations: number;
  /** Main-frame navigation requests still waiting for a response (e.g. a slow dev-server compile). */
  pendingNavigations: Set<Request>;
}

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline)
      throw new ConversionError(diag("TIMEOUT", `${what} took longer than ${ms / 1000}s`));
    await sleep(50);
  }
}

async function settleOnce(page: Page, inflight: () => number) {
  await inPage(page, "__w2f.fontsReady()");
  await inPage(page, `__w2f.scrollThrough(${LIMITS.maxCaptureHeight})`);
  await networkQuiet(inflight);
  await inPage(page, "__w2f.fontsReady()");
  await inPage(page, "__w2f.nextFrames()");
}

/**
 * Settle the page. If it navigated itself meanwhile (an auth guard sending you to /login, a client
 * redirect), follow it: wait for the new document and settle again. Bounded, so a page that keeps
 * navigating is captured as-is with a warning instead of holding the job.
 * A pending navigation counts too: the old document stays on screen until the new one responds.
 * ponytail: a redirect fired by a timer after the network has gone quiet is not detected.
 */
async function settle(page: Page, nav: NavState, activity: Activity, diagnostics: Diagnostic[]) {
  for (let round = 0; ; round++) {
    if (nav.blocked) throw new ConversionError(nav.blocked);
    if (nav.redirect) {
      // A page-initiated navigation hit a 3xx: the guard aborted it, we follow it (checked) here.
      const next = nav.redirect;
      nav.redirect = undefined;
      await navigate(page, next, nav);
    }
    await waitFor(() => activity.pendingNavigations.size === 0, LIMITS.navigationMs, "page navigation");
    if (nav.blocked) throw new ConversionError(nav.blocked);
    if (nav.redirect) continue;
    await page.waitForLoadState("load", { timeout: LIMITS.navigationMs }).catch((e: unknown) => {
      throw new ConversionError(diag("TIMEOUT", `page did not finish loading: ${String(e).split("\n")[0]}`));
    });
    const before = activity.navigations;
    // Evaluating while the document is being replaced throws; that's a navigation, not a failure.
    const completed = await settleOnce(page, () => activity.inflight).then(
      () => true,
      (e: unknown) => {
        if (activity.navigations === before && activity.pendingNavigations.size === 0) throw e;
        return false;
      },
    );
    const moved =
      !completed ||
      activity.navigations !== before ||
      activity.pendingNavigations.size > 0 ||
      nav.redirect !== undefined;
    if (nav.blocked) throw new ConversionError(nav.blocked);
    if (!moved) return;
    if (round === MAX_SELF_NAVIGATIONS) {
      diagnostics.push(
        diag("PAGE_REDIRECTED", `page kept navigating; captured its state after ${round + 1} navigations`, {
          detail: { captured: page.url() },
        }),
      );
      return;
    }
  }
}

/**
 * The documented wait options (docs/api.md): a selector for slow content that must exist before
 * the snapshot (dashboards that skeleton-load), then a short extra quiet wait. A selector that
 * never appears is a warning, not a failure: the current state is captured as-is.
 */
async function extraSettle(page: Page, options: CaptureOptions, diagnostics: Diagnostic[]): Promise<void> {
  const selectors = (options.waitForSelectors ?? []).map((s) => s.trim()).filter((s) => s !== "");
  for (const selector of selectors) {
    await page.waitForSelector(selector, { timeout: LIMITS.waitForSelectorMs }).catch(() => {
      diagnostics.push(
        diag("TIMEOUT", `waitForSelector "${selector}" never appeared; captured the current state`, {
          severity: "warning",
        }),
      );
    });
  }
  const extra = Math.min(Math.max(0, Math.floor(options.extraSettleMs ?? 0)), 5000);
  if (extra > 0) await page.waitForTimeout(extra);
}

/**
 * If the content scrolls inside an element instead of the document, make the viewport tall enough
 * for it, so the app lays itself out at full height (no CSS overrides). Bounded rounds: the layout
 * may change as the viewport grows.
 */
async function unrollScroller(
  page: Page,
  viewport: Viewport,
  inflight: () => number,
  diagnostics: Diagnostic[],
) {
  let height = viewport.height;
  for (let round = 0; round < 3; round++) {
    const hidden = Number(await inPage(page, "__w2f.hiddenScrollHeight()"));
    if (!(hidden > 1)) break;
    const next = Math.min(Math.ceil(height + hidden), LIMITS.maxCaptureHeight);
    if (next <= height) break;
    height = next;
    await page.setViewportSize({ width: viewport.width, height });
    await settleOnce(page, inflight);
  }
  if (height === viewport.height) return;
  diagnostics.push(
    diag(
      "SCROLL_CONTAINER_EXPANDED",
      `the page scrolls inside an element, not the document; captured at ${viewport.width}×${height} so all of it shows (elements sized to the viewport, e.g. 100vh sidebars, are drawn that tall)`,
      { detail: { viewportHeight: viewport.height, capturedHeight: height } },
    ),
  );
}

export async function capture(
  url: string,
  viewport: Viewport,
  options: CaptureOptions = {},
): Promise<Result<CaptureOutput>> {
  const policy = createPolicy({ allowPrivateNetworks: options.allowPrivateNetworks ?? true });
  const first = await policy.check(url, false);
  if (first) return { ok: false, diagnostics: [first] };

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
    permissions: [],
    ...(options.storageState ? { storageState: options.storageState } : {}),
  });
  const diagnostics: Diagnostic[] = [];
  const blockedHosts = new Set<string>();
  const nav: NavState = {};
  const activity: Activity = { inflight: 0, navigations: 0, pendingNavigations: new Set() };
  const fetchedImages = new Map<string, Buffer>();
  let imageBytes = 0;

  const run = async (): Promise<CaptureOutput> => {
    const page = await context.newPage();
    page.on("dialog", (d) => void d.dismiss());
    context.on("page", (p) => p !== page && void p.close());
    context.on("request", () => activity.inflight++);
    context.on("requestfinished", () => activity.inflight--);
    context.on("requestfailed", () => activity.inflight--);
    await guardNetwork(context, page, policy, {
      blocked: (d, isNav) => {
        if (isNav) nav.blocked ??= d;
        else if (!blockedHosts.has(d.message)) {
          blockedHosts.add(d.message);
          diagnostics.push({ ...d, severity: "warning", message: `blocked subresource: ${d.message}` });
        }
      },
      redirect: (next) => {
        nav.redirect = next;
      },
      image: (url, body) => {
        // Over the limits: not kept, so decodeImages reports it.
        if (body.length > LIMITS.maxAssetBytes || imageBytes + body.length > LIMITS.maxImageStoreBytes)
          return;
        imageBytes += body.length - (fetchedImages.get(url)?.length ?? 0);
        fetchedImages.set(url, body);
      },
    });

    const isMainNav = (r: Request) => r.isNavigationRequest() && r.frame() === page.mainFrame();
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) activity.navigations++;
    });
    page.on("request", (r) => {
      if (isMainNav(r)) activity.pendingNavigations.add(r);
    });
    page.on("response", (r) => {
      activity.pendingNavigations.delete(r.request());
    });
    page.on("requestfailed", (r) => {
      activity.pendingNavigations.delete(r);
    });
    await navigate(page, url, nav);
    await settle(page, nav, activity, diagnostics);
    await unrollScroller(page, viewport, () => activity.inflight, diagnostics);
    await extraSettle(page, options, diagnostics);

    const collector = await collectorHandle(page);
    const collected = await withTimeout(
      collector.evaluateHandle((m, opts) => m.collect(opts), {
        maxNodes: LIMITS.maxElements,
        dpr: viewport.dpr,
      }),
      LIMITS.evaluateMs,
      "DOM extraction",
    );
    const raw: RawSnapshot = await collected.evaluate((c) => c.snapshot);
    // The IR records the viewport that was asked for, even if unrollScroller made the window taller.
    const snapshot: RawSnapshot = { ...raw, viewport: { ...raw.viewport, height: viewport.height } };
    if (snapshot.truncated) {
      throw new ConversionError(
        diag("PAGE_TOO_LARGE", `page has more than ${LIMITS.maxElements} elements`, {
          detail: { limit: LIMITS.maxElements },
        }),
      );
    }
    if (snapshot.url !== new URL(url).href) {
      diagnostics.push(
        diag("PAGE_REDIRECTED", `requested ${url} but the page ended at ${snapshot.url}`, {
          detail: { requested: url, captured: snapshot.url },
        }),
      );
    }
    const screenshot = await page.screenshot({
      type: "png",
      scale: "css",
      fullPage: true,
      animations: "disabled",
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: Math.min(snapshot.documentSize.height, LIMITS.maxReferenceHeight),
      },
    });
    const images = await decodeImages(
      browser,
      imagePlan(snapshot, LIMITS.maxCaptureHeight),
      fetchedImages,
      viewport.dpr,
      diagnostics,
    );
    const rasters = await renderRasters(
      browser,
      page,
      (id) => collector.evaluate((m, a) => m.isolate(a.c.elements, a.id), { c: collected, id }),
      rasterPlan(snapshot, LIMITS.maxCaptureHeight, (key) => images.has(key)),
      snapshot.documentSize,
      viewport.dpr,
      diagnostics,
    );
    return { snapshot, screenshot, rasters, images, diagnostics };
  };

  try {
    return { ok: true, value: await withTimeout(run(), LIMITS.jobMs, "capture") };
  } catch (e) {
    if (e instanceof ConversionError) return { ok: false, diagnostics: [...diagnostics, e.diagnostic] };
    throw e;
  } finally {
    await context.close();
  }
}
