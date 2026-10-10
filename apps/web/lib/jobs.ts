import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ConvertJob, convertUrls, type Viewport } from "@w2f/capture";
import type { Bundle, Capture, Diagnostic, Node, Result } from "@w2f/ir";
import { dataDir } from "./sweep.ts";

export { dataDir, sweepJobs } from "./sweep.ts";
export const MAX_JOBS = 2;

export type JobState = "queued" | "running" | "done" | "failed";
export type JobStage = "queued" | "capturing" | "done" | "failed";

export interface CaptureSummary {
  id: string;
  url: string;
  viewport: Viewport;
  irNodes: number;
  assets: number;
  fonts: string[];
  screenshot: string | null;
}

export interface JobStatus {
  id: string;
  status: JobState;
  stage: JobStage;
  /** Captures finished / captures total. */
  progress: number;
  captures: CaptureSummary[];
  diagnostics: Diagnostic[];
}

export interface NormalizedInput {
  urls: string[];
  viewports: Viewport[];
  waitForSelectors?: string[];
  extraSettleMs?: number;
}

interface JobRecord extends JobStatus {
  input: NormalizedInput;
}

const walk = (n: Node): Node[] => [n, ...(n.type === "box" ? n.children.flatMap(walk) : [])];

/** What the results table shows per capture: sizes, fonts and the reference shot. */
export function summarize(capture: Capture): CaptureSummary {
  const nodes = walk(capture.root);
  const assets = new Set<string>();
  const fonts = new Set<string>();
  for (const n of nodes) {
    if (n.type === "text") for (const r of n.runs) for (const f of r.style.families) fonts.add(f);
    else if (n.type === "vector" && n.fallback) assets.add(n.fallback);
    else if (n.type === "box") for (const p of n.fills) if (p.type === "image") assets.add(p.assetId);
  }
  if (capture.screenshot) assets.add(capture.screenshot);
  return {
    id: capture.id,
    url: capture.url,
    viewport: capture.viewport,
    irNodes: nodes.length,
    assets: assets.size,
    fonts: [...fonts].sort(),
    screenshot: capture.screenshot ?? null,
  };
}

export type Execute = (job: ConvertJob) => Promise<Result<Bundle>>;
export interface Store {
  create: (input: NormalizedInput) => JobRecord | null;
  get: (id: string) => JobRecord | undefined;
}

/** In-memory jobs (lost on restart; artifacts survive under dataDir until the sweep). */
export function createStore(execute: Execute = convertUrls): Store {
  const jobs = new Map<string, JobRecord>();
  return {
    create(input) {
      const active = [...jobs.values()].filter((j) => j.status === "queued" || j.status === "running");
      if (active.length >= MAX_JOBS) return null;
      const total = input.urls.length * input.viewports.length;
      const rec: JobRecord = {
        id: randomUUID(),
        input,
        status: "queued",
        stage: "queued",
        progress: 0,
        captures: [],
        diagnostics: [],
      };
      // Mkdir first: a throw here must not leave a record occupying a 429 slot forever.
      mkdirSync(join(dataDir(), rec.id), { recursive: true });
      jobs.set(rec.id, rec);
      void run(rec, input, execute, total);
      return rec;
    },
    get: (id) => jobs.get(id),
  };
}

/** The server's store (module singleton, one per process). */
export const store = createStore();

async function run(rec: JobRecord, input: NormalizedInput, execute: Execute, total: number): Promise<void> {
  try {
    rec.status = "running";
    rec.stage = "capturing";
    const result = await execute({
      urls: input.urls,
      viewports: input.viewports,
      ...(input.waitForSelectors === undefined ? {} : { waitForSelectors: input.waitForSelectors }),
      ...(input.extraSettleMs === undefined ? {} : { extraSettleMs: input.extraSettleMs }),
      onProgress: (done) => {
        rec.progress = total === 0 ? 1 : done / total;
      },
    });
    if (!result.ok) {
      rec.status = "failed";
      rec.stage = "failed";
      rec.diagnostics = result.diagnostics;
      return;
    }
    writeFileSync(join(dataDir(), rec.id, "bundle.json"), JSON.stringify(result.value));
    rec.captures = result.value.ir.captures.map(summarize);
    rec.diagnostics = result.value.ir.diagnostics;
    rec.status = "done";
    rec.stage = "done";
    rec.progress = 1;
  } catch (e) {
    // Unreachable through convertUrls (it returns Results); fail loudly rather than stick at running.
    console.error(
      `job ${rec.id} crashed:`,
      JSON.stringify((e as { errors?: unknown }).errors ?? String(e)).slice(0, 2000),
    );
    rec.status = "failed";
    rec.stage = "failed";
  }
}

/** This job's bundle, or null when it isn't done (or the id is unknown). */
export function readBundle(id: string): Bundle | null {
  try {
    return JSON.parse(readFileSync(join(dataDir(), id, "bundle.json"), "utf8")) as Bundle;
  } catch {
    return null;
  }
}
