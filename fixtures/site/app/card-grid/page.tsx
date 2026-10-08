export const metadata = { title: "Card grid" };

const CARDS = [
  {
    title: "Analytics",
    body: "Track usage across every workspace in real time.",
    tag: "New",
    from: "from-indigo-500",
    to: "to-sky-400",
  },
  {
    title: "Billing",
    body: "Invoices, receipts and plan changes in one place.",
    tag: "Beta",
    from: "from-rose-500",
    to: "to-orange-400",
  },
  {
    title: "Security",
    body: "SSO, audit logs and fine-grained roles for teams.",
    tag: "Pro",
    from: "from-emerald-500",
    to: "to-teal-400",
  },
  {
    title: "Integrations",
    body: "Connect the tools your team already relies on.",
    tag: "New",
    from: "from-violet-500",
    to: "to-fuchsia-400",
  },
  {
    title: "Automation",
    body: "Schedule jobs and react to events without code.",
    tag: "Beta",
    from: "from-amber-500",
    to: "to-yellow-300",
  },
  {
    title: "Support",
    body: "Talk to a human within the hour, every day.",
    tag: "24/7",
    from: "from-slate-700",
    to: "to-slate-500",
  },
];

export default function CardGrid() {
  return (
    <main className="min-h-screen bg-slate-50 px-10 py-16">
      <h1 className="text-3xl font-bold text-slate-900">Everything you need</h1>
      <p className="mt-2 text-slate-600">Six modules, one workspace.</p>
      <div className="mt-10 grid grid-cols-3 gap-6">
        {CARDS.map((c) => (
          <article
            key={c.title}
            data-testid="card"
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className={`h-28 bg-linear-to-br ${c.from} ${c.to}`} />
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">{c.title}</h2>
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
                  {c.tag}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{c.body}</p>
              <a
                href="#more"
                className="mt-4 inline-block rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-xs"
              >
                Open {c.title}
              </a>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
