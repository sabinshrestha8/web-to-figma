/// <reference path="../../../tests/fixture-server.ts" />

import { afterAll, describe, expect, inject, it } from "vitest";
import { closeBrowser } from "./browser.ts";
import { capture } from "./capture.ts";
import { convertUrls } from "./run.ts";

const base = inject("fixtureUrl");
const desktop = { width: 1440, height: 900, dpr: 1 };

afterAll(closeBrowser);

// Phase 8: hostile pages must fail (or degrade) with a diagnostic, never hang or crash.
describe("hostile pages", () => {
  it("hang (infinite loop) fails with TIMEOUT instead of hanging", async () => {
    const r = await capture(`${base}/hostile/hang`, desktop);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.code)).toContain("TIMEOUT");
  });

  it("many-elements (20k over the 15k limit) fails with PAGE_TOO_LARGE", async () => {
    const r = await capture(`${base}/hostile/many-elements`, desktop);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.code)).toContain("PAGE_TOO_LARGE");
  });

  it("huge-image (12 MB over the 10 MB limit) captures with ASSET_REJECTED", async () => {
    const r = await convertUrls({ urls: [`${base}/hostile/huge-image`], viewports: [desktop] });
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (!r.ok) return;
    expect(r.value.ir.diagnostics.map((d) => d.code)).toContain("ASSET_REJECTED");
  });
});

// Phase 8: performance budgets (docs/security.md).
describe("performance budgets", () => {
  it("captures a fixture page at 1440px in under 8s", async () => {
    const t0 = Date.now();
    const r = await convertUrls({ urls: [`${base}/landing`], viewports: [desktop] });
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(8_000);
  });

  it("keeps the image-heavy bundle under 15MB", async () => {
    const r = await convertUrls({ urls: [`${base}/image-heavy`], viewports: [desktop] });
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (!r.ok) return;
    expect(Buffer.byteLength(JSON.stringify(r.value))).toBeLessThan(15_000_000);
  });
});
