import type * as Collector from "@w2f/capture/collector";
import { LIMITS } from "@w2f/capture/limits";
import { type Captured, shotTops } from "./bundle.ts";

/** What result.html receives: the capture plus its visible-tab screenshots, or why there is none. */
export type Handoff = (Captured & { screenshots: { top: number; png: string }[] }) | { error: string };

declare const __w2f: typeof Collector;

// Held until result.html takes it (a moment later); never written to storage.
const pending = new Map<string, Handoff>();

// These run in the tab's isolated world, after collector.js defined `__w2f` there.

/**
 * App shells scroll inside an element, so grow it until all of it shows. Not while a dialog or menu
 * is open: then the screen as it is is the point, and the backdrop covers the rest anyway.
 */
async function unrollInTab(maxHeight: number): Promise<number> {
  const overlays = document.querySelectorAll(
    '[role="dialog"],[aria-modal="true"],dialog[open],[role="menu"],[role="listbox"]',
  );
  if (Array.from(overlays).some((el) => el.getClientRects().length > 0)) return 0;
  await __w2f.scrollPanels(maxHeight);
  let added = __w2f.unrollInPlace(maxHeight);
  // Dashboards often render widgets only once they're in view: let them, then grow again.
  for (let round = 0; added > 0 && round < 5; round++) {
    await __w2f.nextFrames();
    await new Promise((r) => setTimeout(r, 300));
    const now = __w2f.unrollInPlace(maxHeight);
    if (now === added) break;
    added = now;
  }
  return added;
}

/** Leaves the page grown, for `shiftInTab`'s screenshots; `restoreInTab` puts it back. */
function collectInTab(maxNodes: number, maxHeight: number, grownBy: number): Captured {
  // Page scripts ran since (resize observers, "100vh" hooks) and may have put heights back: grow
  // again in this same task, so nothing runs between it and the collect.
  const expanded = grownBy ? __w2f.unrollInPlace(maxHeight) : 0;
  const { snapshot } = __w2f.collect({ maxNodes, dpr: window.devicePixelRatio });
  const grown = __w2f.unrollLog();
  return {
    snapshot,
    scroll: { x: window.scrollX, y: window.scrollY },
    ...(expanded ? { expanded } : {}),
    ...(grown ? { grown } : {}),
  };
}

/** Shows the collected layout from `y` px further down, for the next screenshot. */
function shiftInTab(y: number): Promise<boolean> {
  return __w2f.shiftPage(y);
}

function restoreInTab(): boolean {
  return typeof __w2f === "undefined" || __w2f.restoreUnroll();
}

/** Capture the tab as it is on screen (open dialogs and menus included) and open the result page. */
async function captureTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  let handoff: Handoff;
  try {
    const target = { tabId: tab.id };
    await chrome.scripting.executeScript({ target, files: ["collector.js"] });
    try {
      const [unroll] = await chrome.scripting.executeScript({
        target,
        func: unrollInTab,
        args: [LIMITS.maxCaptureHeight],
      });
      const expanded = unroll?.result ?? 0;
      // Chrome refuses more than 2 captures a second.
      let last = 0;
      const shoot = async () => {
        await new Promise((r) => setTimeout(r, last + 550 - Date.now()));
        last = Date.now();
        return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      };
      // After unrolling, so the screenshot matches the layout that is collected.
      const first = await shoot();
      const [run] = await chrome.scripting.executeScript({
        target,
        func: collectInTab,
        args: [LIMITS.maxElements, LIMITS.maxCaptureHeight, expanded],
      });
      if (!run?.result) throw new Error("the page returned nothing");
      // Islands below the window: more screenshots, further down the same layout.
      const tops = shotTops(run.result, LIMITS.maxScreenshots);
      const screenshots = [{ top: tops[0] ?? 0, png: first }];
      for (const top of tops.slice(1)) {
        await chrome.scripting.executeScript({
          target,
          func: shiftInTab,
          args: [top - run.result.scroll.y],
        });
        screenshots.push({ top, png: await shoot() });
      }
      handoff = { ...run.result, screenshots };
    } finally {
      await chrome.scripting.executeScript({ target, func: restoreInTab });
    }
  } catch (e) {
    // Chrome pages, the Web Store and PDFs refuse scripts; report it on the result page.
    const why = e instanceof Error ? e.message : String(e);
    handoff = {
      error: `"${tab.title || tab.url || "this tab"}" can't be read by extensions (${why}). Browsers block their own pages: error pages ("Problem loading page"), about:/chrome:// pages, add-on stores and PDFs. Load the page you want, wait until it shows, then capture again.`,
    };
  }
  const id = crypto.randomUUID();
  pending.set(id, handoff);
  await chrome.tabs.create({ url: `result.html#${id}`, index: tab.index + 1, openerTabId: tab.id });
}

chrome.action.onClicked.addListener((tab) => void captureTab(tab));

chrome.runtime.onMessage.addListener((msg: { take?: string }, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !msg.take) return;
  reply(pending.get(msg.take) ?? null);
  pending.delete(msg.take);
});

// For the integration test, which can't click the toolbar button.
(globalThis as { w2fCaptureTab?: typeof captureTab }).w2fCaptureTab = captureTab;
