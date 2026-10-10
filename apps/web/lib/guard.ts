/** Host/Origin guard (docs/security.md): the local app answers its own browser only. */
export const PORT = 4317;

const local = (host: string) => host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;

/** Null when the request passes; a 403 response otherwise (fail closed). */
export function guard(req: Request): Response | null {
  const host = req.headers.get("host") ?? "";
  if (!local(host)) return Response.json({ error: "forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!local(originHost)) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
