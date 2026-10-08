export const metadata = { title: "Form" };

/** Phase 6 layout: a vertical stack of labeled fields, an inline checkbox row, and actions. */
export default function Form() {
  return (
    <main className="min-h-screen bg-slate-50 px-10 py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Invite a teammate</h1>
        <p className="mt-1 text-sm text-slate-600">They get an email with a sign-in link.</p>
        <form data-testid="invite-form" className="mt-6 flex flex-col gap-5" action="#">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
            Full name
            <input
              type="text"
              placeholder="Ada Lovelace"
              className="rounded-md border border-slate-300 px-3 py-2 font-normal text-slate-900 placeholder:text-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              placeholder="ada@example.com"
              className="rounded-md border border-slate-300 px-3 py-2 font-normal text-slate-900 placeholder:text-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
            Team
            <select className="rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900">
              <option>Engineering</option>
              <option>Design</option>
            </select>
          </label>
          <label data-testid="notify-row" className="flex flex-row items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" defaultChecked className="h-4 w-4" />
            Notify them by email
          </label>
          <div data-testid="form-actions" className="flex justify-end gap-3">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Send invite
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
