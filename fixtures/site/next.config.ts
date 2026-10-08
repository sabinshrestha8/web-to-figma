import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  // pnpm workspace: trace from the repo root so hoisted deps resolve.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default config;
