import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const TTL_MS = 24 * 3600 * 1000;

/** Overridable for tests; the server keeps job artifacts under the repo's gitignored `.data/`. */
export function dataDir(): string {
  return process.env.W2F_DATA_DIR ?? join(process.cwd(), "..", "..", ".data", "jobs");
}

/** Delete job dirs older than 24h. Called once at server startup (instrumentation.ts). */
export function sweepJobs(root = dataDir(), now = Date.now()): number {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return 0; // nothing stored yet
  }
  let removed = 0;
  for (const name of names) {
    const mtime = safeMtime(join(root, name));
    if (mtime !== null && now - mtime > TTL_MS) {
      rmSync(join(root, name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

function safeMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null; // a vanishing entry is left for the next sweep
  }
}
