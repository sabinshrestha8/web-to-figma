// A page whose JS never yields: the capture must give up with TIMEOUT, not hang forever.
export function GET() {
  const html =
    "<!doctype html><html><body><main><h1>Loading&hellip;</h1></main>" +
    "<script>while (true) {}</script></body></html>";
  return new Response(html, { headers: { "content-type": "text/html" } });
}
