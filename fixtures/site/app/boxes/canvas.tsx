"use client";
import { useEffect, useRef } from "react";

/** A canvas has no DOM to rebuild from, so it must arrive as a raster island. */
export function Chart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#e0e7ff";
    ctx.fillRect(0, 0, 160, 80);
    ctx.fillStyle = "#4f46e5";
    for (const [i, h] of [30, 55, 40, 70, 50].entries()) ctx.fillRect(10 + i * 30, 80 - h, 20, h);
  }, []);
  return <canvas ref={ref} data-testid="chart" width={160} height={80} />;
}
