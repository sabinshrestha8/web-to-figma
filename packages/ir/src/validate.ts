import type { z } from "zod";
import { type Diagnostic, diag, type Result } from "./diagnostics.ts";
import { migrate } from "./migrations.ts";
import { Document } from "./schema.ts";

/** Turn zod issues into BUNDLE_INVALID diagnostics (capped so a broken file doesn't flood the UI). */
export function issuesToDiagnostics(error: z.ZodError, limit = 20): Diagnostic[] {
  return error.issues
    .slice(0, limit)
    .map((i) => diag("BUNDLE_INVALID", `${i.path.join(".") || "(root)"}: ${i.message}`));
}

/** Trust boundary: migrate then validate an untrusted IR document. */
export function parseDocument(input: unknown): Result<Document> {
  const migrated = migrate(input);
  if (!migrated.ok) return migrated;
  const parsed = Document.safeParse(migrated.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, diagnostics: issuesToDiagnostics(parsed.error) };
}
