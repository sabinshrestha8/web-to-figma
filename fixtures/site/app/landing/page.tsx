export const metadata = { title: "Landing" };

const FEATURES = [
  { title: "Real rendering", body: "Captured from headless Chromium, so what you see is what ships." },
  { title: "Editable layers", body: "Frames, text and fills you can actually change in Figma." },
  { title: "Honest output", body: "Every approximation is reported as a diagnostic, never hidden." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="flex items-center justify-between bg-slate-900 px-10 py-5">
        <span data-testid="logo" className="text-xl font-bold text-white">
          Acme
        </span>
        <nav className="flex items-center gap-8 text-sm text-slate-300">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#docs">Docs</a>
          <a href="#start" className="rounded-md bg-indigo-500 px-4 py-2 font-semibold text-white">
            Get started
          </a>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-10 py-24 text-center">
          <h1 data-testid="hero-title" className="text-5xl font-bold tracking-tight">
            Ship designs straight from your code
          </h1>
          <p data-testid="hero-body" className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Point the converter at a running page and get an editable Figma file back. No redrawing, no
            screenshots pasted into frames.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <a href="#start" className="rounded-md bg-indigo-600 px-6 py-3 font-semibold text-white">
              Try it now
            </a>
            <a href="#docs" className="rounded-md bg-slate-100 px-6 py-3 font-semibold text-slate-900">
              Read the docs
            </a>
          </div>
        </section>

        <section id="features" className="mx-auto grid max-w-5xl grid-cols-3 gap-6 px-10 pb-24">
          {FEATURES.map((f) => (
            <div key={f.title} data-testid="feature-card" className="rounded-lg bg-slate-50 p-6">
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="bg-slate-100 px-10 py-8 text-sm text-slate-500">© 2026 Acme. Fixture page.</footer>
    </div>
  );
}
