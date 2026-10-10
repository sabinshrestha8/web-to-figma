"use client";

import type { Capture, Diagnostic } from "@w2f/ir";
import { renderIRToHtml } from "@w2f/preview";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { CaptureSummary, JobStatus } from "../lib/jobs.ts";

interface Preview {
  html: string;
  shot: string | null;
  width: number;
  height: number;
}

export default function Home() {
  const [urls, setUrls] = useState("http://localhost:3000/");
  const [viewports, setViewports] = useState("1440x900, 390x844@2");
  const [waitFor, setWaitFor] = useState("");
  const [extraSettleMs, setExtraSettleMs] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [diagFilter, setDiagFilter] = useState("");
  const [severity, setSeverity] = useState("all");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => stop, [stop]);

  async function poll(id: string) {
    const r = await fetch(`/api/conversions/${encodeURIComponent(id)}`);
    if (!r.ok) {
      stop();
      setError("job not found (the server may have restarted)");
      return;
    }
    const s = (await r.json()) as JobStatus;
    setStatus(s);
    setCaptureId((cur) => cur ?? s.captures[0]?.id ?? null);
    if (s.status === "done" || s.status === "failed") stop();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    stop();
    setError(null);
    setStatus(null);
    setPreview(null);
    setCaptureId(null);
    const targets = urls
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map((url) => ({ url }));
    const vps = viewports
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const wait = waitFor
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const ms = extraSettleMs.trim() === "" ? undefined : Number(extraSettleMs);
    const r = await fetch("/api/conversions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targets,
        viewports: vps,
        options: {
          ...(wait.length > 0 ? { waitFor: wait } : {}),
          ...(ms === undefined ? {} : { extraSettleMs: ms }),
        },
      }),
    });
    if (r.status === 202) {
      const { id } = (await r.json()) as { id: string };
      setJobId(id);
      timer.current = setInterval(() => void poll(id), 500);
      await poll(id);
    } else if (r.status === 400) {
      const { diagnostics } = (await r.json()) as { diagnostics: Diagnostic[] };
      setError(diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
    } else if (r.status === 429) {
      setError("2 jobs already running — wait for one to finish.");
    } else {
      setError(`request failed (${r.status})`);
    }
  }

  useEffect(() => {
    if (jobId === null || captureId === null || status?.status !== "done") return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/conversions/${encodeURIComponent(jobId)}/captures/${encodeURIComponent(captureId)}/ir`,
        );
        if (!r.ok || cancelled) return;
        const { capture, assetUrls } = (await r.json()) as {
          capture: Capture;
          assetUrls: Record<string, string>;
        };
        if (!cancelled) {
          setPreview({
            html: renderIRToHtml(capture, assetUrls),
            shot: capture.screenshot ? (assetUrls[capture.screenshot] ?? null) : null,
            width: capture.viewport.width,
            height: capture.root.bounds.height,
          });
        }
      } catch {
        if (!cancelled) setError("could not load the preview");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, captureId, status?.status]);

  const selected: CaptureSummary | undefined = status?.captures.find((c) => c.id === captureId);
  const diags = (status?.diagnostics ?? []).filter(
    (d) =>
      (severity === "all" || d.severity === severity) &&
      (diagFilter.trim() === "" ||
        `${d.code} ${d.message}`.toLowerCase().includes(diagFilter.trim().toLowerCase())),
  );
  const irNodes = (status?.captures ?? []).reduce((n, c) => n + c.irNodes, 0);
  const assets = (status?.captures ?? []).reduce((n, c) => n + c.assets, 0);
  const fonts = [...new Set((status?.captures ?? []).flatMap((c) => c.fonts))].sort();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">Web to Figma</h1>
      <p className="mt-1 text-sm text-slate-600">
        Capture a page, review the IR preview, download the bundle for the Figma plugin.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 rounded-xl bg-white p-4 shadow">
        <label className="block text-sm font-semibold">
          URLs (one per line, up to 10)
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-sm"
          />
        </label>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-sm font-semibold">
            Viewports (up to 3)
            <input
              value={viewports}
              onChange={(e) => setViewports(e.target.value)}
              placeholder="1440x900, 390x844@2"
              className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-sm"
            />
          </label>
          <label className="block text-sm font-semibold">
            Wait for selector (optional)
            <input
              value={waitFor}
              onChange={(e) => setWaitFor(e.target.value)}
              placeholder="[data-loaded]"
              className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-sm"
            />
          </label>
          <label className="block text-sm font-semibold">
            Extra settle ms, 0–5000 (optional)
            <input
              value={extraSettleMs}
              onChange={(e) => setExtraSettleMs(e.target.value)}
              placeholder="0"
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-4 rounded-md bg-indigo-600 px-5 py-2 font-semibold text-white disabled:opacity-50"
          disabled={status?.status === "running" || status?.status === "queued"}
        >
          Capture
        </button>
      </form>

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {status && (
        <section className="mt-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">
              {status.status} · {status.stage}
            </span>
            <div className="h-2 flex-1 rounded bg-slate-200">
              <div
                className="h-2 rounded bg-indigo-600"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            {status.status === "done" && jobId && (
              <a
                href={`/api/conversions/${encodeURIComponent(jobId)}/bundle`}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Download bundle
              </a>
            )}
          </div>

          {status.captures.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {status.captures.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCaptureId(c.id)}
                  className={`rounded-md px-3 py-1 text-sm ${c.id === captureId ? "bg-indigo-600 text-white" : "bg-white shadow"}`}
                >
                  {c.url} · {c.viewport.width}×{c.viewport.height}
                </button>
              ))}
            </div>
          )}

          {selected && preview && (
            <div className="mt-4">
              <p className="text-sm text-slate-600">
                {selected.irNodes} IR nodes · {selected.assets} assets · fonts:{" "}
                {selected.fonts.join(", ") || "—"}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <figure className="overflow-auto rounded-xl bg-white p-2 shadow">
                  <figcaption className="p-2 text-sm font-semibold">Reference screenshot</figcaption>
                  {preview.shot && (
                    // biome-ignore lint/performance/noImgElement: a captured screenshot of unknown intrinsic size served from the local API; next/image buys nothing here
                    <img src={preview.shot} alt="reference screenshot" className="max-w-none" />
                  )}
                </figure>
                <figure className="overflow-auto rounded-xl bg-white p-2 shadow">
                  <figcaption className="p-2 text-sm font-semibold">IR preview</figcaption>
                  <iframe
                    title="IR preview"
                    srcDoc={preview.html}
                    width={preview.width}
                    height={preview.height}
                    className="max-w-none border-0"
                  />
                </figure>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-xl bg-white p-4 shadow">
            <h2 className="font-semibold">
              Diagnostics ({diags.length}
              {status.diagnostics.length !== diags.length ? ` of ${status.diagnostics.length}` : ""}) ·{" "}
              {irNodes} IR nodes · {assets} assets · {fonts.length} fonts
            </h2>
            <div className="mt-2 flex gap-2">
              <input
                value={diagFilter}
                onChange={(e) => setDiagFilter(e.target.value)}
                placeholder="filter…"
                className="w-full rounded-md border border-slate-300 p-2 text-sm"
              />
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="rounded-md border border-slate-300 p-2 text-sm"
              >
                {["all", "fatal", "error", "warning", "info"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <ul className="mt-2 max-h-96 overflow-auto font-mono text-xs">
              {diags.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no stable id
                <li key={i} className="border-b border-slate-100 py-1">
                  <span className="font-bold">
                    [{d.severity}] {d.code}
                  </span>{" "}
                  {d.message}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
