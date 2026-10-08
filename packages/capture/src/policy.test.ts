import { describe, expect, it } from "vitest";
import { createPolicy, unmapIPv4 } from "./policy.ts";

// Fake DNS so tests never touch the network. "rebind.test" mimics a hostile domain pointing at metadata.
const dns: Record<string, string[]> = {
  "public.test": ["93.184.216.34"],
  localhost: ["127.0.0.1", "::1"],
  "rebind.test": ["93.184.216.34", "169.254.169.254"],
  "lan.test": ["192.168.1.20"],
};
const resolve = async (host: string) => {
  const a = dns[host];
  if (!a) throw new Error("ENOTFOUND");
  return a;
};

const local = createPolicy({ allowPrivateNetworks: true, resolve });
const hosted = createPolicy({ allowPrivateNetworks: false, resolve });
const verdict = async (p: typeof local, url: string, sub = false) => (await p.check(url, sub))?.code ?? "ok";

describe("URL policy", () => {
  it.each([
    ["http://public.test/", "ok", "ok"],
    ["https://public.test:8443/x?y", "ok", "ok"],
    ["http://localhost:3000/", "ok", "URL_BLOCKED"],
    ["http://127.0.0.1:3000/", "ok", "URL_BLOCKED"],
    ["http://[::1]:3000/", "ok", "URL_BLOCKED"],
    ["http://lan.test/", "ok", "URL_BLOCKED"],
    ["http://10.1.2.3/", "ok", "URL_BLOCKED"],
    ["http://169.254.169.254/latest/meta-data/", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://2852039166/", "URL_BLOCKED", "URL_BLOCKED"], // decimal 169.254.169.254
    ["http://0xa9.0xfe.0xa9.0xfe/", "URL_BLOCKED", "URL_BLOCKED"], // hex
    ["http://0251.0376.0251.0376/", "URL_BLOCKED", "URL_BLOCKED"], // octal
    ["http://[::ffff:169.254.169.254]/", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://[fd00:ec2::254]/", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://[fe80::1]/", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://0.0.0.0:3000/", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://224.0.0.1/", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://rebind.test/", "URL_BLOCKED", "URL_BLOCKED"], // any blocked address taints the host
    ["file:///etc/passwd", "URL_BLOCKED", "URL_BLOCKED"],
    ["javascript:alert(1)", "URL_BLOCKED", "URL_BLOCKED"],
    ["data:text/html,<h1>x</h1>", "URL_BLOCKED", "URL_BLOCKED"], // not allowed as a page
    ["not a url", "URL_BLOCKED", "URL_BLOCKED"],
    ["http://unknown.test/", "URL_BLOCKED", "URL_BLOCKED"], // unresolvable
  ])("%s → local %s, hosted %s", async (url, localExpected, hostedExpected) => {
    expect(await verdict(local, url)).toBe(localExpected);
    expect(await verdict(hosted, url)).toBe(hostedExpected);
  });

  it("allows data: and blob: only as subresources", async () => {
    expect(await verdict(local, "data:image/png;base64,AA==", true)).toBe("ok");
    expect(await verdict(local, "blob:http://localhost/abc", true)).toBe("ok");
  });

  it("unmaps IPv4-mapped IPv6 in both notations", () => {
    expect(unmapIPv4("::ffff:a9fe:a9fe")).toBe("169.254.169.254");
    expect(unmapIPv4("::FFFF:127.0.0.1")).toBe("127.0.0.1");
    expect(unmapIPv4("2001:db8::1")).toBe("2001:db8::1");
  });
});
