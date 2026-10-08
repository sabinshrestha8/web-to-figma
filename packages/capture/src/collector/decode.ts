/**
 * Image decoding, run in an isolated blank page (see capture/src/images.ts), never in the captured
 * page. The browser's own decoder validates the bytes; canvas transcodes what Figma can't take.
 */

export interface DecodeArgs {
  base64: string;
  mime: string;
  /** PNG/JPEG/GIF within the limits are kept byte for byte. */
  passthrough: boolean;
  /** Vector sources are rendered to cover this size (CSS px × dpr). */
  raster: { width: number; height: number } | null;
  maxSide: number;
  maxPixels: number;
}

export type DecodeResult =
  | { error: string }
  | {
      /** Intrinsic size of the source, px (for vectors without one: the requested size). */
      width: number;
      height: number;
      /** Set when transcoded: the new bytes and their pixel size. */
      output?: { base64: string; mime: "image/png" | "image/jpeg"; width: number; height: number };
    };

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function decodeImage(a: DecodeArgs): Promise<DecodeResult> {
  const bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: a.mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const vector = a.raster !== null;
    const width = img.naturalWidth || a.raster?.width || 0;
    const height = img.naturalHeight || a.raster?.height || 0;
    if (!width || !height) return { error: "image has no size" };
    if (!vector && width * height > a.maxPixels) {
      return { error: `${width}×${height} px is over ${a.maxPixels / 1e6} MP decoded` };
    }
    if (a.passthrough && width <= a.maxSide && height <= a.maxSide) return { width, height };

    // Vectors: cover the drawn size; rasters: their own pixels. Then fit Figma's side limit.
    const cover = a.raster ? Math.max(a.raster.width / width, a.raster.height / height) : 1;
    const fit = Math.min(1, a.maxSide / (width * cover), a.maxSide / (height * cover));
    const w = Math.max(1, Math.round(width * cover * fit));
    const h = Math.max(1, Math.round(height * cover * fit));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { error: "no 2d canvas" };
    ctx.drawImage(img, 0, 0, w, h);
    let opaque = !vector;
    if (opaque) {
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) {
          opaque = false;
          break;
        }
      }
    }
    const mime = opaque ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
    if (!blob) return { error: "canvas could not encode the image" };
    return { width, height, output: { base64: await toBase64(blob), mime, width: w, height: h } };
  } catch (e) {
    return { error: `the browser could not decode it (${String(e)})` };
  } finally {
    URL.revokeObjectURL(url);
  }
}
