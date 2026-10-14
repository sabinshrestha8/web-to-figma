const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/**
 * The image type from the bytes themselves; the server's Content-Type is not trusted.
 * Plain Uint8Array (no Buffer), so the browser extension shares it.
 */
export function sniffImage(b: Uint8Array): string | null {
  if (ascii(b, 1, 4) === "PNG" && b[0] === 0x89) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(b, 0, 4) === "GIF8") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(b, 8, 12))) return "image/avif";
  if (ascii(b, 0, 2) === "BM") return "image/bmp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  if (/^\s*</.test(ascii(b, 0, 64)) && /<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 4096))))
    return "image/svg+xml";
  return null;
}
