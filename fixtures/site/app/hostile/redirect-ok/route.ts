// Same-origin redirect: must be followed and captured.
export function GET(req: Request) {
  return Response.redirect(new URL("/landing", req.url), 307);
}
