import type { Diagnostic } from "@w2f/ir";

/** The hosted capture service's API (apps/server): create, poll, download, cancel. */

export interface CaptureRequest {
  url: string;
  viewports: string[];
  click?: string[];
  waitFor?: string[];
}

export type Update =
  | { phase: "sending" }
  | { phase: "queued"; position: number }
  | { phase: "running"; progress: number }
  | { phase: "downloading"; received: number; total: number };

/** A failure the UI shows as is: `message` is written for the user. */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message);
  }
}

export interface ImportOptions {
  api: string;
  token?: string;
  request: CaptureRequest;
  signal: AbortSignal;
  onUpdate: (u: Update) => void;
  fetch?: typeof fetch;
  pollMs?: number;
  /** Refuse bundles larger than this (decoded bytes). */
  maxBytes?: number;
}

interface JobView {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  position?: number;
  bundleBytes?: number;
  diagnostics: Diagnostic[];
}

/** Scheme-less input gets https://, as browsers do. Returns null for anything but http(s). */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null; // not a URL
  }
  return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? u.href : null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Turns an error response into the message the user sees. */
async function failure(r: Response): Promise<RemoteError> {
  let body: { error?: string; diagnostics?: Diagnostic[] } = {};
  if ((r.headers.get("content-type") ?? "").includes("application/json"))
    body = (await r.json().catch(() => ({}))) as typeof body;
  const said = body.error ? `${body.error[0]?.toUpperCase()}${body.error.slice(1)}.` : "";
  if (r.status === 401) return new RemoteError("The capture service needs a valid access token (Settings).");
  if (r.status === 429)
    return new RemoteError(`${said || "The capture service is busy."} Try again in a minute.`);
  if (r.status === 404) return new RemoteError("The capture expired on the server. Import the page again.");
  if (r.status >= 400 && r.status < 500)
    return new RemoteError(said || `The request was rejected (${r.status}).`, body.diagnostics ?? []);
  return new RemoteError(`The capture service had a problem (${r.status}). Try again later.`);
}

/**
 * Captures `request.url` on the service and returns the bundle JSON (unvalidated: the caller
 * runs it through parseBundle like a dropped file). Aborting `signal` cancels the server job too.
 */
export async function importUrl(o: ImportOptions): Promise<unknown> {
  const f = o.fetch ?? fetch;
  const api = o.api.replace(/\/+$/, "");
  const auth: Record<string, string> = o.token ? { authorization: `Bearer ${o.token}` } : {};
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      return await f(`${api}${path}`, { ...init, headers: { ...auth, ...init.headers }, signal: o.signal });
    } catch (e) {
      if (o.signal.aborted) throw e;
      throw new RemoteError(`Can't reach the capture service (${api}). Check your connection and try again.`);
    }
  };

  o.onUpdate({ phase: "sending" });
  const created = await call("/api/captures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(o.request),
  });
  if (!created.ok) throw await failure(created);
  let job = (await created.json()) as JobView;

  // Cancelling stops the server's work as well; nobody waits for the reply.
  const cancel = () =>
    void f(`${api}/api/captures/${job.id}`, { method: "DELETE", headers: auth }).catch((e: unknown) =>
      console.warn("cancel request failed", e),
    );
  o.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (job.status === "queued" || job.status === "running") {
      o.onUpdate(
        job.status === "queued"
          ? { phase: "queued", position: job.position ?? 1 }
          : { phase: "running", progress: job.progress },
      );
      await sleep(o.pollMs ?? 1000, o.signal);
      const r = await call(`/api/captures/${job.id}`);
      if (!r.ok) throw await failure(r);
      job = (await r.json()) as JobView;
    }
    if (job.status === "failed") throw new RemoteError("The page couldn't be captured.", job.diagnostics);
    if (job.status === "cancelled") throw new RemoteError("The capture was cancelled on the server.");

    const total = job.bundleBytes ?? 0;
    const max = o.maxBytes ?? 150_000_000;
    if (total > max) throw new RemoteError(`The design is too large to import (${mb(total)}).`);
    const r = await call(`/api/captures/${job.id}/bundle`);
    if (!r.ok || !r.body) throw await failure(r);
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > max) {
        await reader.cancel();
        throw new RemoteError(`The design is too large to import (over ${mb(max)}).`);
      }
      chunks.push(value);
      o.onUpdate({ phase: "downloading", received, total: Math.max(total, received) });
    }
    const bytes = new Uint8Array(received);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new RemoteError("The capture service sent a damaged result. Try again.", [
        { code: "BUNDLE_INVALID", severity: "fatal", message: "the downloaded bundle is not valid JSON" },
      ]);
    }
  } finally {
    o.signal.removeEventListener("abort", cancel);
  }
}

export const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
