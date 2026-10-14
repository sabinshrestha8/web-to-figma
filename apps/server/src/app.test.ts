import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ConvertJob } from "@w2f/capture";
import {
  BUNDLE_FORMAT,
  type Bundle,
  type Document,
  diag,
  parseBundle,
  type Result,
  SCHEMA_VERSION,
} from "@w2f/ir";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type Execute, type ServerConfig } from "./app.ts";

const PUBLIC = "http://93.184.216.34/"; // a public literal: no DNS needed in tests

function bundle(): Bundle {
  const ir: Document = {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: "web-to-figma", version: "test" },
    captures: [
      {
        id: "c1",
        url: PUBLIC,
        title: "t",
        viewport: { width: 1440, height: 900, dpr: 1 },
        root: {
          id: "root",
          type: "box",
          name: "body",
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          opacity: 1,
          blendMode: "normal",
          effects: [],
          position: "flow",
          sizing: { horizontal: "fixed", vertical: "fixed" },
          source: { tag: "body", selector: "body" },
          fills: [],
          radius: [0, 0, 0, 0],
          clip: false,
          layout: { mode: "none" },
          children: [],
        },
      },
    ],
    assets: {},
    fonts: [],
    diagnostics: [],
  } as unknown as Document;
  return { format: BUNDLE_FORMAT, ir, assetData: {} };
}

const config: ServerConfig = {
  maxRunning: 2,
  maxQueued: 8,
  ratePerHour: 30,
  apiTokens: [],
  trustProxy: false,
  resultTtlMs: 60_000,
  maxBundleBytes: 10 * 1024 * 1024,
  allowPrivateNetworks: false,
};

let server: Server | undefined;
let app: ReturnType<typeof createApp>;
const logs: Record<string, unknown>[] = [];

async function start(execute: Execute, overrides: Partial<ServerConfig> = {}) {
  app = createApp({ ...config, ...overrides }, execute, (f) => logs.push(f));
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  app?.abortAll();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  logs.length = 0;
});

const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/captures`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function until(base: string, id: string, done: (s: string) => boolean) {
  for (let i = 0; i < 200; i++) {
    const s = (await (await fetch(`${base}/api/captures/${id}`)).json()) as { status: string };
    if (done(s.status)) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never settled");
}

const ok: Execute = async () => ({ ok: true, value: bundle() });

describe("hosted capture API", () => {
  it("answers health checks and CORS preflights for the plugin's null origin", async () => {
    const base = await start(ok);
    const h = await fetch(`${base}/healthz`);
    expect(await h.json()).toEqual({ ok: true, running: 0, queued: 0 });
    const pre = await fetch(`${base}/api/captures`, { method: "OPTIONS", headers: { origin: "null" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("captures in hosted mode and serves a bundle the plugin's parser accepts", async () => {
    const seen: ConvertJob[] = [];
    const base = await start(async (job) => {
      seen.push(job);
      return { ok: true, value: bundle() };
    });
    const r = await post(base, {
      url: "93.184.216.34", // scheme-less input is normalized
      viewports: ["desktop", "mobile"],
      click: ["text=Open"],
    });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    const done = await until(base, id, (s) => s !== "queued" && s !== "running");
    expect(done).toMatchObject({ status: "done", progress: 1 });
    expect(seen[0]).toMatchObject({
      urls: ["https://93.184.216.34"],
      hosted: true,
      allowPrivateNetworks: false,
      clickSelectors: ["text=Open"],
      viewports: [
        { width: 1440, height: 900, dpr: 1 },
        { width: 390, height: 844, dpr: 2 },
      ],
    });
    const b = await fetch(`${base}/api/captures/${id}/bundle`);
    expect(b.status).toBe(200);
    expect(b.headers.get("access-control-allow-origin")).toBe("*");
    expect(parseBundle(await b.json()).ok).toBe(true);
  });

  it("rejects bad input with INVALID_INPUT, non-JSON with 400 and big bodies with 413", async () => {
    const base = await start(ok);
    const bad = await post(base, { url: PUBLIC, viewports: ["huge"], script: "x" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ diagnostics: [{ code: "INVALID_INPUT" }] });
    expect((await post(base, "{nope")).status).toBe(400);
    expect((await post(base, { url: "x".repeat(20_000) })).status).toBe(413);
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1:8080/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://[::1]/",
    "file:///etc/passwd",
    "ftp://example.com/",
  ])("blocks %s before queueing anything", async (url) => {
    let ran = false;
    const base = await start(async () => {
      ran = true;
      return { ok: true, value: bundle() };
    });
    const r = await post(base, { url });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ diagnostics: [{ code: "URL_BLOCKED" }] });
    expect(ran).toBe(false);
  });

  it("reports capture failures with their diagnostics, and crashes without internals", async () => {
    const failing: Execute = async () => ({
      ok: false,
      diagnostics: [diag("TIMEOUT", "capture took longer than 90s")],
    });
    let base = await start(failing);
    let { id } = (await (await post(base, { url: PUBLIC })).json()) as { id: string };
    expect(await until(base, id, (s) => s === "failed")).toMatchObject({
      diagnostics: [{ code: "TIMEOUT" }],
    });
    expect((await fetch(`${base}/api/captures/${id}/bundle`)).status).toBe(409);
    await new Promise<void>((r) => server?.close(() => r()));

    base = await start(async () => {
      throw new Error("secret internal path /srv/x");
    });
    ({ id } = (await (await post(base, { url: PUBLIC })).json()) as { id: string });
    const s = await until(base, id, (st) => st === "failed");
    expect(JSON.stringify(s)).not.toContain("/srv/x");
  });

  it("fails oversized bundles with PAGE_TOO_LARGE instead of sending them", async () => {
    const base = await start(ok, { maxBundleBytes: 100 });
    const { id } = (await (await post(base, { url: PUBLIC })).json()) as { id: string };
    expect(await until(base, id, (s) => s === "failed")).toMatchObject({
      diagnostics: [{ code: "PAGE_TOO_LARGE" }],
    });
  });

  it("cancels a running capture through its abort signal", async () => {
    const base = await start(
      (job) =>
        new Promise<Result<Bundle>>((resolve) =>
          job.signal?.addEventListener("abort", () => resolve({ ok: false, diagnostics: [] })),
        ),
    );
    const { id } = (await (await post(base, { url: PUBLIC })).json()) as { id: string };
    await until(base, id, (s) => s === "running");
    const d = await fetch(`${base}/api/captures/${id}`, { method: "DELETE" });
    expect(d.status).toBe(200);
    expect(await until(base, id, (s) => s === "cancelled")).toMatchObject({ status: "cancelled" });
  });

  it("limits each client to one capture at a time, the queue, and the hourly rate", async () => {
    const never: Execute = () => new Promise(() => {});
    let base = await start(never, { maxRunning: 1, maxQueued: 0 });
    expect((await post(base, { url: PUBLIC })).status).toBe(202);
    const again = await post(base, { url: PUBLIC });
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBe("60");
    await new Promise<void>((r) => server?.close(() => r()));

    base = await start(never, { maxRunning: 1, maxQueued: 1, trustProxy: true });
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    expect((await post(base, { url: PUBLIC }, from("203.0.113.1"))).status).toBe(202);
    const queued = await post(base, { url: PUBLIC }, from("203.0.113.2"));
    expect(await queued.json()).toMatchObject({ status: "queued", position: 1 });
    const full = await post(base, { url: PUBLIC }, from("203.0.113.3"));
    expect(full.status).toBe(429);
    expect(await full.json()).toMatchObject({ error: expect.stringContaining("busy") });
    await new Promise<void>((r) => server?.close(() => r()));

    base = await start(ok, { ratePerHour: 2 });
    for (let i = 0; i < 2; i++) {
      const { id } = (await (await post(base, { url: PUBLIC })).json()) as { id: string };
      await until(base, id, (s) => s === "done");
    }
    expect((await post(base, { url: PUBLIC })).status).toBe(429);
  });

  it("requires a bearer token when tokens are configured", async () => {
    const base = await start(ok, { apiTokens: ["s3cret"] });
    expect((await post(base, { url: PUBLIC })).status).toBe(401);
    expect((await post(base, { url: PUBLIC }, { authorization: "Bearer wrong" })).status).toBe(401);
    const r = await post(base, { url: PUBLIC }, { authorization: "Bearer s3cret" });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    expect((await fetch(`${base}/api/captures/${id}`)).status).toBe(401);
  });

  it("forgets results after their TTL, and logs no URLs or tokens", async () => {
    const base = await start(ok, { resultTtlMs: 0 });
    const { id } = (await (await post(base, { url: "http://93.184.216.34/private?token=abc" })).json()) as {
      id: string;
    };
    await new Promise((r) => setTimeout(r, 50));
    app.sweep(Date.now() + 1);
    expect((await fetch(`${base}/api/captures/${id}`)).status).toBe(404);
    expect(JSON.stringify(logs)).not.toContain("token=abc");
    expect(JSON.stringify(logs)).not.toContain("/private");
  });
});
