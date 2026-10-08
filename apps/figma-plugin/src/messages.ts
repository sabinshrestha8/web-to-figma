import type { Diagnostic, Document } from "@w2f/ir";

/**
 * The UI iframe (a full browser) validates the bundle with zod and decodes assets, so the
 * sandboxed main thread receives an already-validated document and raw bytes.
 */
export type ToCode =
  | { type: "build"; ir: Document; assets: Record<string, Uint8Array> }
  /** Dev: PNG of the selected capture frame at 1×, for `pnpm compare` against the reference screenshot. */
  | { type: "export" };

export type ToUI =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; nodes: number; ms: number; diagnostics: Diagnostic[] }
  | { type: "failed"; diagnostics: Diagnostic[] }
  | { type: "exported"; name: string; png: Uint8Array }
  | { type: "export-failed"; message: string };
