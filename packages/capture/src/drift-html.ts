import type { DriftEntry, DriftKind, DriftReport } from "@w2f/convert";
import type { HistoryRow, PageResult } from "./drift-run.ts";

/** Paths, details and URLs come from the captured page: always escaped. */
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

const KINDS: [DriftKind, string][] = [
  ["removed", "Removed"],
  ["added", "Added"],
  ["text-changed", "Text changed"],
  ["resized", "Resized"],
  ["moved", "Moved"],
  ["restyled", "Restyled"],
  ["layout-changed", "Layout changed"],
];
/** Crops per page; the rest are listed without images. */
const MAX_CROPS = 40;
const PAD = 8;

/** A window onto a screenshot (CSS px, page coordinates) with the node outlined. */
function crop(src: string, r: DriftEntry["before"], shot: PageResult["shot"], label: string): string {
  if (!r || !shot || r.y >= shot.height) return `<div class="crop none">not in screenshot</div>`;
  const x = Math.max(0, Math.floor(r.x - PAD));
  const y = Math.max(0, Math.floor(r.y - PAD));
  const w = Math.min(Math.ceil(r.width + 2 * PAD), 560);
  const h = Math.min(Math.ceil(r.height + 2 * PAD), 280);
  const box = `left:${r.x - x}px;top:${r.y - y}px;width:${r.width}px;height:${r.height}px`;
  return `<div class="crop" style="width:${w}px;height:${h}px;background-image:url('${esc(src)}');background-position:-${x}px -${y}px;background-size:${shot.width}px auto"><i style="${box}"></i><span>${label}</span></div>`;
}

function entries(report: DriftReport, page: PageResult, before: string | null, crops: { n: number }): string {
  const out: string[] = [];
  for (const [kind, title] of KINDS) {
    const group = report.entries.filter((e) => e.kind === kind);
    if (!group.length) continue;
    out.push(`<h4>${title} (${group.length})</h4><ul>`);
    for (const e of group) {
      let pics = "";
      if (crops.n < MAX_CROPS) {
        crops.n++;
        const b = before && e.before ? crop(`${page.name}/${before}`, e.before, page.shot, "baseline") : "";
        const a = e.after ? crop(`${page.name}/latest.png`, e.after, page.shot, "now") : "";
        pics = `<div class="pics">${b}${a}</div>`;
      }
      out.push(`<li><code>${esc(e.path)}</code> — ${esc(e.detail)}${pics}</li>`);
    }
    out.push("</ul>");
  }
  if (report.entries.length > MAX_CROPS)
    out.push(`<p class="muted">Crops shown for the first ${MAX_CROPS} changes.</p>`);
  return out.join("\n");
}

const BARS = "▁▂▃▄▅▆▇█";
/** Changes per run, oldest first: a text sparkline. */
function trend(rows: HistoryRow[]): string {
  const counts = rows.flatMap((r) => (r.changes === undefined ? [] : [r.changes])).slice(-30);
  if (counts.length < 2) return "";
  const max = Math.max(...counts, 1);
  const bars = counts.map((c) => BARS[Math.round((c / max) * (BARS.length - 1))]).join("");
  return `<span class="trend" title="changes per run, last ${counts.length}">${bars}</span>`;
}

function section(r: PageResult, history: HistoryRow[]): string {
  const changes = r.drift?.entries.length;
  const badge =
    r.status === "failed"
      ? `<b class="bad">failed</b>`
      : r.over.length
        ? `<b class="bad">over threshold</b>`
        : r.status === "compared"
          ? changes === 0
            ? `<b class="ok">no drift</b>`
            : `<b class="warn">${changes} change(s)</b>`
          : `<b class="muted">${r.status === "accepted" ? "baseline accepted" : "baseline set"}</b>`;
  const parts = [
    `<section id="${esc(r.name)}"><h2>${esc(r.name)} ${badge} ${trend(history.filter((h) => h.page === r.name))}</h2>`,
    `<p class="muted"><a href="${esc(r.url)}">${esc(r.url)}</a> · ${esc(r.viewport)}</p>`,
  ];
  if (r.error) parts.push(`<p class="bad">${esc(r.error)}</p>`);
  if (r.over.length) parts.push(`<p class="bad">Over threshold: ${esc(r.over.join("; "))}</p>`);
  if (r.diagnostics.length) {
    const codes = new Map<string, number>();
    for (const d of r.diagnostics) codes.set(d.code, (codes.get(d.code) ?? 0) + 1);
    const list = [...codes].map(([c, n]) => `${esc(c)}${n > 1 ? ` ×${n}` : ""}`).join(", ");
    parts.push(`<p class="muted">Capture diagnostics: ${list}</p>`);
  }
  if (r.drift) {
    parts.push(
      `<h3>Against baseline: ${r.drift.entries.length} change(s) across ${r.drift.compared} node(s), ${r.pixelPercent}% pixels differ <a href="${esc(r.name)}/diff.png">diff</a></h3>`,
    );
    parts.push(entries(r.drift, r, "baseline.png", { n: 0 }));
  }
  if (r.figma && "skipped" in r.figma) parts.push(`<h3>Figma: skipped (${esc(r.figma.skipped)})</h3>`);
  else if (r.figma) {
    parts.push(
      `<h3>Figma frame vs production: ${r.figma.entries.length} change(s) across ${r.figma.compared} node(s)</h3>`,
    );
    // The Figma side has no screenshot here: production crops only.
    parts.push(entries(r.figma, r, null, { n: 0 }));
  }
  parts.push("</section>");
  return parts.join("\n");
}

/** Self-contained report next to the page folders it references. */
export function renderDriftHtml(results: PageResult[], history: HistoryRow[], at: string): string {
  const failing = results.filter((r) => r.status === "failed" || r.over.length).length;
  const summary = results
    .map((r) => {
      const n = r.drift?.entries.length;
      return `<tr><td><a href="#${esc(r.name)}">${esc(r.name)}</a></td><td>${r.status}</td><td>${n ?? "–"}</td><td>${r.pixelPercent ?? "–"}${r.pixelPercent === undefined ? "" : "%"}</td><td>${r.figma && "entries" in r.figma ? r.figma.entries.length : "–"}</td><td>${r.over.length || r.error ? "✗" : "✓"}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drift report</title>
<style>
:root{--bg:#fff;--fg:#1b1b1f;--muted:#6b6b76;--line:#e3e3e8;--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e;--mark:#e5534b}
@media (prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#e8e8ec;--muted:#9a9aa5;--line:#2c2c33;--ok:#3fb950;--warn:#d29922;--bad:#f85149}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px 16px}
a{color:inherit}h2{margin-top:40px;border-top:1px solid var(--line);padding-top:24px}h4{margin:16px 0 4px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
code{font-size:12px;word-break:break-all}ul{padding-left:18px}li{margin:6px 0}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
.trend{font-size:13px;color:var(--muted);letter-spacing:1px}
.pics{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.crop{position:relative;overflow:hidden;border:1px solid var(--line);background-repeat:no-repeat;background-color:#fff;max-width:100%}
.crop i{position:absolute;outline:2px solid var(--mark);outline-offset:1px}
.crop span{position:absolute;right:0;top:0;font-size:11px;padding:1px 5px;background:var(--fg);color:var(--bg);opacity:.75}
.crop.none{padding:8px;font-size:12px;color:var(--muted);background:none}
</style></head><body>
<h1>Drift report</h1>
<p class="muted">${esc(at)} · ${results.length} page(s) · ${failing ? `<span class="bad">${failing} failing</span>` : `<span class="ok">all within thresholds</span>`}</p>
<table><thead><tr><th>Page</th><th>Status</th><th>Changes</th><th>Pixels</th><th>Figma</th><th>Gate</th></tr></thead><tbody>
${summary}
</tbody></table>
${results.map((r) => section(r, history)).join("\n")}
</body></html>
`;
}
