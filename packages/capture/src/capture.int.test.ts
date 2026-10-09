/// <reference path="../../../tests/fixture-server.ts" />

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoxNode, Node, TextNode } from "@w2f/ir";
import { afterAll, describe, expect, inject, it } from "vitest";
import { closeBrowser } from "./browser.ts";
import { capture } from "./capture.ts";
import { saveLogin } from "./login.ts";
import { convertUrls } from "./run.ts";
import { loadStorageState, type StorageState } from "./storage-state.ts";

const base = inject("fixtureUrl");
const desktop = { width: 1440, height: 900, dpr: 1 };

const walk = (n: Node): Node[] => [n, ...(n.type === "box" ? n.children.flatMap(walk) : [])];
const texts = (root: BoxNode) => walk(root).filter((n): n is TextNode => n.type === "text");
const boxes = (root: BoxNode) => walk(root).filter((n): n is BoxNode => n.type === "box");

afterAll(closeBrowser);

describe("landing fixture → IR", async () => {
  const result = await convertUrls({ urls: [`${base}/landing`], viewports: [desktop] });

  it("produces a valid single-capture bundle with a reference screenshot", () => {
    expect(result.ok, JSON.stringify(!result.ok && result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const { ir, assetData } = result.value;
    expect(ir.captures).toHaveLength(1);
    const shot = ir.captures[0]!.screenshot!;
    expect(ir.assets[shot]).toMatchObject({ mime: "image/png", width: 1440 });
    expect(assetData[shot]).toBeTruthy();
  });

  it("captures the hero title as bold Inter text in one node", () => {
    if (!result.ok) throw new Error("capture failed");
    const root = result.value.ir.captures[0]!.root;
    const title = texts(root).find((t) => t.characters === "Ship designs straight from your code");
    expect(title).toBeDefined();
    const style = title!.runs[0]!.style;
    expect(style.families[0]).toBe("Inter");
    expect(style.weight).toBe(700);
    expect(style.size).toBe(48);
  });

  it("normalizes Tailwind v4 oklch colors to sRGB (slate-900 header)", () => {
    if (!result.ok) throw new Error("capture failed");
    const header = boxes(result.value.ir.captures[0]!.root).find((b) => b.source.tag === "header");
    const fill = header?.fills[0];
    expect(fill?.type).toBe("solid");
    if (fill?.type !== "solid") return;
    // slate-900 = oklch(20.8% 0.042 265.755) ≈ #0f172b
    expect(fill.color.r).toBeCloseTo(15 / 255, 1);
    expect(fill.color.g).toBeCloseTo(23 / 255, 1);
    expect(fill.color.b).toBeCloseTo(43 / 255, 1);
  });

  it("lays out the three feature cards in one row with equal widths", () => {
    if (!result.ok) throw new Error("capture failed");
    const cards = boxes(result.value.ir.captures[0]!.root).filter((b) => b.name === "div feature-card");
    expect(cards).toHaveLength(3);
    const [a, b, c] = cards.map((x) => x.bounds);
    expect(b!.y).toBe(a!.y);
    expect(c!.y).toBe(a!.y);
    // Grid tracks may differ by a sub-pixel rounding step.
    expect(b!.width).toBeCloseTo(a!.width, 1);
    expect(c!.width).toBeCloseTo(a!.width, 1);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  });
});

describe("slow content (--wait-for, --extra-settle-ms)", () => {
  it("captures once the selector exists", async () => {
    const r = await capture(`${base}/landing`, desktop, {
      waitForSelector: '[data-testid="hero-title"]',
      extraSettleMs: 100,
    });
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (!r.ok) return;
    expect(r.value.diagnostics.map((d) => d.code)).not.toContain("TIMEOUT");
    expect(r.value.snapshot.nodes.some((n) => n.kind === "text" && n.text.includes("Ship designs"))).toBe(
      true,
    );
  });

  it("warns but still captures when the selector never appears", async () => {
    const r = await capture(`${base}/landing`, desktop, { waitForSelector: "[data-testid=no-such-thing]" });
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (!r.ok) return;
    const timeout = r.value.diagnostics.find((d) => d.code === "TIMEOUT");
    expect(timeout?.severity).toBe("warning");
    expect(r.value.snapshot.nodes.length).toBeGreaterThan(0);
  });
});

describe("network policy against real redirects", () => {
  it("follows a same-origin redirect", async () => {
    const r = await capture(`${base}/hostile/redirect-ok`, desktop);
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (r.ok) expect(r.value.snapshot.url).toMatch(/\/landing$/);
  });

  it("refuses a redirect into cloud metadata", async () => {
    const r = await capture(`${base}/hostile/redirect-blocked`, desktop);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.code)).toContain("URL_BLOCKED");
  });

  it("checks every hop of a redirect chain, not just the first", async () => {
    const r = await capture(`${base}/hostile/redirect-chain`, desktop);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.code)).toContain("URL_BLOCKED");
  });

  it("blocks a metadata subresource with a warning but still captures the page", async () => {
    const r = await capture(`${base}/hostile/blocked-subresource`, desktop);
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (!r.ok) return;
    const blocked = r.value.diagnostics.filter((d) => d.code === "URL_BLOCKED");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.severity).toBe("warning");
  });

  it("refuses the fixture itself under the hosted-mode policy", async () => {
    const r = await capture(`${base}/landing`, desktop, { allowPrivateNetworks: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.code).toBe("URL_BLOCKED");
  });
});

describe("pages that navigate themselves after load", () => {
  it.each(["hard", "soft"])("follows a %s client redirect and captures the destination", async (mode) => {
    const r = await capture(`${base}/self-redirect/${mode}`, desktop);
    expect(r.ok, JSON.stringify(!r.ok && r.diagnostics)).toBe(true);
    if (!r.ok) return;
    expect(r.value.snapshot.url).toMatch(/\/landing$/);
    const texts = r.value.snapshot.nodes.filter((n) => n.kind === "text").map((n) => n.text);
    expect(texts).toContain("Ship designs straight from your code");
    expect(texts).not.toContain("Checking session…");
    expect(r.value.diagnostics.map((d) => d.code)).toContain("PAGE_REDIRECTED");
  });
});

describe("logged-in pages (--storage-state)", () => {
  const TOKEN = "fixture-session-token";
  const session = (): StorageState => ({
    cookies: [
      {
        name: "w2f_session",
        value: TOKEN,
        domain: "127.0.0.1",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [{ origin: base, localStorage: [{ name: "w2f_user", value: "Ada" }] }],
  });

  it("is sent to the login guard's redirect without a session", async () => {
    const r = await capture(`${base}/auth`, desktop);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.diagnostics.map((d) => d.code)).toContain("PAGE_REDIRECTED");
  });

  it("captures the private page with the saved cookies and localStorage, and keeps them out of the bundle", async () => {
    const result = await convertUrls({
      urls: [`${base}/auth`],
      viewports: [desktop],
      storageState: session(),
    });
    expect(result.ok, JSON.stringify(!result.ok && result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const chars = texts(result.value.ir.captures[0]!.root).map((t) => t.characters);
    expect(chars).toEqual(expect.arrayContaining(["Dashboard", "Signed in as Ada"]));
    expect(result.value.ir.diagnostics.map((d) => d.code)).not.toContain("PAGE_REDIRECTED");
    expect(JSON.stringify(result.value)).not.toContain(TOKEN);
  });

  it("pnpm w2f:login saves a session that pnpm w2f --storage-state can use", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "w2f-")), "auth.json");
    const saved = await saveLogin(`${base}/landing`, out, {
      headless: true,
      act: async (page) => {
        // What a real login leaves behind: a session cookie and a localStorage entry.
        await page.context().addCookies([{ ...session().cookies[0]!, expires: -1 }]);
        await page.evaluate(() => localStorage.setItem("w2f_user", "Ada"));
        await page.close();
      },
    });
    expect(saved).toBeGreaterThan(0);
    const result = await convertUrls({
      urls: [`${base}/auth`],
      viewports: [desktop],
      storageState: loadStorageState(out),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(texts(result.value.ir.captures[0]!.root).map((t) => t.characters)).toContain("Signed in as Ada");
    }
  });

  it("pnpm w2f:login keeps the session even when the whole browser is closed", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "w2f-")), "auth.json");
    const saved = await saveLogin(`${base}/landing`, out, {
      headless: true,
      act: async (page) => {
        await page.evaluate(() => localStorage.setItem("w2f_user", "Ada"));
        await new Promise((r) => setTimeout(r, 1500)); // the user takes a moment after logging in
        await page.context().browser()?.close();
      },
    });
    expect(saved).toBeGreaterThan(0);
    expect(loadStorageState(out).origins[0]?.localStorage).toContainEqual({ name: "w2f_user", value: "Ada" });
  });
});

describe("app-shell pages that scroll inside an element", () => {
  it("grows the viewport until the inner scroller's content fits, keeping the requested viewport in the IR", async () => {
    const result = await convertUrls({ urls: [`${base}/app-shell`], viewports: [desktop] });
    expect(result.ok, JSON.stringify(!result.ok && result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const { ir } = result.value;
    const cap = ir.captures[0]!;
    const end = texts(cap.root).find((t) => t.characters === "End of report");
    expect(end?.bounds.y).toBeGreaterThan(desktop.height);
    expect(cap.root.bounds.height).toBeGreaterThanOrEqual(end!.bounds.y + end!.bounds.height);
    expect(cap.viewport.height).toBe(desktop.height);
    expect(ir.diagnostics.map((d) => d.code)).toContain("SCROLL_CONTAINER_EXPANDED");
    expect(ir.diagnostics.map((d) => d.code)).not.toContain("ASSET_REJECTED");
  });

  it("leaves pages whose document scrolls alone", async () => {
    const r = await capture(`${base}/card-grid`, desktop);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.diagnostics.map((d) => d.code)).not.toContain("SCROLL_CONTAINER_EXPANDED");
  });
});
