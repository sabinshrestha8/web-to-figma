import { type Diagnostic, parseBundle } from "@w2f/ir";
import type { ToCode, ToUI } from "./messages.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $<HTMLLabelElement>("drop");
const input = $<HTMLInputElement>("file");
const status = $<HTMLParagraphElement>("status");
const list = $<HTMLUListElement>("diagnostics");
const exportButton = $<HTMLButtonElement>("export");

function show(text: string, diagnostics: Diagnostic[] = []) {
  status.textContent = text;
  list.replaceChildren(
    ...diagnostics.map((d) => {
      const li = document.createElement("li");
      li.className = d.severity;
      li.textContent = `${d.severity} · ${d.code} — ${d.message}`;
      return li;
    }),
  );
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
  show(`Building ${ir.captures.length} capture(s)…`, ir.diagnostics);
  parent.postMessage({ pluginMessage: { type: "build", ir, assets } satisfies ToCode }, "*");
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

exportButton.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "export" } satisfies ToCode }, "*");
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
  else if (msg.type === "progress") show(`Building… ${msg.done} / ${msg.total} nodes`);
  else if (msg.type === "done")
    show(`Built ${msg.nodes} nodes in ${(msg.ms / 1000).toFixed(1)}s.`, msg.diagnostics);
  else show("Build failed.", msg.diagnostics);
};
