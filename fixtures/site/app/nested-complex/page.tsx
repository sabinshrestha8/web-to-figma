export const metadata = { title: "Nested complex" };

/** Phase 8: deep nesting, margin-spaced blocks, absolute overlays and z-order. */
export default function NestedComplex() {
  return (
    <div className="min-h-screen bg-slate-100 p-10 text-slate-900">
      <main data-testid="nested-root" className="mx-auto max-w-2xl">
        <section className="rounded-xl bg-white p-6 shadow">
          <div className="rounded-lg bg-slate-50 p-4">
            <div data-testid="nested-inner" className="rounded-md bg-white p-4">
              <h1 className="text-2xl font-bold">Deeply nested</h1>
              <p className="mt-2 text-slate-600">Four levels of boxes, with margins between siblings.</p>
            </div>
            <p className="mt-4 text-sm text-slate-500">A margin-spaced sibling below the inner card.</p>
          </div>
        </section>
        <section data-testid="overlay-zone" className="relative mt-8 rounded-xl bg-white p-6 shadow">
          <div
            data-testid="overlay-backdrop"
            className="absolute inset-x-8 -bottom-3 top-8 -z-10 rounded-xl bg-indigo-200"
          />
          <h2 className="text-xl font-bold">Overlay zone</h2>
          <p className="mt-2 text-slate-600">The badge pins to the corner; the backdrop sits behind.</p>
          <span
            data-testid="overlay-badge"
            className="absolute top-3 right-3 z-20 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white"
          >
            New
          </span>
        </section>
      </main>
    </div>
  );
}
