import { type Diagnostic, type Document, parseBundle } from "@w2f/ir";
import { unknownDiagnosticCodes } from "./unknown-codes.ts";

export type ReadBundle =
  | { ok: true; ir: Document; assets: Record<string, Uint8Array> }
  | { ok: false; title: string; diagnostics: Diagnostic[] };

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Validates parsed bundle JSON from either source (a dropped file or the capture service) and
 * decodes its assets. `name` only labels messages.
 */
export function readBundle(json: unknown, name: string): ReadBundle {
  const isBundle = typeof json === "object" && json !== null && "format" in json;
  if (!isBundle)
    return {
      ok: false,
      title: `${name} is not a web-to-figma bundle.`,
      diagnostics: [
        {
          code: "BUNDLE_INVALID",
          severity: "fatal",
          message: "Pick a .w2f.json file created by web-to-figma (e.g. .data/landing.w2f.json).",
        },
      ],
    };
  const bundle = parseBundle(json);
  if (!bundle.ok) {
    const unknown = unknownDiagnosticCodes(json);
    if (unknown.length > 0)
      return {
        ok: false,
        title: `${name} uses newer diagnostics (${unknown.join(", ")}) than this plugin build knows.`,
        diagnostics: [
          {
            code: "BUNDLE_INVALID",
            severity: "fatal",
            message: "Update the plugin (or rebuild it from the same checkout that captured the bundle).",
          },
        ],
      };
    return { ok: false, title: `${name} can't be imported.`, diagnostics: bundle.diagnostics };
  }
  const { ir, assetData } = bundle.value;
  const assets = Object.fromEntries(Object.entries(assetData).map(([id, b64]) => [id, decode(b64)]));
  return { ok: true, ir, assets };
}
