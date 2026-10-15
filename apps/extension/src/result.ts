import { decodeImage } from "@w2f/capture/collector";
import { LIMITS } from "@w2f/capture/limits";
import type { Diagnostic } from "@w2f/ir";
import type { Handoff } from "./background.ts";
import { type Deps, toBundle } from "./bundle.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>("status");
const actions = $<HTMLDivElement>("actions");
const list = $<HTMLUListElement>("diagnostics");

function showDiagnostics(diagnostics: Diagnostic[]) {
  const rank = { fatal: 0, error: 1, warning: 2, info: 3 };
  for (const d of [...diagnostics].sort((a, b) => rank[a.severity] - rank[b.severity])) {
    const li = document.createElement("li");
    li.className = d.severity;
    li.textContent = `${d.code}: ${d.message}${d.detail?.grown ? ` (grown: ${d.detail.grown})` : ""}`;
    list.append(li);
  }
}

/**
 * Images are fetched again from this extension page: host permissions let it read any origin, and
 * `credentials: "include"` sends the user's cookies, so logged-in images load as they did in the tab.
 */
async function fetchImage(url: string): Promise<Uint8Array | string> {
  if (!/^(https?|data):/i.test(url)) return `${url.split(":")[0]}: URLs can't be read from the extension`;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return `HTTP ${res.status}`;
    if (Number(res.headers.get("content-length") ?? 0) > LIMITS.maxAssetBytes)
      return `over ${LIMITS.maxAssetBytes / 1e6} MB`;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return `could not be fetched (${String(e)})`;
  }
}

async function deps(screenshot: string, viewportWidth: number): Promise<Deps> {
  const shot = await createImageBitmap(await (await fetch(screenshot)).blob());
  const screenshotScale = shot.width / viewportWidth;
  return {
    fetch: fetchImage,
    decode: (a) =>
      // ponytail: a stuck decode is abandoned, not killed; it only costs this tab.
      Promise.race([
        decodeImage(a),
        new Promise<{ error: string }>((r) =>
          setTimeout(() => r({ error: `no result after ${LIMITS.decodeMs / 1000}s` }), LIMITS.decodeMs),
        ),
      ]),
    screenshotScale,
    async crop(rect, scale) {
      const w = Math.max(1, Math.round(rect.width * scale));
      const h = Math.max(1, Math.round(rect.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas");
      const s = screenshotScale;
      ctx.drawImage(shot, rect.x * s, rect.y * s, rect.width * s, rect.height * s, 0, 0, w, h);
      return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    },
  };
}

function fileName(url: string): string {
  const u = new URL(url);
  const slug = `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${slug.slice(0, 80) || "page"}.w2f.json`;
}

async function main() {
  const handoff: Handoff | null = await chrome.runtime.sendMessage({ take: location.hash.slice(1) });
  if (!handoff) {
    status.textContent = "This capture is no longer available. Capture the page again.";
    return;
  }
  if ("error" in handoff) {
    status.textContent = handoff.error;
    return;
  }
  const { snapshot } = handoff;
  document.title = `Web to Figma: ${snapshot.title || snapshot.url}`;
  $("page").textContent =
    `${snapshot.title || "Untitled"} (${snapshot.url}), ${snapshot.viewport.width}×${snapshot.viewport.height}`;
  // Firefox lets users withhold "all sites" access; without it, cross-origin images can't be read.
  const all = { origins: ["<all_urls>"] };
  if (!(await chrome.permissions.contains(all))) {
    status.textContent =
      "Reading this page's images needs access to all sites (they can come from any domain).";
    const prompt = $<HTMLDivElement>("permission");
    prompt.hidden = false;
    await new Promise<void>((done) => {
      // permissions.request must run straight from the click.
      $("allow").addEventListener("click", () => void chrome.permissions.request(all).finally(done));
      $("skip").addEventListener("click", () => done());
    });
    prompt.hidden = true;
  }
  status.textContent = "Converting…";
  const result = await toBundle(handoff, await deps(handoff.screenshot, snapshot.viewport.width));
  if (!result.ok) {
    status.textContent = "The capture failed.";
    showDiagnostics(result.diagnostics);
    return;
  }
  const json = JSON.stringify(result.value);
  status.textContent = `Ready (${(json.length / 1e6).toFixed(1)} MB). Download it or copy it, then import it in the Web to Figma plugin.`;
  showDiagnostics(result.value.ir.diagnostics);
  actions.hidden = false;

  $("download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = fileName(snapshot.url);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  });
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(json);
      $("copy").textContent =
        `Copied ${(json.length / 1e6).toFixed(1)} MB: click the plugin's paste box, then Ctrl+V`;
    } catch (e) {
      $("copy").textContent = `Copy failed (${String(e)}): use Download instead`;
    }
  });
}

main().catch((e: unknown) => {
  status.textContent = `Something went wrong: ${String(e)}`;
});
