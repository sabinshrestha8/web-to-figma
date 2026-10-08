import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * A logged-in session saved by `pnpm w2f:login <url>` (cookies + localStorage).
 * It's a credential: we only ever read it into the capture context. Errors name the file and the
 * failing path, never a value.
 */
const StorageState = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]),
    }),
  ),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});
export type StorageState = z.infer<typeof StorageState>;

export function loadStorageState(path: string): StorageState {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(
      `${path}: not a readable JSON file (${(e as NodeJS.ErrnoException).code ?? "invalid JSON"})`,
    );
  }
  const parsed = StorageState.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw new Error(`${path}: not a Playwright storage state file (bad: ${where})`);
  }
  return parsed.data;
}
