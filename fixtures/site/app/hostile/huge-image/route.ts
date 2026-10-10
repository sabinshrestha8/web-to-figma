// A page showing one image whose bytes (12 MB) are over the 10 MB asset limit:
// its bytes are dropped, so the capture reports ASSET_REJECTED and draws a placeholder.
export function GET() {
  const html =
    "<!doctype html><html><body><main>" +
    '<img src="/hostile/huge-image/bytes" width="2000" height="2000" alt="oversize">' +
    "</main></body></html>";
  return new Response(html, { headers: { "content-type": "text/html" } });
}
