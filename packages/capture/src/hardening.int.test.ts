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

// Phase 10: hosted mode (apps/server). Loopback is allowed here only because the fixtures live there.
describe("hosted mode (pinned network)", () => {
  const nodes = (r: Awaited<ReturnType<typeof convertUrls>>) => {
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    const walk = (n: { children?: unknown[] }): number =>
      1 + (n.children ?? []).reduce<number>((s, c) => s + walk(c as { children?: unknown[] }), 0);
    return walk(r.value.ir.captures[0]!.root);
  };

  it("captures the same page as local mode, images included", async () => {
    const local = await convertUrls({ urls: [`${base}/image-heavy`], viewports: [desktop] });
    const hosted = await convertUrls({ urls: [`${base}/image-heavy`], viewports: [desktop], hosted: true });
    expect(nodes(hosted)).toBe(nodes(local));
    if (!hosted.ok || !local.ok) return;
    expect(Object.keys(hosted.value.ir.assets).length).toBe(Object.keys(local.value.ir.assets).length);
    // Same diagnostics too (the fixture's deliberately missing image fails in both).
    const codes = (r: typeof local) => (r.ok ? r.value.ir.diagnostics.map((d) => d.code).sort() : []);
    expect(codes(hosted)).toEqual(codes(local));
  });

  it("follows a same-origin redirect and blocks one to the metadata address", async () => {
    const ok = await capture(`${base}/hostile/redirect-ok`, desktop, { hosted: true });
    expect(ok.ok, JSON.stringify(!ok.ok && ok.diagnostics)).toBe(true);
    const bad = await capture(`${base}/hostile/redirect-chain`, desktop, { hosted: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.diagnostics.map((d) => d.code)).toContain("URL_BLOCKED");
  });

  it("refuses loopback when private networks are off", async () => {
    const r = await capture(`${base}/landing`, desktop, { hosted: true, allowPrivateNetworks: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.code)).toEqual(["URL_BLOCKED"]);
  });

  it("stops promptly when cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    const t0 = Date.now();
    const r = await capture(`${base}/hostile/hang`, desktop, { hosted: true, signal: controller.signal });
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(15_000);
    if (!r.ok) expect(r.diagnostics.map((d) => d.code)).not.toContain("TIMEOUT");
  });
});
