"use client";
import { type ReactNode, useEffect, useRef } from "react";

/** Keeps itself as tall as the window from script, as "100vh fix" hooks do, on every resize. */
export function Shell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      el.style.height = `${window.innerHeight}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex h-screen flex-col overflow-hidden">
      {children}
    </div>
  );
}
