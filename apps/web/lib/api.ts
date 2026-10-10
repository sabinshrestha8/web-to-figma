import { createPolicy, parseViewport } from "@w2f/capture";
import { diag } from "@w2f/ir";
import { z } from "zod";
import { guard } from "./guard.ts";
import { type JobStatus, type NormalizedInput, readBundle, type Store } from "./jobs.ts";

const viewportObject = z.object({
  width: z.number().int().min(240).max(3840),
  height: z.number().int().min(240).max(4000),
  dpr: z.union([z.literal(1), z.literal(2)]),
});

export const conversionInput = z.object({
  targets: z
    .array(z.object({ url: z.string().min(1).max(2000) }))
    .min(1)
    .max(10),
  viewports: z
    .array(
      z.union([viewportObject, z.string().regex(/^\d+x\d+(@[12])?$/, "expected e.g. 1440x900 or 390x844@2")]),
    )
    .min(1)
    .max(3),
  options: z
    .object({
      waitFor: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(10)]).optional(),
      extraSettleMs: z.number().int().min(0).max(5000).optional(),
    })
    .optional(),
});
export type ConversionInput = z.infer<typeof conversionInput>;

/** api.md's ranges, applied to string viewports after parsing. */
function normalize(input: ConversionInput): NormalizedInput | { error: string } {
  const viewports = [];
  for (const v of input.viewports) {
    if (typeof v === "string") {
      try {
        viewports.push(parseViewport(v));
      } catch {
        return { error: `bad viewport "${v}", expected e.g. 1440x900 or 390x844@2` };
      }
    } else viewports.push(v);
  }
  for (const v of viewports) {
    if (v.width < 240 || v.width > 3840 || v.height < 240 || v.height > 4000 || (v.dpr !== 1 && v.dpr !== 2))
      return { error: `viewport ${v.width}x${v.height}@${v.dpr} outside 240–3840 x 240–4000, dpr 1|2` };
  }
  const wait = input.options?.waitFor;
  return {
    urls: input.targets.map((t) => t.url),
    viewports,
    ...(wait === undefined ? {} : { waitForSelectors: typeof wait === "string" ? [wait] : wait }),
    ...(input.options?.extraSettleMs === undefined ? {} : { extraSettleMs: input.options.extraSettleMs }),
  };
}

const bad = (message: string) =>
  Response.json({ diagnostics: [diag("INVALID_INPUT", message)] }, { status: 400 });

/** POST /api/conversions → 202 {id} (queued), 400, 403 or 429. */
export async function postConversions(req: Request, store: Store): Promise<Response> {
  const blocked = guard(req);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("body is not JSON");
  }
  const parsed = conversionInput.safeParse(body);
  if (!parsed.success)
    return bad(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = normalize(parsed.data);
  if ("error" in input) return bad(input.error);
  const policy = createPolicy({ allowPrivateNetworks: true });
  for (const url of input.urls) {
    const violation = await policy.check(url, false);
    if (violation) return Response.json({ diagnostics: [violation] }, { status: 400 });
  }
  const job = store.create(input);
  if (!job) return Response.json({ error: "2 jobs already running" }, { status: 429 });
  return Response.json({ id: job.id }, { status: 202 });
}

const statusOf = (job: JobStatus) => ({
  id: job.id,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  captures: job.captures,
  diagnostics: job.diagnostics,
});

/** GET /api/conversions/:id → the job status (polled every 500 ms). */
export async function getConversion(req: Request, store: Store, id: string): Promise<Response> {
  const blocked = guard(req);
  if (blocked) return blocked;
  const job = store.get(id);
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(statusOf(job));
}

/** GET /api/conversions/:id/bundle → the .w2f.json bundle as an attachment. */
export async function getBundle(req: Request, _store: Store, id: string): Promise<Response> {
  const blocked = guard(req);
  if (blocked) return blocked;
  const bundle = readBundle(id);
  if (!bundle) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(JSON.stringify(bundle), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${id}.w2f.json"`,
    },
  });
}

/** GET /api/conversions/:id/captures/:cid/ir → the capture plus its asset URLs (for the preview). */
export async function getCaptureIR(req: Request, _store: Store, id: string, cid: string): Promise<Response> {
  const blocked = guard(req);
  if (blocked) return blocked;
  const bundle = readBundle(id);
  if (!bundle) return Response.json({ error: "not found" }, { status: 404 });
  const capture = bundle.ir.captures.find((c) => c.id === cid);
  if (!capture) return Response.json({ error: "not found" }, { status: 404 });
  const assetUrls: Record<string, string> = {};
  for (const assetId of Object.keys(bundle.ir.assets)) assetUrls[assetId] = assetUrl(id, assetId);
  return Response.json({ capture, assetUrls });
}

const assetUrl = (id: string, assetId: string) =>
  `/api/conversions/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`;

/** GET /api/conversions/:id/assets/:assetId → image bytes (screenshots, fills, fallbacks). */
export async function getAsset(req: Request, _store: Store, id: string, assetId: string): Promise<Response> {
  const blocked = guard(req);
  if (blocked) return blocked;
  const bundle = readBundle(id);
  const meta = bundle?.ir.assets[assetId];
  const base64 = bundle && meta ? (bundle.assetData[assetId] ?? null) : null;
  if (!meta || !base64) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(Buffer.from(base64, "base64"), {
    headers: { "content-type": meta.mime },
  });
}
