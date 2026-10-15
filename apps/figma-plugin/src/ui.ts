import type { Diagnostic } from "@w2f/ir";
import type { FontReportEntry } from "./map/fonts.ts";
import type { ToCode, ToUI } from "./messages.ts";
import { readBundle } from "./read-bundle.ts";
import { importUrl, mb, normalizeUrl, RemoteError, type Update } from "./remote.ts";

/** Set at build time (build.mjs): the capture service, and whether dev-only tools are hidden. */
declare const W2F_API_URL: string;
declare const W2F_RELEASE: boolean;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const urlInput = $<HTMLInputElement>("url");
const viewport = $<HTMLSelectElement>("viewport");
const clickInput = $<HTMLTextAreaElement>("click");
const waitInput = $<HTMLTextAreaElement>("wait");
const tokenInput = $<HTMLInputElement>("token");
const go = $<HTMLButtonElement>("go");
const busy = $<HTMLDivElement>("busy");
const progress = $<HTMLProgressElement>("progress");
const drop = $<HTMLLabelElement>("drop");
const input = $<HTMLInputElement>("file");
const status = $<HTMLParagraphElement>("status");
const list = $<HTMLUListElement>("diagnostics");
const exportButton = $<HTMLButtonElement>("export");
const confirm = $<HTMLDivElement>("confirm");
/** The bundle's capture diagnostics, shown again with the build's own. */
let captureDiagnostics: Diagnostic[] = [];
/** The running URL import, if any. */
let importing: AbortController | null = null;

const send = (m: ToCode) => parent.postMessage({ pluginMessage: m }, "*");
exportButton.hidden = W2F_RELEASE;

function items(lines: { className: string; text: string }[]) {
  list.replaceChildren(
    ...lines.map(({ className, text }) => {
      const li = document.createElement("li");
      li.className = className;
      li.textContent = text;
      return li;
    }),
  );
}

/** `value` sets a determinate bar, null an indeterminate one, undefined hides it. */
function bar(value?: number | null) {
  progress.hidden = value === undefined;
  if (value === null) progress.removeAttribute("value");
  else if (value !== undefined) progress.value = value;
}

function show(text: string, diagnostics: Diagnostic[] = []) {
  status.textContent = text;
  confirm.hidden = true;
  bar();
  items(
    diagnostics.map((d) => ({ className: d.severity, text: `${d.severity} · ${d.code} — ${d.message}` })),
  );
}

function setBusy(on: boolean) {
  busy.hidden = !on;
  go.disabled = on;
  drop.style.pointerEvents = on ? "none" : "";
}

/** The font report. With nothing to substitute it builds right away; otherwise the user decides. */
function showFonts(fonts: FontReportEntry[]) {
  const missing = fonts.filter((f) => f.substituted).length;
  if (missing === 0) {
    show("Building…");
    bar(null);
    return send({ type: "build" });
  }
  status.textContent = `${missing} of ${fonts.length} font styles are not in Figma and will be substituted. Install them and import again, or build now.`;
  items(
    fonts.map((f) => ({
      className: f.substituted ? "warning" : "",
      text: `${f.requested} → ${f.font}${f.substituted ? " (substituted)" : ""} · ${f.runs} run(s)`,
    })),
  );
  confirm.hidden = false;
}

function load(json: unknown, name: string) {
  const r = readBundle(json, name);
  if (!r.ok) return show(r.title, r.diagnostics);
  captureDiagnostics = r.ir.diagnostics;
  show(`Checking fonts for ${r.ir.captures.length} capture(s)…`);
  bar(null);
  send({ type: "load", ir: r.ir, assets: r.assets });
}

function loadText(text: string, name: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return show("Not a JSON file.", [
      { code: "BUNDLE_INVALID", severity: "fatal", message: `${name} is not valid JSON` },
    ]);
  }
  load(json, name);
}

async function loadFile(file: File) {
  show(`Reading ${file.name}…`);
  loadText(await file.text(), file.name);
}

const lines = (t: HTMLTextAreaElement) =>
  t.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

/** Only what the server reports: no simulated progress. */
function describe(u: Update) {
  if (u.phase === "sending") show("Sending to the capture service…");
  else if (u.phase === "queued") show(`Waiting for a free browser (position ${u.position})…`);
  else if (u.phase === "running") show("Rendering the page and reading its layout…");
  else show(`Downloading the design… ${mb(u.received)}${u.total ? ` of ${mb(u.total)}` : ""}`);
  if (u.phase === "running") bar(u.progress || null);
  else if (u.phase === "downloading") bar(u.total ? u.received / u.total : null);
  else bar(null);
}

// A click handler, not a form submit: sandboxed iframes without allow-forms never fire "submit".
async function start() {
  if (importing) return;
  const url = normalizeUrl(urlInput.value);
  urlInput.setAttribute("aria-invalid", String(!url));
  if (!url) {
    urlInput.focus();
    return show("Enter a web address starting with http:// or https://.");
  }
  const click = lines(clickInput);
  const waitFor = lines(waitInput);
  const controller = new AbortController();
  importing = controller;
  setBusy(true);
  try {
    const json = await importUrl({
      api: W2F_API_URL,
      token: tokenInput.value.trim() || undefined,
      request: {
        url,
        viewports: viewport.value.split(","),
        ...(click.length ? { click } : {}),
        ...(waitFor.length ? { waitFor } : {}),
      },
      signal: controller.signal,
      onUpdate: describe,
    });
    load(json, new URL(url).hostname);
  } catch (err) {
    if (controller.signal.aborted) show("Cancelled.");
    else if (err instanceof RemoteError) show(err.message, err.diagnostics);
    else show(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    importing = null;
    setBusy(false);
  }
}
go.addEventListener("click", () => void start());
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void start();
});
$<HTMLButtonElement>("stop").addEventListener("click", () => importing?.abort());
urlInput.addEventListener("input", () => urlInput.removeAttribute("aria-invalid"));
tokenInput.addEventListener("change", () => send({ type: "set-token", token: tokenInput.value.trim() }));

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) void loadFile(file);
});
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});

// A bundle copied by the browser extension ("Copy for the plugin"). Figma desktop sends Ctrl+V to
// the canvas unless a text field in the plugin has focus, so the bundle goes into its own box.
const pasteBox = $<HTMLTextAreaElement>("paste");
pasteBox.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text/plain") ?? "";
  // Keeps a multi-MB bundle out of the box. If the event carries no text (some hosts don't fill
  // clipboardData), the paste goes ahead and the input handler reads the box instead.
  if (!text.trim()) return show("Reading the paste…");
  e.preventDefault();
  loadText(text, "The pasted text");
});
pasteBox.addEventListener("input", () => {
  const text = pasteBox.value.trim();
  pasteBox.value = "";
  if (!text) return;
  if (!text.startsWith("{"))
    return show(
      `That isn't a bundle (${text.length} characters pasted). Choose Copy for the plugin in the extension, then paste again.`,
    );
  loadText(text, "The pasted text");
});

exportButton.addEventListener("click", () => send({ type: "export" }));
$<HTMLButtonElement>("build").addEventListener("click", () => {
  show("Building…");
  bar(null);
  send({ type: "build" });
});
$<HTMLButtonElement>("cancel").addEventListener("click", () => {
  show("Cancelled.");
  send({ type: "cancel" });
});

function download(name: string, png: Uint8Array) {
  const url = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, "_")}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.onmessage = (e: MessageEvent<{ pluginMessage?: ToUI }>) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;
  if (msg.type === "settings") tokenInput.value = msg.token;
  else if (msg.type === "exported") {
    download(msg.name, msg.png);
    show(`Exported ${msg.name}.png — compare with: pnpm compare <reference.png> <export.png>`);
  } else if (msg.type === "export-failed") show(msg.message);
  else if (msg.type === "fonts") showFonts(msg.fonts);
  else if (msg.type === "progress") {
    show(`Building… ${msg.done} / ${msg.total} layers`);
    bar(msg.total ? msg.done / msg.total : null);
  } else if (msg.type === "done")
    show(`Done: built ${msg.nodes} layers in ${(msg.ms / 1000).toFixed(1)}s.`, [
      ...captureDiagnostics,
      ...msg.diagnostics,
    ]);
  else show("Build failed.", msg.diagnostics);
};
send({ type: "get-settings" });
