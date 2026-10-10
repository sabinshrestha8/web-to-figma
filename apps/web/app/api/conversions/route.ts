import { postConversions } from "../../../lib/api.ts";
import { store } from "../../../lib/jobs.ts";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return postConversions(req, store);
}
