"use client";
import { useEffect, useRef, useState } from "react";

const MORE = Array.from({ length: 6 }, (_, i) => `Loaded row ${i + 1}`);

/** Like dashboard widgets that render once scrolled into view: only after `<main>` shows its end. */
export function LoadMore() {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLoaded(true);
      },
      { root: el.closest("main") },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref}>
      {loaded &&
        MORE.map((row) => (
          <section key={row} className="mb-4 h-24 rounded-lg border border-slate-200 p-4">
            {row}
          </section>
        ))}
    </div>
  );
}
