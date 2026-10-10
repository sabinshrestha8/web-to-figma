import { deleteSession, getSession } from "../../../lib/api.ts";
import { loginStore } from "../../../lib/session.ts";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getSession(req, loginStore);
}

export async function DELETE(req: Request): Promise<Response> {
  return deleteSession(req, loginStore);
}
