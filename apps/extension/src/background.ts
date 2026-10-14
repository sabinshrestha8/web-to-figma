import type * as Collector from "@w2f/capture/collector";
import { LIMITS } from "@w2f/capture/limits";
import type { Captured } from "./bundle.ts";

/** What result.html receives: the capture plus the visible-tab screenshot, or why there is none. */
export type Handoff = (Captured & { screenshot: string }) | { error: string };

declare const __w2f: typeof Collector;

// Held until result.html takes it (a moment later); never written to storage.
const pending = new Map<string, Handoff>();

/** Runs in the tab's isolated world, after collector.js defined `__w2f` there. */
function collectInTab(maxNodes: number): Captured {
  const { snapshot } = __w2f.collect({ maxNodes, dpr: window.devicePixelRatio });
  return { snapshot, scroll: { x: window.scrollX, y: window.scrollY } };
}

/** Capture the tab as it is on screen (open dialogs and menus included) and open the result page. */
async function captureTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  let handoff: Handoff;
  try {
    // Screenshot first: nothing of ours has touched the page yet.
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const target = { tabId: tab.id };
    await chrome.scripting.executeScript({ target, files: ["collector.js"] });
    const [run] = await chrome.scripting.executeScript({
      target,
      func: collectInTab,
      args: [LIMITS.maxElements],
    });
    if (!run?.result) throw new Error("the page returned nothing");
    handoff = { ...run.result, screenshot };
  } catch (e) {
    // Chrome pages, the Web Store and PDFs refuse scripts; report it on the result page.
    handoff = { error: e instanceof Error ? e.message : String(e) };
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
