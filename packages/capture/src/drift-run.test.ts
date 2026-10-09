import type { DriftReport } from "@w2f/convert";
import { describe, expect, it } from "vitest";
import { renderDriftHtml } from "./drift-html.ts";
import { DriftConfig, type PageResult } from "./drift-run.ts";

describe("drift config", () => {
  it("fills defaults and rejects unsafe or duplicate names", () => {
    const ok = DriftConfig.parse({ pages: [{ name: "home", url: "http://localhost:3000/" }] });
    expect(ok).toMatchObject({ out: "drift", blockPrivate: false, pages: [{ viewport: "1440x900" }] });
    const bad = (pages: unknown[]) => DriftConfig.safeParse({ pages }).success;
    expect(bad([{ name: "../x", url: "http://a.test/" }])).toBe(false);
    expect(bad([{ name: "a", url: "file:///etc/passwd" }])).toBe(false);
    expect(bad([{ name: "a", url: "javascript:alert(1)" }])).toBe(false);
    expect(
      bad([
        { name: "a", url: "http://a.test/" },
        { name: "a", url: "http://b.test/" },
      ]),
    ).toBe(false);
    expect(bad([{ name: "a", url: "http://a.test/", typo: 1 }])).toBe(false);
  });
});

describe("drift report html", () => {
  const drift: DriftReport = {
    compared: 10,
    entries: [
      {
        kind: "text-changed",
        path: "root / <img src=x onerror=alert(1)>#0",
        detail: '"a" → "</code><script>alert(1)</script>"',
        before: { x: 10, y: 20, width: 100, height: 30 },
        after: { x: 10, y: 20, width: 120, height: 30 },
      },
      {
        kind: "added",
        path: "root / footer#3",
        detail: "box footer",
        after: { x: 0, y: 5000, width: 10, height: 10 },
      },
    ],
  };
  const page: PageResult = {
    name: "home",
    url: "http://localhost:3000/?q=<b>",
    viewport: "1440x900",
    status: "compared",
    diagnostics: [],
    drift,
    pixelPercent: 1.5,
    over: ["2 changes > 0"],
    shot: { width: 1440, height: 900 },
  };
  const html = renderDriftHtml(
    [page],
    [
      { at: "t1", page: "home", status: "compared", changes: 0 },
      { at: "t2", page: "home", status: "compared", changes: 2 },
    ],
    "2026-10-10T00:00:00.000Z",
  );

  it("escapes everything that came from the page", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("?q=&lt;b&gt;");
  });

  it("crops before/after around the node, and says when it's below the screenshot", () => {
    expect(html).toContain("url('home/baseline.png');background-position:-2px -12px");
    expect(html).toContain("url('home/latest.png');background-position:-2px -12px");
    expect(html).toContain("width:136px;height:46px");
    expect(html).toContain("not in screenshot");
  });

  it("shows the gate result and trend", () => {
    expect(html).toContain("over threshold");
    expect(html).toContain("1 failing");
    expect(html).toContain("▁█");
  });
});
