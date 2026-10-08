import type { Diagnostic, Document } from "@w2f/ir";
import type { FontReportEntry } from "./map/fonts.ts";

/**
 * The UI iframe (a full browser) validates the bundle with zod and decodes assets, so the
 * sandboxed main thread receives an already-validated document and raw bytes.
 * Flow: "load" → main replies "fonts" (the font report) → the user confirms with "build" or "cancel".
 */
export type ToCode =
  | { type: "load"; ir: Document; assets: Record<string, Uint8Array> }
  | { type: "build" }
  | { type: "cancel" }
  /** Dev: PNG of the selected capture frame at 1×, for `pnpm compare` against the reference screenshot. */
  | { type: "export" };

export type ToUI =
  | { type: "fonts"; fonts: FontReportEntry[] }
  | { type: "progress"; done: number; total: number }
  | { type: "done"; nodes: number; ms: number; diagnostics: Diagnostic[] }
  | { type: "failed"; diagnostics: Diagnostic[] }
  | { type: "exported"; name: string; png: Uint8Array }
  | { type: "export-failed"; message: string };
