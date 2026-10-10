import { getCaptureIR } from "../../../../../../../lib/api.ts";
import { store } from "../../../../../../../lib/jobs.ts";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; cid: string }> },
): Promise<Response> {
  const { id, cid } = await ctx.params;
  return getCaptureIR(req, store, id, cid);
}
