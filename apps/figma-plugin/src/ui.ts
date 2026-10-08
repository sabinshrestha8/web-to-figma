import { type Diagnostic, parseBundle } from "@w2f/ir";
import type { FontReportEntry } from "./map/fonts.ts";
import type { ToCode, ToUI } from "./messages.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $<HTMLLabelElement>("drop");
const input = $<HTMLInputElement>("file");
const status = $<HTMLParagraphElement>("status");
const list = $<HTMLUListElement>("diagnostics");
const exportButton = $<HTMLButtonElement>("export");
const confirm = $<HTMLDivElement>("confirm");
/** The bundle's capture diagnostics, shown again with the build's own. */
let captureDiagnostics: Diagnostic[] = [];

const send = (m: ToCode) => parent.postMessage({ pluginMessage: m }, "*");

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

function show(text: string, diagnostics: Diagnostic[] = []) {
  status.textContent = text;
  confirm.hidden = true;
  items(
    diagnostics.map((d) => ({ className: d.severity, text: `${d.severity} · ${d.code} — ${d.message}` })),
  );
}

/** The font report: the user sees every substitution before anything is built. */
function showFonts(fonts: FontReportEntry[]) {
  const missing = fonts.filter((f) => f.substituted).length;
  status.textContent = missing
    ? `${missing} of ${fonts.length} font styles are not in Figma and will be substituted. Install them and drop the bundle again, or build now.`
    : `All ${fonts.length} font styles are available.`;
  items(
    fonts.map((f) => ({
      className: f.substituted ? "warning" : "",
      text: `${f.requested} → ${f.font}${f.substituted ? " (substituted)" : ""} · ${f.runs} run(s)`,
    })),
  );
  confirm.hidden = false;
}

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function load(file: File) {
  show(`Reading ${file.name}…`);
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return show("Not a JSON file.", [
      { code: "BUNDLE_INVALID", severity: "fatal", message: `${file.name} is not valid JSON` },
    ]);
  }
  const isBundle = typeof json === "object" && json !== null && "format" in json;
  if (!isBundle) {
    return show(`${file.name} is not a web-to-figma bundle.`, [
      {
        code: "BUNDLE_INVALID",
        severity: "fatal",
        message: "Pick a .w2f.json file created by `pnpm w2f` (e.g. .data/landing.w2f.json).",
      },
    ]);
  }
  const bundle = parseBundle(json);
  if (!bundle.ok) return show(`${file.name} can't be imported.`, bundle.diagnostics);
  const { ir, assetData } = bundle.value;
  const assets = Object.fromEntries(Object.entries(assetData).map(([id, b64]) => [id, decode(b64)]));
  captureDiagnostics = ir.diagnostics;
  show(`Checking fonts for ${ir.captures.length} capture(s)…`);
  send({ type: "load", ir, assets });
}

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) void load(file);
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
  if (file) void load(file);
});

exportButton.addEventListener("click", () => send({ type: "export" }));
$<HTMLButtonElement>("build").addEventListener("click", () => {
  show("Building…");
  send({ type: "build" });
});
$<HTMLButtonElement>("cancel").addEventListener("click", () => {
  show("Cancelled. Drop a bundle to start again.");
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
  if (msg.type === "exported") {
    download(msg.name, msg.png);
    show(`Exported ${msg.name}.png — compare with: pnpm compare <reference.png> <export.png>`);
  } else if (msg.type === "export-failed") show(msg.message);
  else if (msg.type === "fonts") showFonts(msg.fonts);
  else if (msg.type === "progress") show(`Building… ${msg.done} / ${msg.total} nodes`);
  else if (msg.type === "done")
    show(`Built ${msg.nodes} nodes in ${(msg.ms / 1000).toFixed(1)}s.`, [
      ...captureDiagnostics,
      ...msg.diagnostics,
    ]);
  else show("Build failed.", msg.diagnostics);
};
