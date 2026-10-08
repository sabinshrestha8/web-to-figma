import type { Document } from "@w2f/ir";
import { build, type FontPlan, planBuild } from "./build.ts";
import type { ToCode, ToUI } from "./messages.ts";

figma.showUI(__html__, { width: 380, height: 460, themeColors: true });

const post = (m: ToUI) => figma.ui.postMessage(m);

/** The selected frame, or the first frame of a selected import section. */
function selectedFrame(): FrameNode | null {
  const [node] = figma.currentPage.selection;
  if (node?.type === "FRAME") return node;
  if (node?.type === "SECTION") return node.children.find((c): c is FrameNode => c.type === "FRAME") ?? null;
  return null;
}

async function exportSelected() {
  const frame = selectedFrame();
  if (!frame)
    return post({ type: "export-failed", message: "Select a captured frame (or its section) first." });
  const png = await frame.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
  post({ type: "exported", name: frame.name, png });
}

/** A loaded bundle waiting for the user to confirm its font report. */
let pending: { ir: Document; assets: Record<string, Uint8Array>; plan: FontPlan } | null = null;

const fail = (e: unknown) =>
  post({
    type: "failed",
    diagnostics: [
      { code: "FIGMA_BUILD_FAILED", severity: "fatal", message: e instanceof Error ? e.message : String(e) },
    ],
  });

figma.ui.onmessage = async (msg: ToCode) => {
  if (msg.type === "export") return exportSelected();
  if (msg.type === "cancel") {
    pending = null;
    return;
  }
  if (msg.type === "load") {
    try {
      const plan = await planBuild(msg.ir);
      pending = { ir: msg.ir, assets: msg.assets, plan };
      return post({ type: "fonts", fonts: plan.report });
    } catch (e) {
      return fail(e);
    }
  }
  if (!pending) return;
  const { ir, assets, plan } = pending;
  pending = null;
  const started = Date.now();
  try {
    const result = await build(ir, assets, plan, (done, total) => post({ type: "progress", done, total }));
    post({ type: "done", nodes: result.nodes, ms: Date.now() - started, diagnostics: result.diagnostics });
  } catch (e) {
    fail(e);
  }
};
