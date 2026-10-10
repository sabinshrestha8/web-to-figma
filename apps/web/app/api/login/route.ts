import { postLogin } from "../../../lib/api.ts";
import { loginStore } from "../../../lib/session.ts";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return postLogin(req, loginStore);
}
