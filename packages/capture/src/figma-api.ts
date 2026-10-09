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
