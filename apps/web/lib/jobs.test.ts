import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore, dataDir, sweepJobs } from "./jobs.ts";

afterEach(() => {
  delete process.env.W2F_DATA_DIR;
});

const useTmpDataDir = () => {
  process.env.W2F_DATA_DIR = join(mkdtempSync(join(tmpdir(), "w2f-web-")), "jobs");
};

const input = { urls: ["http://127.0.0.1:4400/landing"], viewports: [{ width: 1440, height: 900, dpr: 1 }] };
const never = () => new Promise<never>(() => {});

describe("job admission", () => {
  it("runs two jobs, rejects the third with null (→ 429)", () => {
    useTmpDataDir();
    const store = createStore(never);
    expect(store.create(input)?.status).toBe("running");
    expect(store.create(input)?.status).toBe("running");
    expect(store.create(input)).toBeNull();
  });

  it("admits again once jobs are terminal", async () => {
    useTmpDataDir();
    const store = createStore(async () => ({ ok: false, diagnostics: [] }));
    store.create(input);
    store.create(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(store.create(input)?.id).toBeTruthy();
    expect(store.create(input)?.id).toBeTruthy();
    expect(store.create(input)).toBeNull();
  });
});

describe("artifact sweep", () => {
  it("removes job dirs older than 24h and keeps fresh ones", () => {
    useTmpDataDir();
    const root = dataDir();
    mkdirSync(join(root, "old"), { recursive: true });
    mkdirSync(join(root, "new"), { recursive: true });
    writeFileSync(join(root, "old", "bundle.json"), "{}");
    const ancient = new Date(Date.now() - 25 * 3600 * 1000);
    utimesSync(join(root, "old"), ancient, ancient);
    expect(sweepJobs(root)).toBe(1);
    expect(existsSync(join(root, "old"))).toBe(false);
    expect(existsSync(join(root, "new"))).toBe(true);
  });

  it("sweeps nothing when there is no directory yet", () => {
    useTmpDataDir();
    expect(sweepJobs()).toBe(0);
  });
});
