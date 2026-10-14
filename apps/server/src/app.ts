import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { gunzipSync, gzipSync } from "node:zlib";
import { type ConvertJob, convertUrls, createPolicy, parseViewport, type Viewport } from "@w2f/capture";
import { type Bundle, type Diagnostic, diag, type Result } from "@w2f/ir";
import { z } from "zod";

/** The hosted capture API (docs/api.md, "Hosted capture service"). Env names in .env.example. */
export interface ServerConfig {
  /** Captures running at once; each holds a Chromium context (~200–500 MB at peak). */
  maxRunning: number;
  /** Waiting jobs; beyond this POST answers 429 busy. */
  maxQueued: number;
  /** Capture requests per client per hour. */
  ratePerHour: number;
  /** Bearer tokens; empty = no auth (rate limits still apply). */
  apiTokens: string[];
  /** Read the client IP from X-Forwarded-For (only behind a proxy that sets it). */
  trustProxy: boolean;
  /** How long a finished job's result stays downloadable. */
  resultTtlMs: number;
  /** Serialized bundle cap; Figma's plugin UI has to hold all of it in memory. */
  maxBundleBytes: number;
  /** Development only: lets the service capture localhost. Never in production. */
  allowPrivateNetworks: boolean;
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function configFromEnv(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    maxRunning: Math.max(1, int(env.W2F_MAX_RUNNING, 2)),
    maxQueued: int(env.W2F_MAX_QUEUED, 8),
    ratePerHour: int(env.W2F_RATE_PER_HOUR, 30),
    apiTokens: (env.W2F_API_TOKENS ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== ""),
    trustProxy: env.W2F_TRUST_PROXY === "1",
    resultTtlMs: int(env.W2F_RESULT_TTL_MS, 10 * 60_000),
    maxBundleBytes: int(env.W2F_MAX_BUNDLE_MB, 60) * 1024 * 1024,
    allowPrivateNetworks: env.W2F_ALLOW_PRIVATE === "1",
  };
}

const VIEWPORTS: Record<string, Viewport> = {
  desktop: { width: 1440, height: 900, dpr: 1 },
  tablet: { width: 768, height: 1024, dpr: 1 },
  mobile: { width: 390, height: 844, dpr: 2 },
};

const selector = z.string().trim().min(1).max(500);
export const CaptureInput = z.strictObject({
  url: z.string().trim().min(1).max(2000),
  viewports: z
    .array(z.union([z.enum(["desktop", "tablet", "mobile"]), z.string().regex(/^\d+x\d+(@[12])?$/)]))
    .min(1)
    .max(3)
    .default(["desktop"]),
  /** Playwright selectors clicked in order (opens a dialog); selectors only, never scripts. */
  click: z.array(selector).max(5).optional(),
  waitFor: z.array(selector).max(5).optional(),
  extraSettleMs: z.number().int().min(0).max(5000).optional(),
});

type Status = "queued" | "running" | "done" | "failed" | "cancelled";
interface Job {
  id: string;
  client: string;
  host: string;
  status: Status;
  progress: number;
  diagnostics: Diagnostic[];
  /** The gzipped bundle JSON, once done. */
  bundle?: Buffer;
  bundleBytes?: number;
  finishedAt?: number;
  controller: AbortController;
  start: () => void;
}

export type Execute = (job: ConvertJob) => Promise<Result<Bundle>>;
export type Log = (fields: Record<string, unknown>) => void;

/** Scheme-less input gets https://, as browsers do. */
const withScheme = (raw: string) => (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);

const CORS = {
  // Figma plugin iframes have a null origin, so "*" is the only value that works; no cookies are
  // used (auth is a bearer header), so a wildcard grants nothing a script elsewhere couldn't do.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "600",
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const MAX_BODY = 16 * 1024;
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body over 16 KB");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly diagnostics?: Diagnostic[],
  ) {
    super(message);
  }
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export function createApp(
  config: ServerConfig,
  execute: Execute = convertUrls,
  log: Log = (f) => console.log(JSON.stringify({ t: new Date().toISOString(), ...f })),
) {
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  const recent = new Map<string, number[]>();
  const tokens = config.apiTokens.map(digest);
  let running = 0;

  /** The caller's identity for limits: its token if any, else its IP. */
  function client(req: IncomingMessage): string {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (tokens.length > 0) {
      const d = digest(token);
      if (!token || !tokens.some((t) => timingSafeEqual(t, d)))
        throw new HttpError(401, "missing or unknown API token");
      return `token:${d.toString("hex").slice(0, 16)}`;
    }
    const forwarded = config.trustProxy
      ? String(req.headers["x-forwarded-for"] ?? "")
          .split(",")[0]
          ?.trim()
      : "";
    return `ip:${forwarded || req.socket.remoteAddress || "unknown"}`;
  }

  function rateLimit(who: string) {
    const now = Date.now();
    const times = (recent.get(who) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= config.ratePerHour)
      throw new HttpError(429, `rate limit: ${config.ratePerHour} captures per hour, try again later`);
    times.push(now);
    recent.set(who, times);
  }

  function pump() {
    while (running < config.maxRunning) {
      const next = queue.shift();
      if (!next) return;
      next.start();
    }
  }

  function sweep(now = Date.now()) {
    for (const [id, job] of jobs)
      if (job.finishedAt !== undefined && now - job.finishedAt > config.resultTtlMs) jobs.delete(id);
    for (const [who, times] of recent) if (times.every((t) => now - t >= 3_600_000)) recent.delete(who);
  }

  async function create(req: IncomingMessage) {
    const who = client(req);
    const parsed = CaptureInput.safeParse(await readJson(req));
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      throw new HttpError(400, message, [diag("INVALID_INPUT", message)]);
    }
    const input = parsed.data;
    const viewports: Viewport[] = [];
    for (const v of input.viewports) {
      const vp = VIEWPORTS[v] ?? parseViewport(v);
      if (vp.width < 240 || vp.width > 3840 || vp.height < 240 || vp.height > 4000)
        throw new HttpError(400, `viewport ${v} outside 240–3840 x 240–4000`, [
          diag("INVALID_INPUT", `viewport ${v} outside 240–3840 x 240–4000`),
        ]);
      viewports.push(vp);
    }
    const url = withScheme(input.url);
    const violation = await createPolicy({ allowPrivateNetworks: config.allowPrivateNetworks }).check(
      url,
      false,
    );
    if (violation) throw new HttpError(400, violation.message, [violation]);
    if ([...jobs.values()].some((j) => j.client === who && (j.status === "queued" || j.status === "running")))
      throw new HttpError(429, "you already have a capture in progress");
    if (running >= config.maxRunning && queue.length >= config.maxQueued)
      throw new HttpError(429, "the service is busy, try again in a minute");
    rateLimit(who);

    const job: Job = {
      id: randomUUID(),
      client: who,
      host: new URL(url).host,
      status: "queued",
      progress: 0,
      diagnostics: [],
      controller: new AbortController(),
      start: () => void run(job),
    };
    const run = async (j: Job) => {
      running++;
      j.status = "running";
      const t0 = Date.now();
      try {
        const result = await execute({
          urls: [url],
          viewports,
          hosted: true,
          allowPrivateNetworks: config.allowPrivateNetworks,
          signal: j.controller.signal,
          ...(input.click?.length ? { clickSelectors: input.click } : {}),
          ...(input.waitFor?.length ? { waitForSelectors: input.waitFor } : {}),
          ...(input.extraSettleMs !== undefined ? { extraSettleMs: input.extraSettleMs } : {}),
          onProgress: (done, total) => {
            j.progress = total === 0 ? 0 : done / total;
          },
        });
        if (j.controller.signal.aborted) j.status = "cancelled";
        else if (!result.ok) {
          j.status = "failed";
          j.diagnostics = result.diagnostics;
        } else {
          const json = JSON.stringify(result.value);
          if (json.length > config.maxBundleBytes) {
            j.status = "failed";
            j.diagnostics = [
              diag(
                "PAGE_TOO_LARGE",
                `the capture is ${(json.length / 1048576).toFixed(0)} MB, over the ${(config.maxBundleBytes / 1048576).toFixed(0)} MB limit; try one viewport or a shorter page`,
              ),
            ];
          } else {
            j.bundle = gzipSync(json);
            j.bundleBytes = json.length;
            j.diagnostics = result.value.ir.diagnostics.filter((d) => d.severity !== "info");
            j.status = "done";
            j.progress = 1;
          }
        }
      } catch (e) {
        j.status = "failed";
        j.diagnostics = [diag("NAVIGATION_FAILED", "the capture failed unexpectedly")];
        log({
          level: "error",
          msg: "capture crashed",
          job: j.id,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        running--;
        j.finishedAt = Date.now();
        log({
          msg: "job",
          job: j.id,
          host: j.host,
          viewports: viewports.length,
          status: j.status,
          ms: Date.now() - t0,
          bytes: j.bundleBytes,
        });
        pump();
      }
    };
    jobs.set(job.id, job);
    queue.push(job);
    pump();
    return job;
  }

  const view = (j: Job) => ({
    id: j.id,
    status: j.status,
    progress: j.progress,
    ...(j.status === "queued" ? { position: queue.indexOf(j) + 1 } : {}),
    ...(j.bundleBytes !== undefined ? { bundleBytes: j.bundleBytes } : {}),
    diagnostics: j.diagnostics,
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<number> {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return 204;
    }
    if (path === "/healthz" && req.method === "GET") {
      send(res, 200, { ok: true, running, queued: queue.length });
      return 200;
    }
    if (path === "/api/captures" && req.method === "POST") {
      const job = await create(req);
      send(res, 202, view(job));
      return 202;
    }
    const m = /^\/api\/captures\/([0-9a-f-]{36})(\/bundle)?$/.exec(path);
    if (!m) throw new HttpError(404, "not found");
    client(req); // auth
    sweep();
    const job = jobs.get(m[1] ?? "");
    if (!job) throw new HttpError(404, "unknown or expired capture");
    if (m[2] && req.method === "GET") {
      if (job.status !== "done" || !job.bundle) throw new HttpError(409, `capture is ${job.status}`);
      const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
      const body = gzip ? job.bundle : gunzipSync(job.bundle);
      res.writeHead(200, {
        ...CORS,
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-bundle-bytes": String(job.bundleBytes ?? body.length),
        ...(gzip ? { "content-encoding": "gzip" } : {}),
        "content-length": String(body.length),
      });
      res.end(body);
      return 200;
    }
    if (!m[2] && req.method === "GET") {
      send(res, 200, view(job));
      return 200;
    }
    if (!m[2] && req.method === "DELETE") {
      if (job.status === "queued") {
        queue.splice(queue.indexOf(job), 1);
        job.status = "cancelled";
        job.finishedAt = Date.now();
      } else if (job.status === "running") job.controller.abort();
      send(res, 200, view(job));
      return 200;
    }
    throw new HttpError(405, "method not allowed");
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const t0 = Date.now();
    let status = 500;
    try {
      status = await route(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        send(
          res,
          e.status,
          { error: e.message, ...(e.diagnostics ? { diagnostics: e.diagnostics } : {}) },
          e.status === 429 ? { "retry-after": "60" } : {},
        );
      } else {
        log({ level: "error", msg: "request failed", error: e instanceof Error ? e.message : String(e) });
        if (!res.headersSent) send(res, 500, { error: "internal error" });
      }
    }
    // Paths only: never query strings or bodies (they can carry URLs and tokens).
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/[0-9a-f-]{36}/, ":id");
    if (path !== "/healthz") log({ msg: "request", method: req.method, path, status, ms: Date.now() - t0 });
  }

  /** Cancel everything (shutdown). */
  function abortAll() {
    for (const j of queue.splice(0)) j.status = "cancelled";
    for (const j of jobs.values()) if (j.status === "running") j.controller.abort();
  }

  return { handle, abortAll, sweep, stats: () => ({ running, queued: queue.length, jobs: jobs.size }) };
}
