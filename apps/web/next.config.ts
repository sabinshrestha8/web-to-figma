import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  // pnpm workspace: trace from the repo root so hoisted deps resolve.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // @w2f/capture drives real Chromium (playwright) and bundles its page
  // collector at runtime (esbuild): both stay external, like plain Node.
  serverExternalPackages: ["playwright", "esbuild"],
  // @w2f/preview ships TypeScript source (workspace convention): compile it.
  transpilePackages: ["@w2f/preview"],
};

export default config;
