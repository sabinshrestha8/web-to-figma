import { getLogin } from "../../../../lib/api.ts";
import { loginStore } from "../../../../lib/session.ts";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return getLogin(req, loginStore, (await ctx.params).id);
}
