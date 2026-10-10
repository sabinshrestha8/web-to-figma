import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authPath, createLoginStore, sessionInfo } from "./session.ts";
import { dataDir } from "./sweep.ts";

afterEach(() => {
  delete process.env.W2F_DATA_DIR;
});

const useTmpDataDir = () => {
  process.env.W2F_DATA_DIR = join(mkdtempSync(join(tmpdir(), "w2f-web-session-")), "jobs");
  mkdirSync(dataDir(), { recursive: true });
};

const TOKEN = "live-session-token-must-never-leak";
const seedSession = () =>
  writeFileSync(
    authPath(),
    JSON.stringify({
      cookies: [
        {
          name: "w2f_session",
          value: TOKEN,
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [{ origin: "http://127.0.0.1:4400", localStorage: [{ name: "w2f_user", value: "Ada" }] }],
    }),
  );

describe("login store", () => {
  it("opens a login, reports done, and starts again after", async () => {
    useTmpDataDir();
    let resolve = () => {};
    const store = createLoginStore(() => new Promise<number>((r) => (resolve = () => r(2))));
    const first = store.start("http://127.0.0.1:4400/auth");
    expect(first).toMatchObject({ url: "http://127.0.0.1:4400/auth", status: "open" });
    expect(store.start("http://x/")).toBeNull();
    resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(first?.id ?? "")?.status).toBe("done");
    expect(store.start("http://127.0.0.1:4400/auth")?.id).not.toBe(first?.id);
  });

  it("reports a failed login", async () => {
    useTmpDataDir();
    const store = createLoginStore(async () => {
      throw new Error("browser gone");
    });
    const rec = store.start("http://127.0.0.1:4400/auth");
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(rec?.id ?? "")?.status).toBe("failed");
    expect(store.get("nope")).toBeUndefined();
  });
});

describe("session file", () => {
  it("reports metadata without secret values", () => {
    useTmpDataDir();
    expect(sessionInfo()).toMatchObject({ present: false });
    seedSession();
    const info = sessionInfo();
    expect(info).toMatchObject({
      present: true,
      cookies: 1,
      domains: ["127.0.0.1"],
      origins: ["http://127.0.0.1:4400"],
    });
    expect(JSON.stringify(info)).not.toContain(TOKEN);
    expect(JSON.stringify(info)).not.toContain("Ada");
  });

  it("clears the session file", () => {
    useTmpDataDir();
    const store = createLoginStore(async () => 0);
    expect(store.clear()).toBe(false);
    seedSession();
    expect(store.clear()).toBe(true);
    expect(store.clear()).toBe(false);
    expect(existsSync(authPath())).toBe(false);
  });

  it("loads the session, or throws value-free errors", () => {
    useTmpDataDir();
    const store = createLoginStore(async () => 0);
    expect(() => store.load()).toThrowError("no saved session");
    seedSession();
    expect(store.load().cookies[0]?.value).toBe(TOKEN);
    writeFileSync(authPath(), "{broken");
    expect(() => store.load()).toThrowError("not a readable JSON file");
  });
});
