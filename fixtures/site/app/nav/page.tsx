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
      </main>
    </div>
  );
}
