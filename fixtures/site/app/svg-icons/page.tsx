export const metadata = { title: "SVG icons" };

/** Lucide-style stroke icons that take their color from the text color (currentColor). */
function Icon({ id, d, className }: { id: string; d: string; className: string }) {
  return (
    <svg
      data-testid={id}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

const HOME = "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z";
const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";
const CHECK = "M20 6 9 17l-5-5";
const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z";

// Hostile markup, inserted as HTML: none of it may survive into the IR.
const HOSTILE = `<svg data-testid="hostile" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" onload="window.__w2fPwned=1">
<script>window.__w2fPwned=1</script>
<style>#hostile-dot{fill:#0ea5e9}</style>
<foreignObject width="48" height="48"><div xmlns="http://www.w3.org/1999/xhtml">html inside svg</div></foreignObject>
<image href="http://127.0.0.1:9/tracker.png" width="10" height="10"/>
<a href="javascript:alert(1)"><circle id="hostile-dot" cx="24" cy="24" r="20" onclick="alert(1)"/></a>
<animate attributeName="r" from="10" to="20" dur="1s"/>
</svg>`;

export default function SvgIcons() {
  return (
    <main className="bg-white p-10">
      {/* A sprite sheet: hidden, referenced by <use>. */}
      <svg style={{ display: "none" }} aria-hidden="true">
        <symbol id="i-star" viewBox="0 0 24 24">
          <path d={STAR} fill="currentColor" />
        </symbol>
      </svg>

      <h1 className="mb-8 text-2xl font-bold text-slate-900">SVG icons</h1>
      <section className="flex items-center gap-10">
        <Icon id="icon-home" d={HOME} className="size-8 text-indigo-600" />
        <Icon id="icon-bell" d={BELL} className="size-8 text-rose-600" />
        <Icon id="icon-check" d={CHECK} className="size-12 text-emerald-500 [stroke-width:3]" />
        <svg data-testid="icon-sprite" aria-hidden="true" className="size-10 text-amber-400">
          <use href="#i-star" />
        </svg>
        <svg
          data-testid="icon-filled"
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-10 fill-sky-500"
        >
          <circle cx="12" cy="12" r="10" />
          <path d={CHECK} className="fill-none stroke-white" strokeWidth="2.5" />
          <rect className="hidden" width="24" height="24" fill="red" />
        </svg>
        <svg data-testid="icon-gradient" aria-hidden="true" viewBox="0 0 48 48" className="size-12">
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="[stop-color:var(--color-violet-500)]" />
              <stop offset="1" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <rect width="48" height="48" rx="12" fill="url(#grad)" />
        </svg>
        <svg
          data-testid="icon-text"
          aria-hidden="true"
          viewBox="0 0 64 32"
          className="h-8 w-16 text-slate-700"
        >
          <text x="0" y="24" fontSize="20" fontWeight="700" fill="currentColor">
            SVG
          </text>
        </svg>
        {/* Geometry set from CSS, the way MUI X Charts draws its bars: no x/y/width/height attributes. */}
        <svg data-testid="icon-css-geometry" aria-hidden="true" viewBox="0 0 24 24" className="size-10">
          <rect style={{ x: 2, y: 10, width: 6, height: 12 }} fill="#6366f1" />
          <rect style={{ x: 10, y: 4, width: 6, height: 18, rx: 1 }} fill="#22c55e" />
          <circle style={{ cx: 20, cy: 5, r: 3 }} fill="#f59e0b" />
          {/* Positioned by CSS transforms, also like MUI X Charts bars. */}
          <rect style={{ width: 4, height: 4, transform: "translate(18px, 16px)" }} fill="#ef4444" />
          <rect
            style={{
              width: 4,
              height: 4,
              transformBox: "fill-box",
              transformOrigin: "center",
              transform: "scale(0.5)",
            }}
            fill="#0ea5e9"
          />
          {/* Two-line label offset in em, like the MUI X Charts donut's center label. */}
          <text x="12" y="12" fontSize="10" fill="#111827" textAnchor="middle">
            <tspan x="12" dy="-0.5em">
              a
            </tspan>
            <tspan x="12" dy="1em" fontSize="20">
              b
            </tspan>
          </text>
        </svg>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: hostile markup the sanitizer must strip */}
        <span dangerouslySetInnerHTML={{ __html: HOSTILE }} />
      </section>

      <p className="mt-10 flex items-center gap-2 text-lg text-slate-700">
        <Icon id="icon-inline" d={BELL} className="size-5" />
        An icon inline with text
      </p>
    </main>
  );
}
