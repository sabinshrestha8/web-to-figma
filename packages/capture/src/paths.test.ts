import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inPath, outPath } from "./paths.ts";

describe("bare file names default to .data/", () => {
  const cwd = process.cwd();
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "w2f-paths-"));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes bare names into .data/ (created), other paths as given", () => {
    expect(outPath("x.w2f.json")).toBe(join(".data", "x.w2f.json"));
    writeFileSync(outPath("x.w2f.json"), "{}"); // .data/ exists now
    expect(outPath("./x.json")).toBe("./x.json");
    expect(outPath(join("out", "diff.png"))).toBe(join("out", "diff.png"));
  });

  it("reads a bare name from .data/ only when it isn't in the current folder", () => {
    writeFileSync(outPath("a.w2f.json"), "{}");
    expect(inPath("a.w2f.json")).toBe(join(".data", "a.w2f.json"));
    writeFileSync("a.w2f.json", "{}");
    expect(inPath("a.w2f.json")).toBe("a.w2f.json");
    expect(inPath("missing.json")).toBe("missing.json"); // the caller reports it
  });
});
