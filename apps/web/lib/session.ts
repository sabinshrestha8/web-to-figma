import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadStorageState, type StorageState, saveLogin } from "@w2f/capture";
import { dataDir } from "./sweep.ts";

/** The default session file, shared with `pnpm w2f:login` (its `-o` default). */
export function authPath(): string {
  return join(dirname(dataDir()), "auth.json");
}

export interface SessionInfo {
  present: boolean;
  cookies: number;
  /** Cookie domains and localStorage origins: metadata only, never secret values. */
  domains: string[];
  origins: string[];
}

export function sessionInfo(): SessionInfo {
  try {
    const state = loadStorageState(authPath());
    return {
      present: true,
      cookies: state.cookies.length,
      domains: [...new Set(state.cookies.map((c) => c.domain))].sort(),
      origins: state.origins.map((o) => o.origin).sort(),
    };
  } catch {
    return { present: false, cookies: 0, domains: [], origins: [] };
  }
}

export type SaveLogin = (url: string, out: string) => Promise<number>;

export interface LoginRecord {
  id: string;
  url: string;
  status: "open" | "done" | "failed";
}

export interface LoginStore {
  start: (url: string) => LoginRecord | null;
  get: (id: string) => LoginRecord | undefined;
  info: () => SessionInfo;
  clear: () => boolean;
  load: () => StorageState;
}

/** One interactive login at a time (the user logs in inside the opened window). */
export function createLoginStore(save: SaveLogin = (url, out) => saveLogin(url, out)): LoginStore {
  let active: (LoginRecord & { done: Promise<void> }) | null = null;
  return {
    start(url) {
      if (active && active.status === "open") return null;
      const rec: LoginRecord & { done?: Promise<void> } = { id: randomUUID(), url, status: "open" };
      rec.done = (async () => {
        try {
          await save(url, authPath());
          rec.status = "done";
        } catch {
          rec.status = "failed";
        }
      })();
      active = rec as LoginRecord & { done: Promise<void> };
      return { id: rec.id, url: rec.url, status: rec.status };
    },
    get: (id) => {
      if (!active || active.id !== id) return undefined;
      return { id: active.id, url: active.url, status: active.status };
    },
    info: () => sessionInfo(),
    clear: () => {
      if (!existsSync(authPath())) return false;
      rmSync(authPath(), { force: true });
      return true;
    },
    load: () => {
      if (!existsSync(authPath())) throw new Error("no saved session — log in first");
      return loadStorageState(authPath());
    },
  };
}

/** The server's login store (module singleton, one per process). */
export const loginStore = createLoginStore();
