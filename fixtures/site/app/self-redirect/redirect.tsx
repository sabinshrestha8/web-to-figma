"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Mimics an auth guard: shortly after hydration the page sends you elsewhere. */
export function RedirectAfterLoad({ to, mode }: { to: string; mode: "hard" | "soft" }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => (mode === "hard" ? window.location.replace(to) : router.replace(to)), 200);
    return () => clearTimeout(t);
  }, [to, mode, router]);
  return <p className="p-8 text-slate-400">Checking session…</p>;
}
