import { createHash } from "node:crypto";
import { snapshotToIR, toDocument } from "@w2f/convert";
import {
  type AssetMeta,
  BUNDLE_FORMAT,
  type Bundle,
  type Capture,
  type Diagnostic,
  parseDocument,
  type Result,
} from "@w2f/ir";
import { type CaptureOptions, capture, type Viewport } from "./capture.ts";
import { LIMITS } from "./limits.ts";

export interface ConvertJob extends CaptureOptions {
  urls: string[];
  viewports: Viewport[];
  onProgress?: (done: number, total: number, url: string) => void;
}

/** PNG width/height live at fixed offsets in the IHDR chunk. */
export function pngAsset(bytes: Buffer): { id: string; meta: AssetMeta; base64: string } {
  return {
    id: createHash("sha256").update(bytes).digest("hex"),
    meta: {
      mime: "image/png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      byteLength: bytes.length,
    },
    base64: bytes.toString("base64"),
  };
}

/** Capture every url × viewport and assemble a validated bundle. Failed captures are reported, not fatal. */
export async function convertUrls(job: ConvertJob): Promise<Result<Bundle>> {
  const captures: Capture[] = [];
  const assets: Record<string, AssetMeta> = {};
  const assetData: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  const total = job.urls.length * job.viewports.length;
  let n = 0;

  for (const url of job.urls) {
    for (const viewport of job.viewports) {
      const captureId = `c${++n}`;
      job.onProgress?.(n - 1, total, url);
      const result = await capture(url, viewport, job);
      if (!result.ok) {
        diagnostics.push(
          ...result.diagnostics.map((d) => ({ ...d, captureId, detail: { ...d.detail, url } })),
        );
        continue;
      }
      const add = (png: Buffer) => {
        const a = pngAsset(png);
        assets[a.id] = a.meta;
        assetData[a.id] = a.base64;
        return a.id;
      };
      const rasters = Object.fromEntries([...result.value.rasters].map(([key, png]) => [key, add(png)]));
      const converted = snapshotToIR(result.value.snapshot, {
        captureId,
        maxHeight: LIMITS.maxCaptureHeight,
        screenshot: add(result.value.screenshot),
        rasters,
      });
      captures.push(converted.capture);
      diagnostics.push(
        ...result.value.diagnostics.map((d) => ({ ...d, captureId })),
        ...converted.diagnostics,
      );
    }
  }
  if (captures.length === 0) return { ok: false, diagnostics };

  // Self-check: a converter bug should fail here, not inside Figma.
  const ir = parseDocument(toDocument(captures, assets, diagnostics));
  if (!ir.ok) return ir;
  return { ok: true, value: { format: BUNDLE_FORMAT, ir: ir.value, assetData } };
}
