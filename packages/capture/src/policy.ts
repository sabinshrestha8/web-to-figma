import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { type Diagnostic, diag } from "@w2f/ir";

export interface PolicyOptions {
  /** Local mode allows loopback and private ranges (that's where dev servers live). Hosted mode must not. */
  allowPrivateNetworks: boolean;
  /** Injectable resolver for tests. Returns every address the host resolves to. */
  resolve?: (host: string) => Promise<string[]>;
}

const ALWAYS_BLOCKED = new BlockList();
ALWAYS_BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, cloud metadata
ALWAYS_BLOCKED.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
ALWAYS_BLOCKED.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
ALWAYS_BLOCKED.addAddress("::", "ipv6");
ALWAYS_BLOCKED.addSubnet("fe80::", 10, "ipv6"); // link-local
ALWAYS_BLOCKED.addSubnet("ff00::", 8, "ipv6"); // multicast
ALWAYS_BLOCKED.addAddress("fd00:ec2::254", "ipv6"); // AWS IPv6 metadata

const PRIVATE = new BlockList();
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT (incl. Alibaba metadata 100.100.100.200)
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6"); // unique local

/** `::ffff:a9fe:a9fe` / `::ffff:169.254.169.254` → `169.254.169.254`; anything else unchanged. */
export function unmapIPv4(address: string): string {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex?.[1] || !hex[2]) return address;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Why an address is not allowed, or null if it is. */
export function addressVerdict(address: string, allowPrivateNetworks: boolean): string | null {
  const ip = unmapIPv4(address);
  const family = isIP(ip) === 6 ? "ipv6" : "ipv4";
  if (ALWAYS_BLOCKED.check(ip, family)) return `${ip} is link-local, metadata, multicast or reserved`;
  if (!allowPrivateNetworks && PRIVATE.check(ip, family)) return `${ip} is a private or loopback address`;
  return null;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

/**
 * Network policy for one capture. `check` returns a blocking Diagnostic or null.
 * The WHATWG URL parser already canonicalizes odd IPv4 spellings (decimal, octal, hex).
 * Verdicts are cached per host for the lifetime of the policy (one capture).
 */
export function createPolicy(opts: PolicyOptions) {
  const resolve = opts.resolve ?? defaultResolve;
  const verdicts = new Map<string, Promise<string | null>>();

  const hostVerdict = (host: string) => {
    let v = verdicts.get(host);
    if (!v) {
      v = (async () => {
        const addresses = isIP(host) ? [host] : await resolve(host).catch((e: unknown) => e as Error);
        if (addresses instanceof Error) return `cannot resolve ${host}: ${addresses.message}`;
        for (const a of addresses) {
          const why = addressVerdict(a, opts.allowPrivateNetworks);
          if (why) return why;
        }
        return null;
      })();
      verdicts.set(host, v);
    }
    return v;
  };

  return {
    /** `subresource` allows data:/blob: URLs, which never touch the network. */
    async check(raw: string, subresource: boolean): Promise<Diagnostic | null> {
      if (!URL.canParse(raw)) return diag("URL_BLOCKED", `not a valid URL: ${raw.slice(0, 200)}`);
      const url = new URL(raw);
      if (subresource && (url.protocol === "data:" || url.protocol === "blob:")) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return diag("URL_BLOCKED", `scheme ${url.protocol} is not allowed`, { detail: { url: url.origin } });
      }
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const why = await hostVerdict(host);
      return why ? diag("URL_BLOCKED", `${url.hostname}: ${why}`, { detail: { host: url.hostname } }) : null;
    },
  };
}
export type Policy = ReturnType<typeof createPolicy>;
