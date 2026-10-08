/** V1 resource limits (docs/security.md). Change them here, nowhere else. */
export const LIMITS = {
  jobMs: 90_000,
  navigationMs: 30_000,
  evaluateMs: 20_000,
  /** Network counts as settled after this long with no requests in flight… */
  networkQuietMs: 500,
  /** …or after this cap, whichever comes first. */
  networkSettleCapMs: 5_000,
  maxElements: 15_000,
  maxCaptureHeight: 16_000,
  /** The reference screenshot must fit Figma's createImage limit (4096 px per side). */
  maxReferenceHeight: 4_096,
  /** Figma's createImage limit per side, in image pixels; rasters larger than this are captured at css scale or rejected. */
  maxImageSide: 4_096,
  /** Raster islands + pattern tiles per capture. */
  maxRasters: 200,
  /** Images (img, url() backgrounds, svg fallbacks) per capture. */
  maxAssets: 300,
  maxAssetBytes: 10_000_000,
  /** Decoded size; larger images are rejected, not downscaled. */
  maxImagePixels: 50_000_000,
  /** Per image; a decoder that takes longer is replaced. */
  decodeMs: 10_000,
  /** Image response bytes kept in memory per capture, for decoding. */
  maxImageStoreBytes: 100_000_000,
} as const;
