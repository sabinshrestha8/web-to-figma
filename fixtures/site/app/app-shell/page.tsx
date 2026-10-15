import { LoadMore } from "./more";

const ROWS = Array.from({ length: 24 }, (_, i) => `Report row ${i + 1}`);

/**
 * Dashboard-style shell: the document never scrolls, `<main>` does (like MUI/admin templates), and the
 * sidebar is fixed to the window's height.
 */
export default function AppShell() {
  return (
    <div className="fixed inset-0 flex flex-col pl-56">
      <nav className="fixed inset-y-0 left-0 w-56 bg-slate-100 p-4">Sidebar</nav>
      <header className="h-14 shrink-0 bg-slate-900 px-6 py-4 text-white">Admin</header>
      <div className="flex min-h-0 flex-1">
        <main className="flex-1 overflow-y-auto p-6">
          {ROWS.map((row) => (
            <section key={row} className="mb-4 h-24 rounded-lg border border-slate-200 p-4">
              {row}
            </section>
          ))}
          <LoadMore />
          <p>End of report</p>
        </main>
      </div>
    </div>
  );
}
