import { z } from "zod";
import { diag, type Result } from "./diagnostics.ts";
import { AssetId, type Document } from "./schema.ts";
import { issuesToDiagnostics, parseDocument } from "./validate.ts";

/** The `.w2f.json` file handed to the Figma plugin: IR plus base64 asset bytes. */
export const BUNDLE_FORMAT = "w2f-bundle";

const BundleShape = z.object({
  format: z.literal(BUNDLE_FORMAT),
  ir: z.unknown(), // validated separately so migration runs first
  assetData: z.record(AssetId, z.base64()),
});

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  ir: Document;
  assetData: Record<string, string>;
}

export function parseBundle(input: unknown): Result<Bundle> {
  const shape = BundleShape.safeParse(input);
  if (!shape.success) return { ok: false, diagnostics: issuesToDiagnostics(shape.error) };

  const ir = parseDocument(shape.data.ir);
  if (!ir.ok) return ir;

  const { assetData } = shape.data;
  const declared = Object.keys(ir.value.assets);
  const missing = declared.filter((id) => !(id in assetData));
  const extra = Object.keys(assetData).filter((id) => !(id in ir.value.assets));
  if (missing.length || extra.length) {
    return {
      ok: false,
      diagnostics: [
        diag("BUNDLE_INVALID", "assetData does not match ir.assets", {
          detail: { missing: missing.length, extra: extra.length },
        }),
      ],
    };
  }
  return { ok: true, value: { format: BUNDLE_FORMAT, ir: ir.value, assetData } };
}
