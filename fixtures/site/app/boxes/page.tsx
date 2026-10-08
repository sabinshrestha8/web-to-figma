import { Chart } from "./canvas.tsx";

export const metadata = { title: "Boxes" };

/** One cell per box feature; each testid is asserted in capture.int.test.ts. */
function Cell({
  id,
  className = "",
  style,
  children,
}: {
  id: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div data-testid={id} className={`h-24 w-40 ${className}`} style={style}>
      {children}
    </div>
  );
}

export default function Boxes() {
  return (
    <main className="grid grid-cols-6 gap-8 bg-white p-10">
      {/* borders */}
      <Cell id="border-uniform" className="rounded-xl border-2 border-indigo-500" />
      <Cell id="border-sides" className="border-b-4 border-l border-b-rose-500 border-l-slate-400" />
      <Cell id="border-dashed" className="rounded-lg border-2 border-dashed border-slate-400" />
      <Cell id="pill" className="rounded-full bg-emerald-500" />
      <Cell id="ellipse" className="rounded-[50%] bg-amber-400" />
      <Cell id="corners" className="rounded-tl-3xl rounded-br-lg bg-sky-500" />

      {/* shadows */}
      <Cell id="shadow" className="rounded-lg bg-white shadow-lg" />
      <Cell id="shadow-inset" className="rounded-lg bg-slate-100 shadow-inner" />
      <Cell id="ring" className="rounded-lg bg-white ring-2 ring-indigo-500 ring-offset-2" />
      <Cell
        id="shadow-multi"
        className="rounded-lg bg-white"
        style={{ boxShadow: "0 1px 2px rgb(0 0 0 / 0.2), 0 8px 24px -4px rgb(79 70 229 / 0.4)" }}
      />
      <Cell id="opacity" className="bg-indigo-600 opacity-50" />
      <Cell id="blend" className="bg-rose-500 mix-blend-multiply" />

      {/* gradients */}
      <Cell id="linear" className="rounded-lg bg-linear-to-r from-indigo-500 to-pink-500" />
      <Cell
        id="linear-corner"
        className="rounded-lg bg-linear-to-br from-amber-300 via-rose-400 to-violet-600"
      />
      <Cell
        id="linear-angle"
        className="rounded-lg"
        style={{
          backgroundImage: "linear-gradient(30deg, #0ea5e9 0%, #0ea5e9 40%, #22c55e 60%, #22c55e 100%)",
        }}
      />
      <Cell
        id="radial"
        className="rounded-lg"
        style={{ backgroundImage: "radial-gradient(circle at 30% 30%, #fde68a, #f97316 60%, #7c2d12)" }}
      />
      <Cell
        id="dots"
        className="rounded-lg bg-slate-50"
        style={{
          backgroundImage: "radial-gradient(#94a3b8 1.5px, transparent 1.5px)",
          backgroundSize: "16px 16px",
        }}
      />
      <Cell
        id="layers"
        className="rounded-lg bg-slate-900"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, transparent, rgb(0 0 0 / 0.6)), linear-gradient(to right, #6366f1, #06b6d4)",
        }}
      />

      {/* transforms, clip, effects */}
      <Cell id="rotated" className="rotate-12 rounded-md bg-violet-500" />
      <Cell id="clip" className="relative overflow-hidden rounded-xl bg-slate-200">
        <div
          data-testid="clip-child"
          className="absolute -right-6 -bottom-6 size-20 rounded-full bg-indigo-500"
        />
      </Cell>
      <Cell id="blur" className="rounded-lg bg-pink-400 blur-sm" />
      <Cell
        id="backdrop"
        className="relative overflow-hidden rounded-lg bg-linear-to-r from-cyan-400 to-blue-600"
      >
        <div data-testid="glass" className="absolute inset-3 rounded-md bg-white/30 backdrop-blur-md" />
      </Cell>
      <Cell id="stack" className="relative">
        <div data-testid="z-top" className="absolute top-0 left-0 z-10 size-16 rounded bg-rose-500" />
        <div data-testid="z-bottom" className="absolute top-6 left-6 size-16 rounded bg-indigo-500" />
      </Cell>
      <Cell id="islands" className="flex items-center gap-3">
        {/* biome-ignore lint/performance/noImgElement: a plain <img>, decoded to an image fill */}
        <img data-testid="img" src="/badge.svg" alt="" width={40} height={40} />
        <svg data-testid="svg" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <rect x="4" y="4" width="32" height="32" rx="8" fill="#10b981" />
        </svg>
        <input data-testid="checkbox" type="checkbox" defaultChecked />
      </Cell>
      <Chart />
    </main>
  );
}
