const ROWS = Array.from({ length: 20 }, (_, i) => `Panel row ${i + 1}`);

/**
 * App shell whose `<main>` hides a summary and a footer, while a window-height `overflow: hidden`
 * panel inside it clips the content (scrolled by script, as MUI dashboards do). It must grow too.
 */
export default function AppShellPanel() {
  return (
    <div className="fixed inset-0 flex flex-col pl-56">
      {/* A backdrop always taller than itself: growing it never shows more. */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="h-[calc(100%+200px)] bg-gradient-to-b from-white to-slate-50" />
      </div>
      <nav className="fixed inset-y-0 left-0 w-56 bg-slate-100 p-4">Sidebar</nav>
      <header className="h-14 shrink-0 bg-slate-900 px-6 py-4 text-white">Admin</header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="h-40 bg-sky-50 p-6">Summary</div>
        <div id="panel" className="h-[calc(100vh-3.5rem)] overflow-hidden p-6">
          {ROWS.map((row) => (
            <section key={row} className="mb-4 h-24 rounded-lg border border-slate-200 p-4">
              {row}
            </section>
          ))}
          <p>End of panel</p>
        </div>
        <footer className="h-10 bg-slate-200 px-6">Footer</footer>
      </main>
    </div>
  );
}
