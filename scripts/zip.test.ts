import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { zip } from "./zip.ts";

/** Reads entries back through the central directory, as unzip tools do. */
function unzip(z: Buffer): Record<string, string> {
  const end = z.length - 22;
  expect(z.readUInt32LE(end)).toBe(0x06054b50);
  const out: Record<string, string> = {};
  let p = z.readUInt32LE(end + 16);
  for (let i = 0; i < z.readUInt16LE(end + 10); i++) {
    expect(z.readUInt32LE(p)).toBe(0x02014b50);
    const size = z.readUInt32LE(p + 20);
    const nameLen = z.readUInt16LE(p + 28);
    const name = z.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const at = z.readUInt32LE(p + 42);
    const data = at + 30 + z.readUInt16LE(at + 26);
    out[name] = inflateRawSync(z.subarray(data, data + size)).toString("utf8");
    p += 46 + nameLen;
  }
  return out;
}

describe("zip", () => {
  it("round-trips files with folders and UTF-8 names", () => {
    const files = { "a/manifest.json": '{"x":1}', "b/ünï.txt": "hello ".repeat(1000), "empty.txt": "" };
    const z = zip(Object.entries(files).map(([path, s]) => ({ path, data: Buffer.from(s) })));
    expect(unzip(z)).toEqual({
      "a/manifest.json": '{"x":1}',
      "b/ünï.txt": "hello ".repeat(1000),
      "empty.txt": "",
    });
  });
});
