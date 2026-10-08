// Redirect into cloud metadata: the capture must refuse to follow it.
export function GET() {
  return Response.redirect("http://169.254.169.254/latest/meta-data/", 307);
}
