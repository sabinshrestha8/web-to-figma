import { describe, expect, it } from "vitest";
import { getAsset, getBundle, getCaptureIR, getConversion, postConversions } from "./api.ts";
import { createStore } from "./jobs.ts";

const HOST = "127.0.0.1:4317";
const post = (body: unknown, host = HOST) =>
  new Request(`http://${HOST}/api/conversions`, {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (path: string, host = HOST) => new Request(`http://${HOST}${path}`, { headers: { host } });
const never = () => new Promise<never>(() => {});

const valid = {
  targets: [{ url: "http://127.0.0.1:4400/landing" }],
  viewports: ["1440x900", { width: 390, height: 844, dpr: 2 }],
};

describe("POST /api/conversions", () => {
  it("queues a job with 202 {id}", async () => {
    const r = await postConversions(post(valid), createStore(never));
    expect(r.status).toBe(202);
    expect((await r.json()) as { id: string }).toMatchObject({ id: expect.any(String) });
  });

  it("rejects a cross-origin POST with 403", async () => {
    const r = await postConversions(post(valid, "evil.com"), createStore(never));
    expect(r.status).toBe(403);
  });

  it("rejects bodies outside the schema with 400 INVALID_INPUT", async () => {
    const store = createStore(never);
    for (const body of [
      {},
      { targets: [], viewports: ["1440x900"] },
      { targets: [{ url: "x" }], viewports: Array(4).fill("1440x900") },
      { targets: [{ url: "x" }], viewports: ["huge"] },
      { targets: [{ url: "x" }], viewports: ["100x100"] },
      { targets: [{ url: "x" }], viewports: [{ width: 1440, height: 900, dpr: 3 }] },
      { targets: [{ url: "x" }], viewports: ["1440x900"], options: { extraSettleMs: 6000 } },
    ]) {
      const r = await postConversions(post(body), store);
      expect(r.status, JSON.stringify(body)).toBe(400);
      const codes = (((await r.json()) as { diagnostics: { code: string }[] }).diagnostics ?? []).map(
        (d) => d.code,
      );
      expect(codes).toEqual(["INVALID_INPUT"]);
    }
  });

  it("rejects a metadata URL with 400 URL_BLOCKED", async () => {
    const r = await postConversions(
      post({ targets: [{ url: "http://169.254.169.254/latest" }], viewports: ["1440x900"] }),
      createStore(never),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ diagnostics: [{ code: "URL_BLOCKED" }] });
  });

  it("rejects the third concurrent job with 429", async () => {
    const store = createStore(never);
    expect((await postConversions(post(valid), store)).status).toBe(202);
    expect((await postConversions(post(valid), store)).status).toBe(202);
    expect((await postConversions(post(valid), store)).status).toBe(429);
  });
});

describe("job reads", () => {
  it("returns 404 for unknown ids on every read", async () => {
    const store = createStore(never);
    expect((await getConversion(get("/api/conversions/nope"), store, "nope")).status).toBe(404);
    expect((await getBundle(get("/x"), store, "nope")).status).toBe(404);
    expect((await getCaptureIR(get("/x"), store, "nope", "c1")).status).toBe(404);
    expect((await getAsset(get("/x"), store, "nope", "dead")).status).toBe(404);
  });
});
