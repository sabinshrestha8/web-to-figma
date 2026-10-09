import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Captures and reports of real apps hold real data: bare file names live in the gitignored .data/. */
export const DATA_DIR = ".data";

const bare = (p: string) => basename(p) === p;

/** Where to write `p`: a bare name goes into .data/, any path with a folder stays as given. */
export function outPath(p: string): string {
  const target = bare(p) ? join(DATA_DIR, p) : p;
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

/** Where to read `p`: as given if it exists, else a bare name is looked up in .data/. */
export function inPath(p: string): string {
  return bare(p) && !existsSync(p) && existsSync(join(DATA_DIR, p)) ? join(DATA_DIR, p) : p;
}
