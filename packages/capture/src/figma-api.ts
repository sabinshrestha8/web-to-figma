import { convertNode, type FigmaRestNode } from "@w2f/convert";
import type { BoxNode } from "@w2f/ir";

/** Read-only Figma REST client for drift comparison (file content only, never written). */
export async function fetchFigmaNode(fileKey: string, nodeId: string, token: string): Promise<unknown> {
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (res.status === 403)
    throw new Error("figma: token rejected (403); check FIGMA_TOKEN scope file_content:read");
  if (res.status === 404)
    throw new Error("figma: file or node not found (404); check the file key and frame id");
  if (!res.ok) throw new Error(`figma: HTTP ${res.status} for ${fileKey}`);
  const json = (await res.json()) as { nodes?: Record<string, { document?: unknown }> };
  const document = json.nodes?.[nodeId]?.document;
  if (!document) throw new Error(`figma: node ${nodeId} missing from the response`);
  return document;
}

/**
 * A Figma frame as an IR tree, rebased onto `origin` (the capture root's bounds) so canvas
 * position never counts as drift.
 */
export async function fetchFigmaFrame(
  fileKey: string,
  nodeId: string,
  token: string,
  origin: { x: number; y: number },
): Promise<BoxNode> {
  const document = (await fetchFigmaNode(fileKey, nodeId, token)) as FigmaRestNode & {
    absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  };
  const frame = document.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const root = convertNode(document, origin.x - frame.x, origin.y - frame.y);
  if (root.type !== "box") throw new Error("figma: the node is not a frame");
  return root;
}
