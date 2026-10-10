/// <reference path="../../../../../tests/fixture-server.ts" />

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, saveLogin } from "@w2f/capture";
import { afterAll, describe, expect, inject, it } from "vitest";
import { getAsset, getBundle, getCaptureIR, getConversion, postConversions } from "../../../lib/api.ts";
import { createStore } from "../../../lib/jobs.ts";
import { authPath, createLoginStore } from "../../../lib/session.ts";

const base = inject("fixtureUrl");
const HOST = "127.0.0.1:4317";
const post = (body: unknown) =>
  new Request(`http://${HOST}/api/conversions`, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (path: string) => new Request(`http://${HOST}${path}`, { headers: { host: HOST } });

afterAll(closeBrowser);

// Phase 7b: the full web journey against the fixture site, through the real pipeline.
describe("web flow", () => {
  it("captures through the API: POST → poll → bundle → ir → asset", async () => {
    process.env.W2F_DATA_DIR = join(mkdtempSync(join(tmpdir(), "w2f-web-flow-")), "jobs");
    const store = createStore();
    const posted = await postConversions(
      post({ targets: [{ url: `${base}/landing` }], viewports: ["1440x900"] }),
      store,
      createLoginStore(),
    );
    expect(posted.status).toBe(202);
    const { id } = (await posted.json()) as { id: string };

    let status = { status: "", captures: [], diagnostics: [] } as {
      status: string;
      captures: { id: string; url: string; irNodes: number; assets: number; fonts: string[] }[];
      diagnostics: unknown[];
    };
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const g = await getConversion(get(`/api/conversions/${id}`), store, id);
      expect(g.status).toBe(200);
      status = (await g.json()) as typeof status;
      if (status.status === "done" || status.status === "failed") break;
    }
    expect(status.status, JSON.stringify(status.diagnostics)).toBe("done");
    expect(status.captures).toHaveLength(1);
    const [cap] = status.captures;
    expect(cap?.irNodes).toBeGreaterThan(0);
    expect(cap?.fonts).toContain("Inter");

    const bundle = await getBundle(get(`/api/conversions/${id}/bundle`), store, id);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-disposition")).toContain(".w2f.json");
    const body = (await bundle.json()) as { ir: { captures: { id: string }[] } };
    expect(body.ir.captures.map((c) => c.id)).toEqual([cap?.id]);

    const ir = await getCaptureIR(get("/x"), store, id, cap?.id ?? "");
    expect(ir.status).toBe(200);
    const { capture, assetUrls } = (await ir.json()) as {
      capture: { id: string; screenshot?: string };
      assetUrls: Record<string, string>;
    };
    expect(capture.id).toBe(cap?.id);
    expect(Object.keys(assetUrls).length).toBeGreaterThan(0);

    const shot = await getAsset(get("/x"), store, id, capture.screenshot ?? "");
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    expect((await shot.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const { rmSync } = await import("node:fs");
    rmSync(process.env.W2F_DATA_DIR, { recursive: true, force: true });
    delete process.env.W2F_DATA_DIR;
  }, 120_000);

  it("captures a logged-in page with the saved session, keeping it out of the bundle", async () => {
    // The fixture guard only accepts this value (see fixtures/site/app/auth/page.tsx).
    const TOKEN = "fixture-session-token";
    process.env.W2F_DATA_DIR = join(mkdtempSync(join(tmpdir(), "w2f-web-session-")), "jobs");
    const saved = await saveLogin(`${base}/landing`, authPath(), {
      headless: true,
      act: async (page) => {
        await page.context().addCookies([
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
        ]);
        await page.evaluate(() => localStorage.setItem("w2f_user", "Ada"));
        await page.close();
      },
    });
    expect(saved).toBeGreaterThan(0);

    const store = createStore();
    const posted = await postConversions(
      post({ targets: [{ url: `${base}/auth` }], viewports: ["1440x900"], session: true }),
      store,
      createLoginStore(),
    );
    expect(posted.status).toBe(202);
    const { id } = (await posted.json()) as { id: string };
    let status = "";
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const g = await getConversion(get(`/api/conversions/${id}`), store, id);
      status = ((await g.json()) as { status: string }).status;
      if (status === "done" || status === "failed") break;
    }
    expect(status).toBe("done");

    const bundle = await getBundle(get(`/api/conversions/${id}/bundle`), store, id);
    const bj = (await bundle.json()) as {
      ir: { captures: { id: string; url: string }[]; diagnostics: { code: string }[] };
    };
    const text = JSON.stringify(bj);
    expect(text).toContain("Signed in as Ada");
    expect(text).not.toContain(TOKEN);

    const { rmSync } = await import("node:fs");
    rmSync(process.env.W2F_DATA_DIR, { recursive: true, force: true });
    delete process.env.W2F_DATA_DIR;
  }, 120_000);
});
