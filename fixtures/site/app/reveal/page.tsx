"use client";
import { useEffect } from "react";

const SECTIONS = ["Features", "Pricing", "Testimonials", "Get in touch"];

/**
 * A landing page whose sections fade in on scrolling into view (as AOS does): until then they are
 * `opacity: 0`, so a capture that never scrolls finds only empty backgrounds below the hero.
 */
export default function Reveal() {
  useEffect(() => {
    const show = () => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]:not(.shown)"))
        if (el.getBoundingClientRect().top < window.innerHeight - 100) el.classList.add("shown");
    };
    window.addEventListener("scroll", show);
    show();
    return () => window.removeEventListener("scroll", show);
  }, []);
  return (
    <main>
      <style>
        {
          "[data-reveal]{opacity:0;transform:translateY(40px);transition:opacity .8s,transform .8s}[data-reveal].shown{opacity:1;transform:none}"
        }
      </style>
      <section className="flex h-screen items-center justify-center bg-slate-900 text-4xl text-white">
        Hero
      </section>
      {SECTIONS.map((s) => (
        <section key={s} className="h-[700px] bg-slate-50 p-12 odd:bg-white">
          <h2 data-reveal className="text-3xl">
            {s}
          </h2>
        </section>
      ))}
    </main>
  );
}
