export const metadata = { title: "Mobile" };

/** Phase 8: narrow-viewport page; blocks stack vertically at 390 px. */
export default function Mobile() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header data-testid="mobile-header" className="bg-slate-900 px-5 py-4">
        <span className="text-lg font-bold text-white">Acme</span>
      </header>
      <main className="px-5 py-8">
        <h1 className="text-3xl font-bold tracking-tight">Ship designs straight from your code</h1>
        <p className="mt-3 text-slate-600">Convert a rendered page into an editable Figma design.</p>
        <div data-testid="mobile-cards" className="mt-8 flex flex-col gap-4">
          {["Capture", "Convert", "Compare"].map((t) => (
            <article key={t} className="rounded-xl border border-slate-200 p-5 shadow-sm">
              <h2 className="font-semibold">{t}</h2>
              <p className="mt-1 text-sm text-slate-600">One step of the pipeline, as a full-width card.</p>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
