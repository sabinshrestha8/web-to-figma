// A destination slower than the network-settle cap (5s), like a first-visit `next dev` compile.
export async function GET(req: Request) {
  await new Promise((r) => setTimeout(r, 6000));
  return Response.redirect(new URL("/landing", req.url), 307);
}
