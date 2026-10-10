"use client";

import { useEffect, useState } from "react";

/** Live content that differs on every load (a clock, a chart): drift's `ignore` fixture. */
export default function Live() {
  const [now, setNow] = useState("");
  const [bars, setBars] = useState<number[]>([]);
  useEffect(() => {
    setNow(new Date().toISOString());
    setBars(Array.from({ length: 6 }, () => 10 + Math.round(Math.random() * 90)));
  }, []);
  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold">Status</h1>
      <p className="mt-2 text-slate-600">
        Updated <time className="font-mono">{now}</time>
      </p>
      <div data-testid="chart" className="mt-6 flex h-32 w-96 items-end gap-2 bg-slate-100 p-2">
        {bars.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length fixture bars
          <div key={i} className="flex-1 bg-sky-500" style={{ height: `${h}%` }} />
        ))}
      </div>
      <p className="mt-6">Static footer text.</p>
    </main>
  );
}
