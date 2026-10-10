// 20k elements over the 15k collector limit: the capture must fail with PAGE_TOO_LARGE.
export function GET() {
  const html = `<!doctype html><html><body><main>${"<div>x</div>".repeat(20_000)}</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html" } });
}
