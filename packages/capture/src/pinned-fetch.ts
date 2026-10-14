import { type LookupAddress, lookup } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { addressVerdict } from "./policy.ts";

export class BlockedAddressError extends Error {}

type Resolve = (host: string) => Promise<LookupAddress[]>;
const defaultResolve: Resolve = (host) =>
  new Promise((ok, fail) => lookup(host, { all: true }, (e, addresses) => (e ? fail(e) : ok(addresses))));

/**
 * A `lookup` for http.request that vets every address the host resolves to and hands the socket
 * the vetted one: the check and the connect use the same answer, so DNS rebinding (public on the
 * check, 169.254.169.254 on the connect) has no second lookup to win.
 */
export function vettedLookup(
  allowPrivateNetworks: boolean,
  resolve: Resolve = defaultResolve,
): LookupFunction {
  return (host, options, callback) => {
    resolve(host).then(
      (addresses) => {
        for (const a of addresses) {
          const why = addressVerdict(a.address, allowPrivateNetworks);
          if (why) return callback(new BlockedAddressError(`${host}: ${why}`), "", 4);
        }
        const first = addresses[0];
        if (!first) return callback(new Error(`cannot resolve ${host}`), "", 4);
        if ((options as { all?: boolean }).all)
          return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
        callback(null, first.address, first.family);
      },
      (e: Error) => callback(e, "", 4),
    );
  };
}

export interface PinnedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer | null;
  allowPrivateNetworks: boolean;
  timeoutMs: number;
  /** Decoded body cap; larger responses fail the request. */
  maxBytes: number;
  resolve?: Resolve;
}

export interface PinnedResponse {
  status: number;
  /** Ready for route.fulfill: no content/transfer encoding, multi-value headers joined by "\n". */
  headers: Record<string, string>;
  body: Buffer;
}

/** Hop-by-hop and encoding headers that must not pass between the two connections. */
const DROP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
  "host",
]);
const DROP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

function decode(body: Buffer, encoding: string | undefined): Buffer {
  const e = (encoding ?? "").trim().toLowerCase();
  if (e === "" || e === "identity") return body;
  if (e === "gzip" || e === "x-gzip") return gunzipSync(body);
  if (e === "deflate") return inflateSync(body);
  if (e === "br") return brotliDecompressSync(body);
  throw new Error(`unsupported content-encoding ${e}`);
}

const flatten = (headers: IncomingHttpHeaders): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || DROP_RESPONSE.has(k)) continue;
    out[k] = Array.isArray(v) ? v.join("\n") : v;
  }
  return out;
};

/**
 * One HTTP request from Node, without following redirects, connected only to vetted addresses.
 * Hosted mode routes every browser request through this (see capture.ts guardNetwork).
 */
export function pinnedFetch(req: PinnedRequest): Promise<PinnedResponse> {
  const url = new URL(req.url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Literal IPs never reach `lookup`.
  if (isIP(host)) {
    const why = addressVerdict(host, req.allowPrivateNetworks);
    if (why) return Promise.reject(new BlockedAddressError(`${host}: ${why}`));
  }
  const headers: Record<string, string> = { "accept-encoding": "gzip, deflate, br" };
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQUEST.has(k.toLowerCase())) headers[k] = v;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const r = send(
      url,
      {
        method: req.method,
        headers,
        lookup: vettedLookup(req.allowPrivateNetworks, req.resolve),
        timeout: req.timeoutMs,
        // No keep-alive: a pooled socket could outlive the lookup that vetted it.
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > req.maxBytes) {
            res.destroy(new Error(`response over ${req.maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const body = decode(Buffer.concat(chunks), res.headers["content-encoding"]);
            if (body.length > req.maxBytes) throw new Error(`response over ${req.maxBytes} bytes`);
            resolve({ status: res.statusCode ?? 502, headers: flatten(res.headers), body });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("timeout", () => r.destroy(new Error(`no response within ${req.timeoutMs / 1000}s`)));
    r.on("error", reject);
    r.end(req.body ?? undefined);
  });
}
