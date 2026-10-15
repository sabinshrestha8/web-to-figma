"use client";
import { useEffect, useRef, useState } from "react";
import SimpleBar from "simplebar-react";

const CARDS = Array.from({ length: 12 }, (_, i) => `Card ${i + 1}`);
const LATE = ["Card 13", "Card 14", "Card 15"];

export function Panel() {
  const ref = useRef<HTMLDivElement>(null);
  const [late, setLate] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLate(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <SimpleBar style={{ height: "100%" }}>
      <div className="h-56 bg-sky-50 p-6">
        Summary
        {/* Drawn in CSS px, with no viewBox: under zoom, smaller on screen than its user space. */}
        <svg width="40" height="20" aria-label="bar">
          <rect width="40" height="20" fill="teal" />
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-4 pt-4">
        {[...CARDS, ...(late ? LATE : [])].map((card) => (
          <section key={card} className="flex h-[400px] flex-col overflow-hidden rounded-lg border p-4">
            {card}
          </section>
        ))}
      </div>
      <div ref={ref} className="h-px" />
      <p>End of dashboard</p>
    </SimpleBar>
  );
}
