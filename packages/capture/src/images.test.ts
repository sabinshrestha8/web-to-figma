import { describe, expect, it } from "vitest";
import { dataUrlBytes, sniffImage } from "./images.ts";

describe("sniffImage", () => {
  const bytes = (...parts: (string | number[])[]) =>
    Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

  it.each([
    ["image/png", bytes([0x89], "PNG\r\n\x1a\n")],
    ["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["image/gif", bytes("GIF89a")],
    ["image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
    ["image/avif", bytes([0, 0, 0, 0x1c], "ftypavif")],
    ["image/svg+xml", bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["image/svg+xml", bytes("  <svg>")],
  ])("recognizes %s from its bytes", (mime, b) => {
    expect(sniffImage(b)).toBe(mime);
  });

  it("ignores the claimed type: HTML and scripts are not images", () => {
    expect(sniffImage(bytes("<!doctype html><html>"))).toBeNull();
    expect(sniffImage(bytes("alert(1)"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("dataUrlBytes", () => {
  it("decodes base64 and percent-encoded data: URLs", () => {
    expect(dataUrlBytes("data:image/png;base64,iVBORw0K")?.subarray(1, 4).toString()).toBe("PNG");
    expect(dataUrlBytes("data:image/svg+xml,%3Csvg%2F%3E")?.toString()).toBe("<svg/>");
    expect(dataUrlBytes("data:image/svg+xml;charset=utf-8,<svg/>")?.toString()).toBe("<svg/>");
  });

  it("returns null for other URLs and malformed encodings", () => {
    expect(dataUrlBytes("http://x/a.png")).toBeNull();
    expect(dataUrlBytes("data:image/svg+xml,%E0%A4%A")).toBeNull();
  });
});
