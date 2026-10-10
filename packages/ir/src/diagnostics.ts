import { z } from "zod";

export const Severity = z.enum(["fatal", "error", "warning", "info"]);
export type Severity = z.infer<typeof Severity>;

/**
 * Every diagnostic the system can emit, with its default severity.
 * Adding a code here requires a row in docs/diagnostics.md (enforced by tests/docs.test.ts).
 */
export const DIAGNOSTIC_CODES = {
  NAVIGATION_FAILED: "fatal",
  URL_BLOCKED: "fatal",
  TIMEOUT: "fatal",
  PAGE_TOO_LARGE: "fatal",
  BUNDLE_INVALID: "fatal",
  SCHEMA_VERSION_UNSUPPORTED: "fatal",
  FIGMA_BUILD_FAILED: "fatal",
  IMAGE_FAILED: "error",
  ASSET_REJECTED: "error",
  SVG_IMPORT_FAILED: "error",
  FONT_SUBSTITUTED: "warning",
  UNSUPPORTED_CSS: "warning",
  BORDER_COLORS_MIXED: "warning",
  TEXT_REFLOW: "warning",
  PSEUDO_ELEMENT_SKIPPED: "warning",
  PAGE_HEIGHT_CLIPPED: "warning",
  PAGE_REDIRECTED: "warning",
  EMPTY_CAPTURE: "warning",
  RASTERIZED: "warning",
  IGNORE_SELECTOR_UNUSED: "warning",
  LAYOUT_ABSOLUTE_FALLBACK: "info",
  SCROLL_CONTAINER_EXPANDED: "info",
} as const satisfies Record<string, Severity>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;
const codes = Object.keys(DIAGNOSTIC_CODES) as [DiagnosticCode, ...DiagnosticCode[]];

export const Fallback = z.enum([
  "absolute",
  "rasterized",
  "substituted",
  "approximated",
  "skipped",
  "placeholder",
]);

export const Diagnostic = z.object({
  code: z.enum(codes),
  severity: Severity,
  message: z.string().min(1),
  captureId: z.string().optional(),
  nodeId: z.string().optional(),
  detail: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  fallback: Fallback.optional(),
});
export type Diagnostic = z.infer<typeof Diagnostic>;

/** Build a diagnostic; severity defaults to the code's default (override via `extra.severity`). */
export function diag(
  code: DiagnosticCode,
  message: string,
  extra: Partial<Omit<Diagnostic, "code" | "message">> = {},
): Diagnostic {
  return { code, severity: DIAGNOSTIC_CODES[code], message, ...extra };
}

export type Result<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };

/** Thrown only for fatal conditions; everything recoverable is returned as a Diagnostic. */
export class ConversionError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = "ConversionError";
  }
}
