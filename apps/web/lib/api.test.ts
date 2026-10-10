import { describe, expect, it } from "vitest";
import {
  deleteSession,
  getAsset,
  getBundle,
  getCaptureIR,
  getConversion,
  getLogin,
  getSession,
  postConversions,
  postLogin,
  withScheme,
} from "./api.ts";
import { createStore } from "./jobs.ts";
import { createLoginStore } from "./session.ts";

const HOST = "127.0.0.1:4317";
const post = (path: string, body: unknown, host = HOST) =>
  new Request(`http://${HOST}${path}`, {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (path: string, host = HOST) => new Request(`http://${HOST}${path}`, { headers: { host } });
const never = () => new Promise<never>(() => {});
const logins = () => createLoginStore(never);

const valid = {
  targets: [{ url: "http://127.0.0.1:4400/landing" }],
  viewports: ["1440x900", { width: 390, height: 844, dpr: 2 }],
};

describe("POST /api/conversions", () => {
  it.each([
    ["employer.veloxlabs.net/login", "https://employer.veloxlabs.net/login"],
    ["127.0.0.1:4400/landing", "http://127.0.0.1:4400/landing"],
    ["localhost:3000/", "http://localhost:3000/"],
    ["https://a.b/c", "https://a.b/c"],
    ["http://a.b/c", "http://a.b/c"],
    ["ftp://a.b/c", "ftp://a.b/c"],
    ["not a url", "https://not a url"],
  ])("withScheme(%s) → %s", (raw, want) => {
    expect(withScheme(raw)).toBe(want);
  });

  it("queues a job with 202 {id}", async () => {
    const r = await postConversions(post("/api/conversions", valid), createStore(never), logins());
    expect(r.status).toBe(202);
    expect((await r.json()) as { id: string }).toMatchObject({ id: expect.any(String) });
  });

  it("rejects a cross-origin POST with 403", async () => {
    const r = await postConversions(
      post("/api/conversions", valid, "evil.com"),
      createStore(never),
      logins(),
    );
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
      const r = await postConversions(post("/api/conversions", body), store, logins());
      expect(r.status, JSON.stringify(body)).toBe(400);
      const codes = (((await r.json()) as { diagnostics: { code: string }[] }).diagnostics ?? []).map(
        (d) => d.code,
      );
      expect(codes).toEqual(["INVALID_INPUT"]);
    }
  });

  it("rejects a metadata URL with 400 URL_BLOCKED", async () => {
    const r = await postConversions(
      post("/api/conversions", {
        targets: [{ url: "http://169.254.169.254/latest" }],
        viewports: ["1440x900"],
      }),
      createStore(never),
      logins(),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ diagnostics: [{ code: "URL_BLOCKED" }] });
  });

  it("accepts a bare loopback hostname end to end", async () => {
    const seen: string[] = [];
    const store = createStore(async (job) => {
      seen.push(...job.urls);
      return { ok: false, diagnostics: [] };
    });
    const r = await postConversions(
      post("/api/conversions", { targets: [{ url: "127.0.0.1:4400/landing" }], viewports: ["1440x900"] }),
      store,
      logins(),
    );
    expect(r.status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["http://127.0.0.1:4400/landing"]);
  });

  it("rejects the third concurrent job with 429", async () => {
    const store = createStore(never);
    const loginStore = logins();
    const submit = () => postConversions(post("/api/conversions", valid), store, loginStore);
    expect((await submit()).status).toBe(202);
    expect((await submit()).status).toBe(202);
    expect((await submit()).status).toBe(429);
  });

  it("rejects session:true with 400 when no session is saved", async () => {
    const r = await postConversions(
      post("/api/conversions", { ...valid, session: true }),
      createStore(never),
      logins(),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ diagnostics: [{ code: "INVALID_INPUT" }] });
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

describe("login endpoints", () => {
  it("opens a login with 202, reports it, rejects a second open one with 429", async () => {
    const logins = createLoginStore(never);
    const opened = await postLogin(post("/api/login", { url: "http://127.0.0.1:4400/auth" }), logins);
    expect(opened.status).toBe(202);
    const { id } = (await opened.json()) as { id: string };
    expect((await getLogin(get(`/api/login/${id}`), logins, id)).status).toBe(200);
    expect(await (await getLogin(get(`/api/login/${id}`), logins, id)).json()).toMatchObject({
      status: "open",
    });
    expect((await postLogin(post("/api/login", { url: "http://127.0.0.1:4400/auth" }), logins)).status).toBe(
      429,
    );
    expect((await getLogin(get("/api/login/nope"), logins, "nope")).status).toBe(404);
  });

  it("rejects bad login bodies and blocked URLs", async () => {
    const logins = createLoginStore(never);
    expect((await postLogin(post("/api/login", {}), logins)).status).toBe(400);
    const blocked = await postLogin(post("/api/login", { url: "http://169.254.169.254/" }), logins);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ diagnostics: [{ code: "URL_BLOCKED" }] });
    expect((await postLogin(post("/api/login", { url: "x" }), logins)).status).toBe(400);
  });

  it("reports and forgets the saved session without secret values", async () => {
    const logins = createLoginStore(never);
    expect(await (await getSession(get("/api/session"), logins)).json()).toMatchObject({ present: false });
    expect(await (await deleteSession(get("/api/session"), logins)).json()).toEqual({ deleted: false });
  });
});
