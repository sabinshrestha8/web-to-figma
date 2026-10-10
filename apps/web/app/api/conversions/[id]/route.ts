import { getConversion } from "../../../../lib/api.ts";
import { store } from "../../../../lib/jobs.ts";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return getConversion(req, store, (await ctx.params).id);
}
