import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlockedAddressError, pinnedFetch } from "./pinned-fetch.ts";

let server: Server;
let port = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") return res.writeHead(302, { location: "/elsewhere" }).end();
    if (req.url === "/big") return res.end(Buffer.alloc(2048));
    res.writeHead(200, {
      "content-type": "text/plain",
      "content-encoding": "gzip",
      "set-cookie": ["a=1", "b=2"],
    });
    res.end(gzipSync(`hello ${req.method} ${req.headers["x-test"] ?? ""}`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const base = { method: "GET", headers: {}, timeoutMs: 5000, maxBytes: 1024 };

describe("pinnedFetch", () => {
  it("fetches, decodes gzip and drops the encoding headers", async () => {
    const r = await pinnedFetch({
      ...base,
      url: `http://127.0.0.1:${port}/`,
      headers: { "x-test": "yes" },
      allowPrivateNetworks: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe("hello GET yes");
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers["set-cookie"]).toBe("a=1\nb=2");
  });

  it("returns redirects instead of following them", async () => {
    const r = await pinnedFetch({
      ...base,
      url: `http://127.0.0.1:${port}/redirect`,
      allowPrivateNetworks: true,
    });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("/elsewhere");
  });

  it("refuses responses over the byte cap", async () => {
    await expect(
      pinnedFetch({ ...base, url: `http://127.0.0.1:${port}/big`, allowPrivateNetworks: true }),
    ).rejects.toThrow(/over 1024 bytes/);
  });

  it("blocks private literals and names that resolve to them", async () => {
    await expect(
      pinnedFetch({ ...base, url: `http://127.0.0.1:${port}/`, allowPrivateNetworks: false }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(
      pinnedFetch({ ...base, url: "http://169.254.169.254/latest/meta-data/", allowPrivateNetworks: true }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("connects to the address it vetted (a rebinding second answer is never used)", async () => {
    // First answer public, every later one the metadata address: only one lookup may happen.
    let calls = 0;
    const resolve = async () => {
      calls++;
      return [{ address: calls === 1 ? "127.0.0.1" : "169.254.169.254", family: 4 }];
    };
    const r = await pinnedFetch({
      ...base,
      url: `http://rebind.test:${port}/`,
      allowPrivateNetworks: true,
      resolve,
    });
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("blocks a name when any of its addresses is blocked", async () => {
    const resolve = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(
      pinnedFetch({ ...base, url: "http://mixed.test/", allowPrivateNetworks: false, resolve }),
    ).rejects.toThrow(/10\.0\.0\.5 is a private/);
  });
});
