import { DIAGNOSTIC_CODES } from "@w2f/ir";

/**
 * Diagnostic codes in a dropped bundle that this plugin build doesn't know: the bundle was
 * captured by newer code than the plugin was built from. Rebuilding fixes it; without this
 * check the user only gets Zod's "Invalid option" list.
 */
export function unknownDiagnosticCodes(json: unknown): string[] {
  if (typeof json !== "object" || json === null) return [];
  const ir = (json as { ir?: unknown }).ir;
  if (typeof ir !== "object" || ir === null) return [];
  const list = (ir as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(list)) return [];
  const known = new Set(Object.keys(DIAGNOSTIC_CODES));
  const unknown = new Set<string>();
  for (const d of list) {
    if (typeof d === "object" && d !== null) {
      const code = (d as { code?: unknown }).code;
      if (typeof code === "string" && !known.has(code)) unknown.add(code);
    }
  }
  return [...unknown].sort();
}
