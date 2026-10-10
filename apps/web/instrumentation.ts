import { sweepJobs } from "./lib/sweep.ts";

export const runtime = "nodejs";

/** Job artifact sweep at server startup (Next.js startup hook, Node runtime only). */
export async function register() {
  sweepJobs();
}
