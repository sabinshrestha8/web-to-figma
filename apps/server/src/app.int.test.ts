/// <reference path="../../../tests/fixture-server.ts" />

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { closeBrowser } from "@w2f/capture";
import { parseBundle } from "@w2f/ir";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { configFromEnv, createApp } from "./app.ts";

// The real pipeline behind HTTP, as the plugin drives it. The fixture site is on loopback,
// so this one opts into private networks (production never sets W2F_ALLOW_PRIVATE).
const fixture = inject("fixtureUrl");
const app = createApp({ ...configFromEnv({}), allowPrivateNetworks: true }, undefined, () => {});
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  app.abortAll();
  await new Promise<void>((r) => server.close(() => r()));
  await closeBrowser();
});

async function create(body: unknown) {
  const r = await fetch(`${base}/api/captures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(r.status).toBe(202);
  return ((await r.json()) as { id: string }).id;
}
async function settle(id: string) {
  for (;;) {
    const s = (await (await fetch(`${base}/api/captures/${id}`)).json()) as {
      status: string;
      diagnostics: { code: string }[];
    };
    if (s.status !== "queued" && s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("hosted capture service (end to end)", () => {
  it("captures a fixture page in hosted mode and serves a gzipped, valid bundle", async () => {
    const id = await create({
      url: `${fixture}/dialog`,
      click: ["text=Add employee"],
      waitFor: ["[role=dialog]"],
    });
    const s = await settle(id);
    expect(s.status, JSON.stringify(s.diagnostics)).toBe("done");
    const r = await fetch(`${base}/api/captures/${id}/bundle`, { headers: { "accept-encoding": "gzip" } });
    expect(r.headers.get("content-encoding")).toBe("gzip");
    const parsed = parseBundle(await r.json());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json = JSON.stringify(parsed.value.ir);
    expect(json).toContain("employee-dialog");
    expect(parsed.value.ir.captures[0]?.viewport).toEqual({ width: 1440, height: 900, dpr: 1 });
  });

  it("cancels a hanging capture promptly", async () => {
    const id = await create({ url: `${fixture}/hostile/hang` });
    await new Promise((r) => setTimeout(r, 1500));
    const t = Date.now();
    expect((await fetch(`${base}/api/captures/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await settle(id)).status).toBe("cancelled");
    expect(Date.now() - t).toBeLessThan(15_000);
  });
});
