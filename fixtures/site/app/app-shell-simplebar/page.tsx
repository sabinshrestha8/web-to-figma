import "simplebar-react/dist/simplebar.min.css";
import { Panel } from "./panel";
import { Shell } from "./shell";

/**
 * Like the MUI admin dashboard it was reported on: a window-tall shell that resets its own height from
 * script, a padded box holding a title row over a flex-1 column, and the content scrolling inside
 * SimpleBar (which sets its own heights too) in a grid of fixed-height cards, the last of them
 * rendered once scrolled into view.
 */
export default function AppShellSimplebar() {
  return (
    <Shell>
      <header className="h-14 shrink-0 bg-slate-900 px-6 py-4 text-white">Admin</header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav className="w-20 shrink-0 bg-slate-100 p-4">Nav</nav>
        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="h-full overflow-hidden p-4">
            <div className="flex h-full flex-col">
              <h1 className="h-12 shrink-0 text-xl">Employer Dashboard</h1>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Panel />
              </div>
            </div>
          </div>
        </main>
      </div>
    </Shell>
  );
}
