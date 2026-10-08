import { type Diagnostic, type DiagnosticCode, diag } from "@w2f/ir";

/**
 * Collects per-node warnings as one diagnostic per (code, message), so a page with 300 shadowed
 * buttons reports one line with `count: 300` and an example node instead of 300 lines.
 */
export function createReport(captureId: string) {
  const seen = new Map<string, { d: Diagnostic; count: number }>();
  return {
    add(code: DiagnosticCode, message: string, nodeId: string, fallback?: Diagnostic["fallback"]) {
      const key = `${code}\u0000${message}`;
      const hit = seen.get(key);
      if (hit) hit.count++;
      else
        seen.set(key, {
          d: diag(code, message, { captureId, nodeId, ...(fallback ? { fallback } : {}) }),
          count: 1,
        });
    },
    list(): Diagnostic[] {
      return [...seen.values()].map(({ d, count }) => ({ ...d, detail: { ...d.detail, count } }));
    },
  };
}
export type Report = ReturnType<typeof createReport>;
