import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadStorageState } from "./storage-state.ts";

const file = (content: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "w2f-")), "auth.json");
  writeFileSync(path, content);
  return path;
};

describe("loadStorageState", () => {
  it("reads a Playwright storage state file", () => {
    const state = {
      cookies: [],
      origins: [{ origin: "https://a.test", localStorage: [{ name: "k", value: "v" }] }],
    };
    expect(loadStorageState(file(JSON.stringify(state)))).toEqual(state);
  });

  it("rejects a malformed file naming the bad field, never echoing a value", () => {
    const bad = { cookies: [{ name: "sid", value: "super-secret", domain: "a.test" }], origins: [] };
    const err = (() => {
      try {
        loadStorageState(file(JSON.stringify(bad)));
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(err).toMatch(/not a Playwright storage state file .*cookies\.0\.path/);
    expect(err).not.toContain("super-secret");
    expect(() => loadStorageState(file("not json"))).toThrow(/not a readable JSON file/);
  });
});
