export const metadata = { title: "Nav" };

/** Phase 6 layout: sticky header as a horizontal space-between stack, hero CTAs as a centered row. */
export default function Nav() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header
        data-testid="site-header"
        className="sticky top-0 flex items-center justify-between bg-slate-900 px-10 py-5"
      >
        <span data-testid="logo" className="text-xl font-bold text-white">
          Acme
        </span>
        <nav data-testid="site-nav" className="flex items-center gap-8 text-sm text-slate-300">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#docs">Docs</a>
          <a href="#start" className="rounded-md bg-indigo-500 px-4 py-2 font-semibold text-white">
            Get started
          </a>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-10 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Ship designs straight from your code</h1>
        <div data-testid="cta-row" className="mt-10 flex justify-center gap-4">
          <a href="#start" className="rounded-md bg-indigo-600 px-6 py-3 font-semibold text-white">
            Try it now
          </a>
          <a href="#docs" className="rounded-md bg-slate-100 px-6 py-3 font-semibold text-slate-900">
            Read the docs
          </a>
        </div>
        {/* A card header whose control is pushed right by ml-auto inside a clipping card */}
        <div className="mx-auto mt-16 max-w-md overflow-hidden rounded-xl border border-slate-200 text-left">
          <div data-testid="card-header" className="flex h-14 items-center px-5">
            <h2 className="truncate font-semibold">Clock In/Out</h2>
            <button type="button" className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-sm">
              Department
            </button>
          </div>
        </div>
        {/* The same header under CSS zoom: computed lengths are unzoomed, rects are zoomed */}
        <div
          style={{ zoom: 0.938 }}
          className="mx-auto mt-8 max-w-md overflow-hidden rounded-xl border text-left"
        >
          <div data-testid="zoomed-header" className="flex h-14 items-center justify-between gap-3 px-5">
            <h2 className="truncate font-semibold">Analytics</h2>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1 text-sm">
              Choose type
            </button>
          </div>
          <svg aria-label="zoomed-ring" width="40" height="40" viewBox="0 0 40 40" data-zoomed-transforms>
            <g transform="translate(20 20)">
              <circle r="18" fill="teal" />
            </g>
          </svg>
        </div>
        {/* Some Chrome versions report an SVG element's computed transform with the zoom applied. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed test shim, no user input
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const gcs = window.getComputedStyle;
  window.getComputedStyle = function (el, ...rest) {
    const cs = gcs.call(this, el, ...rest);
    if (!(el instanceof SVGElement) || !el.closest("[data-zoomed-transforms]")) return cs;
    return new Proxy(cs, {
      get(t, p) {
        if (p === "transform" && t.transform !== "none") {
          const m = new DOMMatrix(t.transform), z = el.currentCSSZoom;
          return "matrix(" + [m.a, m.b, m.c, m.d, m.e * z, m.f * z].join(", ") + ")";
        }
        const v = Reflect.get(t, p);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  };
})();`,
          }}
        />
      </main>
    </div>
  );
}
