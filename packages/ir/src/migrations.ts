import { type Diagnostic, diag, type Result } from "./diagnostics.ts";
import { SCHEMA_VERSION } from "./schema.ts";

type Json = Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a major-n document to major n+1 and must set its schemaVersion.
 * Empty until the first breaking change (schema 2.0).
 */
const MIGRATIONS: Record<number, (doc: Json) => Json> = {};

const CURRENT_MAJOR = Number(SCHEMA_VERSION.split(".")[0]);

function fail(code: "BUNDLE_INVALID" | "SCHEMA_VERSION_UNSUPPORTED", message: string): Result<Json> {
  const d: Diagnostic = diag(code, message);
  return { ok: false, diagnostics: [d] };
}

/**
 * Bring any supported document up to the current major version.
 * Same major, different minor: accepted as-is (minors are additive; unknown fields are stripped by validation).
 */
export function migrate(input: unknown): Result<Json> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("BUNDLE_INVALID", "IR document must be a JSON object");
  }
  let doc = input as Json;
  const match = typeof doc.schemaVersion === "string" && /^(\d+)\.(\d+)$/.exec(doc.schemaVersion);
  if (!match) return fail("BUNDLE_INVALID", "missing or malformed schemaVersion");

  let major = Number(match[1]);
  if (major > CURRENT_MAJOR) {
    return fail(
      "SCHEMA_VERSION_UNSUPPORTED",
      `document is schema ${String(doc.schemaVersion)}, this build supports ${SCHEMA_VERSION}; update the plugin`,
    );
  }
  for (; major < CURRENT_MAJOR; major++) {
    const step = MIGRATIONS[major];
    if (!step) return fail("SCHEMA_VERSION_UNSUPPORTED", `no migration from schema ${major}.x`);
    doc = step(doc);
  }
  return { ok: true, value: { ...doc, schemaVersion: SCHEMA_VERSION } };
}
