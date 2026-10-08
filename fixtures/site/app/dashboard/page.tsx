export const metadata = { title: "Dashboard" };

const STATS = [
  { label: "Active users", value: "12,408" },
  { label: "Conversion", value: "3.2%" },
  { label: "Churn", value: "0.4%" },
];

/** Phase 6 layout: sidebar + main horizontal stack (main fills), stat cards row, chart canvas island. */
export default function Dashboard() {
  return (
    <div data-testid="shell" className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside
        data-testid="sidebar"
        className="flex w-60 flex-col gap-1 bg-slate-900 p-4 text-sm text-slate-300"
      >
        <span className="px-2 py-2 text-lg font-bold text-white">Acme</span>
        {["Overview", "Reports", "Settings"].map((item) => (
          <a key={item} href={`#${item}`} className="rounded-md px-2 py-2 hover:bg-slate-800">
            {item}
          </a>
        ))}
      </aside>
      <main data-testid="main" className="flex flex-1 flex-col gap-6 p-8">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div data-testid="stat-row" className="flex gap-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              data-testid="stat-card"
              className="flex-1 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-3xl font-bold">{s.value}</p>
              <p className="mt-1 text-sm text-slate-600">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Signups this week</h2>
          <canvas data-testid="chart" width={600} height={220} className="mt-3 w-full" />
        </div>
      </main>
    </div>
  );
}
