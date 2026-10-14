/// <reference path="../../../tests/fixture-server.ts" />

import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("a local service with a saved login (W2F_SESSION)", () => {
  it("captures a logged-in page through the API and keeps the cookie out of the bundle", async () => {
    const TOKEN = "fixture-session-token";
    const file = join(mkdtempSync(join(tmpdir(), "w2f-session-")), "auth.json");
    const cookie = { name: "w2f_session", value: TOKEN, domain: "127.0.0.1", path: "/", expires: -1 };
    writeFileSync(
      file,
      JSON.stringify({
        cookies: [{ ...cookie, httpOnly: true, secure: false, sameSite: "Lax" }],
        origins: [{ origin: fixture, localStorage: [{ name: "w2f_user", value: "Ada" }] }],
      }),
    );
    const own = createApp(
      { ...configFromEnv({}), allowPrivateNetworks: true, apiTokens: ["local"], sessionFile: file },
      undefined,
      () => {},
    );
    const srv = createServer((req, res) => void own.handle(req, res));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const api = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const headers = { authorization: "Bearer local", "content-type": "application/json" };
    try {
      const r = await fetch(`${api}/api/captures`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: `${fixture}/auth` }),
      });
      expect(r.status).toBe(202);
      const { id } = (await r.json()) as { id: string };
      let status = "queued";
      while (status === "queued" || status === "running") {
        await new Promise((res) => setTimeout(res, 250));
        status = (
          (await (await fetch(`${api}/api/captures/${id}`, { headers })).json()) as { status: string }
        ).status;
      }
      expect(status).toBe("done");
      const text = await (await fetch(`${api}/api/captures/${id}/bundle`, { headers })).text();
      expect(text).toContain("Signed in as Ada");
      expect(text).not.toContain("PAGE_REDIRECTED");
      expect(text).not.toContain(TOKEN);
    } finally {
      own.abortAll();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
