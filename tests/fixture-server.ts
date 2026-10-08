import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    fixtureUrl: string;
  }
}

const SITE = fileURLToPath(new URL("../fixtures/site/", import.meta.url));
const PORT = 4400;
const URL_ = `http://127.0.0.1:${PORT}`;

async function waitForHttp(url: string, child: ChildProcess, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`fixture server exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet; retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`fixture server not ready at ${url} after ${ms}ms`);
}

/** Serves the prebuilt fixture site (`pnpm test:int` builds it first). */
export default async function setup(project: TestProject) {
  if (!existsSync(`${SITE}.next/BUILD_ID`)) {
    throw new Error("fixtures/site is not built: run `pnpm --filter @w2f/fixture-site build`");
  }
  // Otherwise our server dies with EADDRINUSE and the tests silently run against the other one.
  const taken = await fetch(URL_).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error(`port ${PORT} is already in use: stop the running fixture server first`);
  const nextBin = createRequire(`${SITE}package.json`).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: SITE,
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForHttp(`${URL_}/landing`, child, 30_000);
  project.provide("fixtureUrl", URL_);
  return () => {
    child.kill();
  };
}
