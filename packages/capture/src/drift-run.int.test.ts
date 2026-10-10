import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, inject, it } from "vitest";
import { closeBrowser } from "./browser.ts";
import { runDrift } from "./drift-run.ts";

const dir = mkdtempSync(join(tmpdir(), "w2f-drift-"));
const config = join(dir, "drift.config.json");
const write = (url: string) =>
  writeFileSync(
    config,
    JSON.stringify({
      maxChanges: 0,
      maxPixelPercent: 1,
      pages: [{ name: "cards", url, viewport: "1024x768" }],
    }),
  );

afterAll(async () => {
  await closeBrowser();
  rmSync(dir, { recursive: true, force: true });
});

describe("drift:run", () => {
  const base = inject("fixtureUrl");

  it("sets a baseline, then passes an unchanged page and fails a changed one", async () => {
    write(`${base}/card-grid`);
    const first = await runDrift(config);
    expect(first.results[0]).toMatchObject({ status: "baseline-set", over: [] });
    expect(first.ok).toBe(true);
    expect(existsSync(join(dir, "drift/cards/baseline.w2f.json"))).toBe(true);

    const same = await runDrift(config);
    expect(same.results[0]).toMatchObject({ status: "compared", over: [] });
    expect(same.results[0]?.drift?.entries).toEqual([]);
    expect(same.results[0]?.pixelPercent).toBeLessThanOrEqual(1);
    expect(same.ok).toBe(true);

    // Same name, different page: the gate must trip and the report must show crops.
    write(`${base}/landing`);
    const changed = await runDrift(config);
    const r = changed.results[0];
    expect(r?.status).toBe("compared");
    expect(r?.drift?.entries.length).toBeGreaterThan(0);
    expect(r?.over.join()).toMatch(/changes > 0/);
    expect(changed.ok).toBe(false);
    const html = readFileSync(changed.reportPath, "utf8");
    expect(html).toContain("url('cards/baseline.png')");
    expect(existsSync(join(dir, "drift/cards/diff.png"))).toBe(true);

    // Accepting makes the changed page the baseline.
    expect((await runDrift(config, { accept: true })).results[0]?.status).toBe("accepted");
    expect((await runDrift(config)).ok).toBe(true);

    const history = readFileSync(join(dir, "drift/history.jsonl"), "utf8").trim().split("\n");
    expect(history.map((l) => JSON.parse(l).status)).toEqual([
      "baseline-set",
      "compared",
      "compared",
      "accepted",
      "compared",
    ]);
  });

  it("reports a failed page without stopping, and skips Figma without a token", async () => {
    writeFileSync(
      config,
      JSON.stringify({
        out: "drift2",
        pages: [
          { name: "gone", url: "http://169.254.169.254/" },
          { name: "cards", url: `${base}/card-grid`, figma: { file: "KEY", node: "1:2" } },
        ],
      }),
    );
    const run = await runDrift(config);
    expect(run.results.map((r) => r.status)).toEqual(["failed", "baseline-set"]);
    expect(run.results[0]?.error).toBeTruthy();
    expect(run.results[1]?.figma).toEqual({ skipped: "FIGMA_TOKEN is not set" });
    expect(run.ok).toBe(false);
  });

  it("ignores live content: only its bounds are compared and its pixels masked", async () => {
    const live = (ignore?: string[]) =>
      writeFileSync(
        config,
        JSON.stringify({
          out: "drift3",
          pages: [{ name: "live", url: `${base}/live`, viewport: "1024x768", ...(ignore ? { ignore } : {}) }],
        }),
      );
    live();
    await runDrift(config);
    const noisy = (await runDrift(config)).results[0];
    expect(noisy?.drift?.entries.map((e) => e.kind)).toContain("text-changed");
    expect(noisy?.pixelPercent).toBeGreaterThan(0);

    live(["time", "[data-testid=chart]", ".nope", "[["]);
    await runDrift(config, { accept: true });
    const quiet = (await runDrift(config)).results[0];
    expect(quiet?.drift?.entries).toEqual([]);
    expect(quiet?.pixelPercent).toBe(0);
    expect(quiet?.masked).toBe(4); // time + chart, in both captures
    expect(
      quiet?.diagnostics.filter((d) => d.code === "IGNORE_SELECTOR_UNUSED").map((d) => d.message),
    ).toEqual(['ignore selector ".nope" matched nothing', 'ignore selector "[[" is not valid CSS']);
  });
});
