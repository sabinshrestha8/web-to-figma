import { getAsset } from "../../../../../../lib/api.ts";
import { store } from "../../../../../../lib/jobs.ts";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
): Promise<Response> {
  const { id, assetId } = await ctx.params;
  return getAsset(req, store, id, assetId);
}
