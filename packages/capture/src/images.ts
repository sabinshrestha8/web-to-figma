import type { ImageRequest } from "@w2f/convert";
import { type Diagnostic, diag } from "@w2f/ir";
import type { Browser } from "playwright";
import type { DecodeArgs, DecodeResult } from "./collector/decode.ts";
import { collectorHandle } from "./in-page.ts";
import { LIMITS } from "./limits.ts";

export interface DecodedImage {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg" | "image/gif";
  /** Pixel size of `bytes`. */
  pixelWidth: number;
  pixelHeight: number;
  /** Intrinsic size of the source, px. */
  width: number;
  height: number;
}

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

/** The image type from the bytes themselves; the server's Content-Type is not trusted. */
export function sniffImage(b: Buffer): string | null {
  if (ascii(b, 1, 4) === "PNG" && b[0] === 0x89) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(b, 0, 4) === "GIF8") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(b, 8, 12))) return "image/avif";
  if (ascii(b, 0, 2) === "BM") return "image/bmp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  if (/^\s*</.test(ascii(b, 0, 64)) && /<svg[\s>]/i.test(b.subarray(0, 4096).toString("utf8")))
    return "image/svg+xml";
  return null;
}

/** `data:` URL → bytes, or null if it isn't one / is malformed. */
export function dataUrlBytes(url: string): Buffer | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const body = m[2] ?? "";
  if (m[1]) return Buffer.from(body, "base64");
  try {
    return Buffer.from(decodeURIComponent(body), "utf8");
  } catch {
    return null; // malformed percent-encoding: reported by the caller as undecodable
  }
}

const PASSTHROUGH = new Set(["image/png", "image/jpeg", "image/gif"]);

/**
 * Decode every image `imagePlan` asked for into bytes Figma accepts (PNG/JPEG/GIF, ≤ 4096 px a
 * side). Bytes come from the network guard's capture of the page's own responses, or `data:` URLs;
 * nothing is fetched again. Decoding happens in a blank page of a separate context with every
 * request refused, so a hostile image (or SVG) never shares a document with anything.
 */
export async function decodeImages(
  browser: Browser,
  requests: ImageRequest[],
  fetched: ReadonlyMap<string, Buffer>,
  dpr: number,
  diagnostics: Diagnostic[],
): Promise<Map<string, DecodedImage>> {
  const out = new Map<string, DecodedImage>();
  const reject = (r: ImageRequest, why: string) =>
    diagnostics.push(
      diag("ASSET_REJECTED", `image ${r.kind === "url" ? r.src.slice(0, 200) : r.key} not used: ${why}`, {
        fallback: "placeholder",
      }),
    );
  if (requests.length > LIMITS.maxAssets) {
    diagnostics.push(
      diag(
        "ASSET_REJECTED",
        `page uses ${requests.length} images; only the first ${LIMITS.maxAssets} were kept`,
        {
          detail: { requested: requests.length, limit: LIMITS.maxAssets },
          fallback: "placeholder",
        },
      ),
    );
  }
  const todo = requests.slice(0, LIMITS.maxAssets);
  if (todo.length === 0) return out;

  // JS stays on: the only script here is ours (async decode needs it); images and SVG-as-image never run any.
  const context = await browser.newContext();
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    let page = await context.newPage();
    let decoder = await collectorHandle(page);
    for (const r of todo) {
      const bytes =
        r.kind === "svg"
          ? Buffer.from(r.markup, "utf8")
          : (dataUrlBytes(r.src) ?? fetched.get(r.src.split("#")[0] ?? r.src));
      if (!bytes) {
        reject(r, "its bytes were not captured (not loaded over the network, or over the size limits)");
        continue;
      }
      if (bytes.length > LIMITS.maxAssetBytes) {
        reject(r, `${(bytes.length / 1e6).toFixed(1)} MB is over ${LIMITS.maxAssetBytes / 1e6} MB`);
        continue;
      }
      const mime = sniffImage(bytes);
      if (!mime) {
        reject(r, "not a recognized image format");
        continue;
      }
      const args: DecodeArgs = {
        base64: bytes.toString("base64"),
        mime,
        passthrough: PASSTHROUGH.has(mime),
        raster: mime === "image/svg+xml" ? { width: r.width * dpr, height: r.height * dpr } : null,
        maxSide: LIMITS.maxImageSide,
        maxPixels: LIMITS.maxImagePixels,
      };
      let timer: NodeJS.Timeout | undefined;
      const stuck = new Promise<never>((_, fail) => {
        timer = setTimeout(
          () => fail(new Error(`no result after ${LIMITS.decodeMs / 1000}s`)),
          LIMITS.decodeMs,
        );
      });
      const result: DecodeResult = await Promise.race([
        decoder.evaluate((m, a) => m.decodeImage(a), args),
        stuck,
      ])
        .catch(async (e: unknown) => {
          // A crashed or stuck decoder (e.g. a decompression bomb) costs this image and the page, not the job.
          await page.close();
          page = await context.newPage();
          decoder = await collectorHandle(page);
          return { error: `decoder failed (${String(e).split("\n")[0]})` };
        })
        .finally(() => clearTimeout(timer));
      if ("error" in result) {
        reject(r, result.error);
        continue;
      }
      const o = result.output;
      out.set(r.key, {
        bytes: o ? Buffer.from(o.base64, "base64") : bytes,
        mime: o ? o.mime : (mime as DecodedImage["mime"]),
        pixelWidth: o ? o.width : result.width,
        pixelHeight: o ? o.height : result.height,
        width: result.width,
        height: result.height,
      });
    }
  } finally {
    await context.close();
  }
  return out;
}
