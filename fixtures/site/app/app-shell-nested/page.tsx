const ROWS = Array.from({ length: 20 }, (_, i) => `Card row ${i + 1}`);

/**
 * App shell with nested scrollers (as in MUI admin dashboards): `<main>` scrolls only the summary
 * above a full-height panel, and the panel scrolls the cards. Growing `<main>` grows the panel too,
 * so `<main>` never stops hiding the summary's height.
 */
export default function AppShellNested() {
  return (
    <div className="fixed inset-0 flex flex-col pl-56">
      <nav className="fixed inset-y-0 left-0 w-56 bg-slate-100 p-4">Sidebar</nav>
      <header className="h-14 shrink-0 bg-slate-900 px-6 py-4 text-white">Admin</header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="h-72 bg-sky-50 p-6">Summary</div>
        <div className="h-full overflow-y-auto p-6">
          {ROWS.map((row) => (
            <section key={row} className="mb-4 h-24 rounded-lg border border-slate-200 p-4">
              {row}
            </section>
          ))}
          <p>End of cards</p>
        </div>
      </main>
    </div>
  );
}
