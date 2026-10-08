const ROWS = Array.from({ length: 24 }, (_, i) => `Report row ${i + 1}`);

/** Dashboard-style shell: the document never scrolls, `<main>` does (like MUI/admin templates). */
export default function AppShell() {
  return (
    <div className="fixed inset-0 flex flex-col">
      <header className="h-14 shrink-0 bg-slate-900 px-6 py-4 text-white">Admin</header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 bg-slate-100 p-4">Sidebar</nav>
        <main className="flex-1 overflow-y-auto p-6">
          {ROWS.map((row) => (
            <section key={row} className="mb-4 h-24 rounded-lg border border-slate-200 p-4">
              {row}
            </section>
          ))}
          <p>End of report</p>
        </main>
      </div>
    </div>
  );
}
