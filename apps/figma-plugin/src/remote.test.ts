import { BUNDLE_FORMAT, type Document, SCHEMA_VERSION } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { readBundle } from "./read-bundle.ts";
import { importUrl, normalizeUrl, RemoteError, type Update } from "./remote.ts";

const ASSET = "a".repeat(64);
function bundle() {
  const ir = {
    schemaVersion: SCHEMA_VERSION,
    generator: { name: "web-to-figma", version: "test" },
    captures: [
      {
        id: "c1",
        url: "https://example.com/",
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
    assets: { [ASSET]: { mime: "image/png", width: 1, height: 1, byteLength: 3 } },
    fonts: [],
    diagnostics: [],
  } as unknown as Document;
  return { format: BUNDLE_FORMAT, ir, assetData: { [ASSET]: "AQID" } };
}

type Reply = { status: number; body?: unknown; raw?: string };
/** A scripted capture service: each request takes the next reply for its method + path. */
function service(script: Record<string, Reply[]>) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${new URL(String(input)).pathname}`;
    calls.push(key);
    const r = script[key]?.shift();
    if (!r) throw new TypeError("fetch failed");
    const text = r.raw ?? JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const ID = "11111111-2222-3333-4444-555555555555";
const job = (status: string, extra: object = {}) => ({
  id: ID,
  status,
  progress: 0,
  diagnostics: [],
  ...extra,
});
const request = { url: "https://example.com/", viewports: ["desktop"] };

function run(f: typeof fetch, signal = new AbortController().signal) {
  const updates: Update[] = [];
  const done = importUrl({
    api: "https://capture.test/",
    token: "tok",
    request,
    signal,
    onUpdate: (u) => updates.push(u),
    fetch: f,
    pollMs: 1,
  });
  return { done, updates };
}

describe("importUrl", () => {
  it("creates, polls and downloads a bundle that the importer accepts", async () => {
    const body = JSON.stringify(bundle());
    const { f, calls } = service({
      "POST /api/captures": [{ status: 202, body: job("queued", { position: 2 }) }],
      [`GET /api/captures/${ID}`]: [
        { status: 200, body: job("running", { progress: 0.5 }) },
        { status: 200, body: job("done", { progress: 1, bundleBytes: body.length }) },
      ],
      [`GET /api/captures/${ID}/bundle`]: [{ status: 200, raw: body }],
    });
    const { done, updates } = run(f);
    const json = await done;
    expect(calls).toEqual([
      "POST /api/captures",
      `GET /api/captures/${ID}`,
      `GET /api/captures/${ID}`,
      `GET /api/captures/${ID}/bundle`,
    ]);
    expect(updates.map((u) => u.phase)).toEqual(["sending", "queued", "running", "downloading"]);
    expect(updates[1]).toEqual({ phase: "queued", position: 2 });
    expect(updates.at(-1)).toEqual({ phase: "downloading", received: body.length, total: body.length });
    const r = readBundle(json, "example.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect([...(r.assets[ASSET] ?? [])]).toEqual([1, 2, 3]);
  });

  it("sends the request body and the bearer token", async () => {
    const seen: RequestInit[] = [];
    const f = (async (_: string, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(JSON.stringify({ error: "nope" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    await expect(run(f).done).rejects.toThrow("Nope.");
    expect(JSON.parse(String(seen[0]?.body))).toEqual(request);
    expect(new Headers(seen[0]?.headers).get("authorization")).toBe("Bearer tok");
  });

  it("explains an unreachable service", async () => {
    const { f } = service({});
    await expect(run(f).done).rejects.toThrow(/Can't reach the capture service \(https:\/\/capture\.test\)/);
  });

  it.each([
    [401, { error: "missing or invalid access token" }, /needs a valid access token/],
    [429, { error: "the service is busy, try again in a minute" }, /busy.*Try again in a minute/],
    [500, { error: "internal error" }, /had a problem \(500\)/],
  ])("maps HTTP %i to a readable message", async (status, body, message) => {
    const { f } = service({ "POST /api/captures": [{ status, body }] });
    await expect(run(f).done).rejects.toThrow(message);
  });

  it("passes blocked-URL diagnostics through", async () => {
    const diagnostics = [{ code: "URL_BLOCKED", severity: "fatal", message: "loopback" }];
    const { f } = service({ "POST /api/captures": [{ status: 400, body: { error: "x", diagnostics } }] });
    const e = await run(f).done.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RemoteError);
    expect((e as RemoteError).diagnostics).toEqual(diagnostics);
  });

  it("reports a failed capture with its diagnostics", async () => {
    const diagnostics = [{ code: "TIMEOUT", severity: "fatal", message: "took longer than 90s" }];
    const { f } = service({
      "POST /api/captures": [{ status: 202, body: job("running") }],
      [`GET /api/captures/${ID}`]: [{ status: 200, body: job("failed", { diagnostics }) }],
    });
    const e = (await run(f).done.catch((x: unknown) => x)) as RemoteError;
    expect(e.message).toBe("The page couldn't be captured.");
    expect(e.diagnostics).toEqual(diagnostics);
  });

  it("rejects a damaged download, and one over the size cap", async () => {
    const { f } = service({
      "POST /api/captures": [{ status: 202, body: job("done", { bundleBytes: 10 }) }],
      [`GET /api/captures/${ID}/bundle`]: [{ status: 200, raw: '{"format":' }],
    });
    await expect(run(f).done).rejects.toThrow(/damaged result/);

    const big = service({ "POST /api/captures": [{ status: 202, body: job("done", { bundleBytes: 2e9 }) }] });
    await expect(run(big.f).done).rejects.toThrow(/too large/);
    expect(big.calls).toEqual(["POST /api/captures"]);
  });

  it("explains an expired job", async () => {
    const { f } = service({
      "POST /api/captures": [{ status: 202, body: job("queued") }],
      [`GET /api/captures/${ID}`]: [{ status: 404, body: { error: "unknown or expired capture" } }],
    });
    await expect(run(f).done).rejects.toThrow(/expired/);
  });

  it("cancels the server job when aborted", async () => {
    const { f, calls } = service({
      "POST /api/captures": [{ status: 202, body: job("running") }],
      [`GET /api/captures/${ID}`]: Array.from({ length: 1000 }, () => ({
        status: 200,
        body: job("running"),
      })),
      [`DELETE /api/captures/${ID}`]: [{ status: 200, body: job("cancelled") }],
    });
    const c = new AbortController();
    const { done } = run(f, c.signal);
    await new Promise((r) => setTimeout(r, 20));
    c.abort();
    await expect(done).rejects.toBeDefined();
    expect(calls).toContain(`DELETE /api/captures/${ID}`);
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["example.com", "https://example.com/"],
    ["  http://example.com/a?b=1 ", "http://example.com/a?b=1"],
    ["https://example.com", "https://example.com/"],
  ])("accepts %s", (raw, url) => expect(normalizeUrl(raw)).toBe(url));
  it.each(["", "ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "http://"])(
    "rejects %s",
    (raw) => expect(normalizeUrl(raw)).toBeNull(),
  );
});

describe("readBundle", () => {
  it("decodes assets of a valid bundle", () => {
    const r = readBundle(bundle(), "x");
    expect(r.ok && [...(r.assets[ASSET] ?? [])]).toEqual([1, 2, 3]);
  });
  it("rejects JSON that is not a bundle, and an invalid one with its diagnostics", () => {
    expect(readBundle({ hello: 1 }, "x.json")).toMatchObject({
      ok: false,
      title: "x.json is not a web-to-figma bundle.",
    });
    const broken = { ...bundle(), assetData: {} };
    expect(readBundle(broken, "x.json")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "BUNDLE_INVALID" }],
    });
  });
  it("names diagnostics from a newer capture", () => {
    const b = bundle();
    (b.ir as unknown as { diagnostics: unknown[] }).diagnostics = [
      { code: "FROM_THE_FUTURE", severity: "info", message: "x" },
    ];
    expect(readBundle(b, "x.json")).toMatchObject({
      ok: false,
      title: expect.stringContaining("FROM_THE_FUTURE"),
    });
  });
});
