import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type DriftReport, diffCaptures } from "@w2f/convert";
import { type Bundle, type Diagnostic, parseBundle } from "@w2f/ir";
import { z } from "zod";
import { renderDriftHtml } from "./drift-html.ts";
import { fetchFigmaFrame } from "./figma-api.ts";
import { convertUrls, parseViewport } from "./run.ts";
import { loadStorageState } from "./storage-state.ts";
import { comparePngs } from "./visual.ts";

const Thresholds = {
  /** Fail when the node diff against the baseline has more changes than this. */
  maxChanges: z.number().int().min(0).optional(),
  /** Fail when more than this % of screenshot pixels differ from the baseline's. */
  maxPixelPercent: z.number().min(0).max(100).optional(),
  /** Fail when the Figma frame vs production diff has more changes than this. */
  maxFigmaChanges: z.number().int().min(0).optional(),
};

const Page = z.strictObject({
  /** Also the folder name under `out`, so path-safe. */
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "letters, digits, _ and -, at most 64"),
  url: z.url({ protocol: /^https?$/ }),
  viewport: z.string().default("1440x900"),
  /** Saved by `pnpm w2f:login`; relative to the config file. */
  storageState: z.string().optional(),
  waitFor: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  extraSettleMs: z.number().int().min(0).max(5000).optional(),
  figma: z.strictObject({ file: z.string().min(1), node: z.string().min(1) }).optional(),
  ...Thresholds,
});

export const DriftConfig = z
  .strictObject({
    /** Output folder, relative to the config file. */
    out: z.string().default("drift"),
    blockPrivate: z.boolean().default(false),
    ...Thresholds,
    pages: z.array(Page).min(1).max(50),
  })
  .refine((c) => new Set(c.pages.map((p) => p.name)).size === c.pages.length, "page names must be unique");
export type DriftConfig = z.infer<typeof DriftConfig>;

export function loadDriftConfig(path: string): DriftConfig {
  const parsed = DriftConfig.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`${path}: ${issues.join("; ")}`);
  }
  for (const p of parsed.data.pages) parseViewport(p.viewport);
  return parsed.data;
}

export interface PageResult {
  name: string;
  url: string;
  viewport: string;
  status: "baseline-set" | "accepted" | "compared" | "failed";
  error?: string;
  /** Warnings and errors of this run's capture (an expired login shows up here as PAGE_REDIRECTED). */
  diagnostics: Diagnostic[];
  drift?: DriftReport;
  pixelPercent?: number;
  figma?: DriftReport | { skipped: string };
  /** Thresholds this page went over. */
  over: string[];
  /** Screenshot size in CSS px, for crops. */
  shot?: { width: number; height: number };
}

export interface HistoryRow {
  at: string;
  page: string;
  status: PageResult["status"];
  changes?: number;
  pixelPercent?: number;
  figmaChanges?: number;
}

export interface DriftRunOptions {
  /** Make this run's captures the new baselines. */
  accept?: boolean;
  /** Only these page names. */
  only?: string[];
  figmaToken?: string;
  now?: Date;
  log?: (line: string) => void;
}

function readBundle(path: string): Bundle {
  const parsed = parseBundle(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
  return parsed.value;
}

function screenshot(bundle: Bundle): Buffer {
  const id = bundle.ir.captures[0]?.screenshot;
  const data = id && bundle.assetData[id];
  if (!data) throw new Error("capture has no reference screenshot");
  return Buffer.from(data, "base64");
}

async function runPage(
  page: DriftConfig["pages"][number],
  config: DriftConfig,
  dirs: { config: string; out: string },
  opts: DriftRunOptions,
): Promise<PageResult> {
  const result: PageResult = {
    name: page.name,
    url: page.url,
    viewport: page.viewport,
    status: "failed",
    diagnostics: [],
    over: [],
  };
  const dir = join(dirs.out, page.name);
  mkdirSync(dir, { recursive: true });
  const captured = await convertUrls({
    urls: [page.url],
    viewports: [parseViewport(page.viewport)],
    allowPrivateNetworks: !config.blockPrivate,
    ...(page.storageState ? { storageState: loadStorageState(resolve(dirs.config, page.storageState)) } : {}),
    ...(page.waitFor?.length ? { waitForSelectors: page.waitFor } : {}),
    ...(page.extraSettleMs !== undefined ? { extraSettleMs: page.extraSettleMs } : {}),
  });
  const diagnostics = captured.ok ? captured.value.ir.diagnostics : captured.diagnostics;
  result.diagnostics = diagnostics.filter((d) => d.severity !== "info");
  const cap = captured.ok ? captured.value.ir.captures[0] : undefined;
  if (!captured.ok || !cap) {
    result.error = result.diagnostics.map((d) => d.message).join("; ") || "capture failed";
    return result;
  }
  const latest = captured.value;
  const shot = screenshot(latest);
  result.shot = { width: cap.viewport.width, height: shot.readUInt32BE(20) / cap.viewport.dpr };
  writeFileSync(join(dir, "latest.w2f.json"), JSON.stringify(latest));
  writeFileSync(join(dir, "latest.png"), shot);

  const baselinePath = join(dir, "baseline.w2f.json");
  if (opts.accept || !existsSync(baselinePath)) {
    copyFileSync(join(dir, "latest.w2f.json"), baselinePath);
    copyFileSync(join(dir, "latest.png"), join(dir, "baseline.png"));
    result.status = opts.accept ? "accepted" : "baseline-set";
  } else {
    const baseline = readBundle(baselinePath);
    const base = baseline.ir.captures[0];
    if (!base) throw new Error(`${baselinePath}: no capture`);
    const v = (c: typeof base) => `${c.viewport.width}x${c.viewport.height}@${c.viewport.dpr}`;
    if (v(base) !== v(cap)) {
      result.error = `baseline is ${v(base)} but the page is now ${v(cap)}: rerun with --accept`;
      return result;
    }
    result.drift = diffCaptures(base.root, cap.root);
    const pixels = await comparePngs(screenshot(baseline), shot);
    writeFileSync(join(dir, "diff.png"), pixels.diff);
    result.pixelPercent = Math.round(pixels.mismatch * 10000) / 100;
    result.status = "compared";
  }

  if (page.figma) {
    if (!opts.figmaToken) result.figma = { skipped: "FIGMA_TOKEN is not set" };
    else {
      const frame = await fetchFigmaFrame(page.figma.file, page.figma.node, opts.figmaToken, cap.root.bounds);
      result.figma = diffCaptures(frame, cap.root);
    }
  }

  const max = (k: keyof typeof Thresholds) => page[k] ?? config[k];
  const changes = result.drift?.entries.length;
  const maxChanges = max("maxChanges");
  if (changes !== undefined && maxChanges !== undefined && changes > maxChanges)
    result.over.push(`${changes} changes > ${maxChanges}`);
  const maxPixels = max("maxPixelPercent");
  if (result.pixelPercent !== undefined && maxPixels !== undefined && result.pixelPercent > maxPixels)
    result.over.push(`${result.pixelPercent}% pixels > ${maxPixels}%`);
  const figmaChanges = result.figma && "entries" in result.figma ? result.figma.entries.length : undefined;
  const maxFigma = max("maxFigmaChanges");
  if (figmaChanges !== undefined && maxFigma !== undefined && figmaChanges > maxFigma)
    result.over.push(`${figmaChanges} Figma changes > ${maxFigma}`);
  return result;
}

/**
 * Capture every configured page, diff it against its baseline (and its Figma frame), append the
 * numbers to `history.jsonl` and write `report.html`. `ok` is false when a page failed or went
 * over a threshold: the CI gate.
 */
export async function runDrift(
  configPath: string,
  opts: DriftRunOptions = {},
): Promise<{ results: PageResult[]; reportPath: string; ok: boolean }> {
  const config = loadDriftConfig(configPath);
  const dirs = { config: dirname(resolve(configPath)), out: "" };
  dirs.out = resolve(dirs.config, config.out);
  mkdirSync(dirs.out, { recursive: true });
  const unknown = (opts.only ?? []).filter((n) => !config.pages.some((p) => p.name === n));
  if (unknown.length) throw new Error(`no page named ${unknown.join(", ")} in ${configPath}`);
  const pages = opts.only?.length ? config.pages.filter((p) => opts.only?.includes(p.name)) : config.pages;
  const at = (opts.now ?? new Date()).toISOString();

  const results: PageResult[] = [];
  for (const page of pages) {
    opts.log?.(`[${results.length + 1}/${pages.length}] ${page.name} ${page.url}`);
    let r: PageResult;
    try {
      r = await runPage(page, config, dirs, opts);
    } catch (e) {
      // One page's bad login file or Figma error must not hide the other pages' results.
      r = {
        name: page.name,
        url: page.url,
        viewport: page.viewport,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        diagnostics: [],
        over: [],
      };
    }
    results.push(r);
    const row: HistoryRow = {
      at,
      page: r.name,
      status: r.status,
      ...(r.drift ? { changes: r.drift.entries.length } : {}),
      ...(r.pixelPercent !== undefined ? { pixelPercent: r.pixelPercent } : {}),
      ...(r.figma && "entries" in r.figma ? { figmaChanges: r.figma.entries.length } : {}),
    };
    appendFileSync(join(dirs.out, "history.jsonl"), `${JSON.stringify(row)}\n`);
  }

  const history = readFileSync(join(dirs.out, "history.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as HistoryRow);
  const reportPath = join(dirs.out, "report.html");
  writeFileSync(reportPath, renderDriftHtml(results, history, at));
  return { results, reportPath, ok: results.every((r) => r.status !== "failed" && r.over.length === 0) };
}
