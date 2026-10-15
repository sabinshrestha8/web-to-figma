import type { DecodeArgs, DecodeResult } from "@w2f/capture/collector";
import { LIMITS } from "@w2f/capture/limits";
import { sniffImage } from "@w2f/capture/sniff";
import {
  type ImageAsset,
  imagePlan,
  type RawRect,
  type RawSnapshot,
  rasterPlan,
  snapshotToIR,
  toDocument,
} from "@w2f/convert";
import {
  type AssetMeta,
  BUNDLE_FORMAT,
  type Bundle,
  type Diagnostic,
  diag,
  parseDocument,
  type Result,
} from "@w2f/ir";

/** What the service worker hands the result page: the page as the user saw it. */
export interface Captured {
  snapshot: RawSnapshot;
  /** window.scrollX/Y at capture time: snapshot rects are page coordinates, the screenshot is the viewport. */
  scroll: { x: number; y: number };
  /** Px the page's inner scroller was grown by so all of it shows (`unrollInPlace`). */
  expanded?: number;
  /** Which elements were grown, and by how much (`unrollLog`). */
  grown?: string;
}

/** The browser-only parts, injected so the assembly is testable in Node. */
export interface Deps {
  /** Image bytes for a URL, or why they couldn't be read. */
  fetch(url: string): Promise<Uint8Array | string>;
  decode(args: DecodeArgs): Promise<DecodeResult>;
  /** Each visible-tab screenshot's top, in page px (`shotTops`); the first is the window as it was. */
  shots: number[];
  /** PNG of a viewport rect (CSS px) of screenshot `shot`, at `scale` image px per CSS px. */
  crop(shot: number, rect: RawRect, scale: number): Promise<Uint8Array>;
  /** Screenshot pixels per CSS px. */
  screenshotScale: number;
}

const PASSTHROUGH = new Set(["image/png", "image/jpeg", "image/gif"]);

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** PNG width/height from the IHDR chunk's fixed offsets. */
const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};

/**
 * Where to take visible-tab screenshots so each raster island fits whole in one: the window as it
 * is, then one starting at each island not yet in one, top down, up to `max`. ponytail: islands
 * taller or wider than the window aren't captured (cropping across two screenshots would fix that).
 */
export function shotTops({ snapshot, scroll }: Captured, max: number): number[] {
  const { width: vw, height: vh } = snapshot.viewport;
  const last = Math.max(scroll.y, snapshot.documentSize.height - vh);
  const tops = [scroll.y];
  const islands = rasterPlan(snapshot, LIMITS.maxCaptureHeight, () => true)
    .flatMap((r) => (r.kind === "element" ? [r.rect] : []))
    .sort((a, b) => a.y - b.y);
  for (const r of islands) {
    if (tops.length >= max) break;
    if (r.height > vh || r.x < scroll.x - 0.5 || r.x + r.width > scroll.x + vw + 0.5) continue;
    if (tops.some((t) => fits(r, t, vh))) continue;
    tops.push(Math.max(0, Math.min(r.y, last)));
  }
  return tops;
}

const fits = (r: RawRect, top: number, vh: number) => r.y >= top - 0.5 && r.y + r.height <= top + vh + 0.5;

/**
 * The same bundle `convertUrls` builds, from a capture of the user's own tab. Differences, each
 * reported: raster islands are crops of visible-tab screenshots (so with whatever is drawn over
 * them, and only ones that fit in the window), pattern tiles aren't rendered, and the reference screenshot is
 * the visible part of the page (only when it is scrolled to the top).
 */
export async function toBundle(c: Captured, deps: Deps): Promise<Result<Bundle>> {
  const { snapshot, scroll } = c;
  const diagnostics: Diagnostic[] = [];
  if (c.expanded) {
    diagnostics.push(
      diag(
        "SCROLL_CONTAINER_EXPANDED",
        `the page scrolls inside an element, not the document; it was grown by ${Math.round(c.expanded)}px so all of it shows (elements sized to the window, e.g. 100vh sidebars, grow with it)`,
        {
          detail: {
            viewportHeight: snapshot.viewport.height,
            capturedHeight: snapshot.viewport.height + Math.round(c.expanded),
            ...(c.grown ? { grown: c.grown } : {}),
          },
        },
      ),
    );
  }
  const assets: Record<string, AssetMeta> = {};
  const assetData: Record<string, string> = {};
  if (snapshot.truncated) {
    return {
      ok: false,
      diagnostics: [
        diag("PAGE_TOO_LARGE", `page has more than ${LIMITS.maxElements} elements`, {
          detail: { limit: LIMITS.maxElements },
        }),
      ],
    };
  }
  const add = async (bytes: Uint8Array, mime: AssetMeta["mime"], size = pngSize(bytes)) => {
    const id = await sha256(bytes);
    assets[id] = { mime, ...size, byteLength: bytes.length };
    assetData[id] = toBase64(bytes);
    return id;
  };

  // Images: fetched again by URL (the page's own requests can't be read from an extension).
  const images: Record<string, ImageAsset> = {};
  const wanted = imagePlan(snapshot, LIMITS.maxCaptureHeight);
  const reject = (what: string, why: string) =>
    diagnostics.push(diag("ASSET_REJECTED", `${what} not used: ${why}`, { fallback: "placeholder" }));
  if (wanted.length > LIMITS.maxAssets) {
    diagnostics.push(
      diag(
        "ASSET_REJECTED",
        `page uses ${wanted.length} images; only the first ${LIMITS.maxAssets} were kept`,
        {
          detail: { requested: wanted.length, limit: LIMITS.maxAssets },
          fallback: "placeholder",
        },
      ),
    );
  }
  for (const r of wanted.slice(0, LIMITS.maxAssets)) {
    const what = `image ${r.kind === "url" ? r.src.slice(0, 200) : r.key}`;
    const bytes =
      r.kind === "svg" ? new TextEncoder().encode(r.markup) : await deps.fetch(r.src.split("#")[0] ?? r.src);
    if (typeof bytes === "string") {
      reject(what, bytes);
      continue;
    }
    if (bytes.length > LIMITS.maxAssetBytes) {
      reject(what, `${(bytes.length / 1e6).toFixed(1)} MB is over ${LIMITS.maxAssetBytes / 1e6} MB`);
      continue;
    }
    const mime = sniffImage(bytes);
    if (!mime) {
      reject(what, "not a recognized image format");
      continue;
    }
    const result = await deps.decode({
      base64: toBase64(bytes),
      mime,
      passthrough: PASSTHROUGH.has(mime),
      raster:
        mime === "image/svg+xml"
          ? { width: r.width * snapshot.viewport.dpr, height: r.height * snapshot.viewport.dpr }
          : null,
      maxSide: LIMITS.maxImageSide,
      maxPixels: LIMITS.maxImagePixels,
    });
    if ("error" in result) {
      reject(what, result.error);
      continue;
    }
    const o = result.output;
    const assetId = o
      ? await add(fromBase64(o.base64), o.mime, { width: o.width, height: o.height })
      : await add(bytes, mime as AssetMeta["mime"], { width: result.width, height: result.height });
    images[r.key] = { assetId, width: result.width, height: result.height };
  }

  // Rasters: crops of the screenshots.
  const rasters: Record<string, string> = {};
  const { width: vw, height: vh } = snapshot.viewport;
  const plan = rasterPlan(snapshot, LIMITS.maxCaptureHeight, (key) => key in images);
  if (plan.length > LIMITS.maxRasters) {
    diagnostics.push(
      diag(
        "ASSET_REJECTED",
        `page needs ${plan.length} rasters; only the first ${LIMITS.maxRasters} were captured`,
        {
          detail: { requested: plan.length, limit: LIMITS.maxRasters },
          fallback: "placeholder",
        },
      ),
    );
  }
  for (const r of plan.slice(0, LIMITS.maxRasters)) {
    if (r.kind === "tile") {
      reject(
        `raster ${r.key}`,
        "repeating backgrounds are rendered by the CLI and web UI, not the extension",
      );
      continue;
    }
    if (r.rect.width < 1 || r.rect.height < 1) continue;
    const inX = r.rect.x >= scroll.x - 0.5 && r.rect.x + r.rect.width <= scroll.x + vw + 0.5;
    const shot = inX ? deps.shots.findIndex((top) => fits(r.rect, top, vh)) : -1;
    if (shot < 0) {
      reject(
        `raster ${r.key}`,
        "no screenshot held all of it (wider or taller than the window, or past the screenshot limit)",
      );
      continue;
    }
    const rect = { ...r.rect, x: r.rect.x - scroll.x, y: r.rect.y - (deps.shots[shot] ?? 0) };
    const scale = Math.min(
      deps.screenshotScale,
      LIMITS.maxImageSide / rect.width,
      LIMITS.maxImageSide / rect.height,
    );
    rasters[r.key] = await add(await deps.crop(shot, rect, scale), "image/png");
  }

  // The reference layer is placed at the page's top-left, so only a screenshot taken there fits it.
  const atTop = Math.abs(scroll.x) < 1 && Math.abs(scroll.y) < 1;
  const screenshot = atTop
    ? await add(await deps.crop(0, { x: 0, y: 0, width: vw, height: vh }, 1), "image/png")
    : undefined;

  const converted = snapshotToIR(snapshot, {
    captureId: "c1",
    maxHeight: LIMITS.maxCaptureHeight,
    ...(screenshot ? { screenshot } : {}),
    rasters,
    images,
  });
  const all = [...diagnostics.map((d) => ({ ...d, captureId: "c1" })), ...converted.diagnostics];
  const ir = parseDocument(toDocument([converted.capture], assets, all));
  if (!ir.ok) return ir;
  return { ok: true, value: { format: BUNDLE_FORMAT, ir: ir.value, assetData } };
}
