import { describe, expect, it } from "vitest";
import { guard } from "./guard.ts";

const req = (init: { host?: string; origin?: string; method?: string; contentType?: string }) =>
  new Request("http://127.0.0.1:4317/api/conversions", {
    method: init.method ?? "GET",
    headers: {
      ...(init.host === undefined ? {} : { host: init.host }),
      ...(init.origin === undefined ? {} : { origin: init.origin }),
      ...(init.contentType === undefined ? {} : { "content-type": init.contentType }),
    },
  });

describe("Host/Origin guard", () => {
  it.each(["127.0.0.1:4317", "localhost:4317"])("passes local %s", (host) => {
    expect(guard(req({ host }))).toBeNull();
  });

  it.each([
    ["rebound host", "evil.com"],
    ["missing host", undefined],
    ["DNS rebinding", "127.0.0.1.nip.io:4317"],
    ["wrong port", "127.0.0.1:4400"],
  ])("rejects %s with 403", (_why, host) => {
    expect(guard(req({ host }))?.status).toBe(403);
  });

  it("rejects a cross-origin POST with 403", () => {
    const r = guard(
      req({
        host: "127.0.0.1:4317",
        origin: "https://evil.test",
        method: "POST",
        contentType: "application/json",
      }),
    );
    expect(r?.status).toBe(403);
  });

  it("passes a same-origin POST and a bodyless GET without origin", () => {
    expect(
      guard(
        req({
          host: "127.0.0.1:4317",
          origin: "http://127.0.0.1:4317",
          method: "POST",
          contentType: "application/json",
        }),
      ),
    ).toBeNull();
    expect(guard(req({ host: "localhost:4317" }))).toBeNull();
  });

  it("rejects a POST without a JSON content type", () => {
    expect(guard(req({ host: "127.0.0.1:4317", method: "POST", contentType: "text/plain" }))?.status).toBe(
      403,
    );
  });
});
