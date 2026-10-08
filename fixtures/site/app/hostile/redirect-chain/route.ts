// Two hops: the second hop (into metadata) must be checked too, not just the first.
export function GET(req: Request) {
  return Response.redirect(new URL("/hostile/redirect-blocked", req.url), 307);
}
