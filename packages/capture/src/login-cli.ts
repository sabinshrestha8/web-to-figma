/** pnpm w2f:login <login url> [-o .data/auth.json]: save a logged-in session for `pnpm w2f --storage-state`. */
import { parseArgs } from "node:util";
import { saveLogin } from "./login.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", short: "o", default: ".data/auth.json" } },
});
const [url] = positionals;
if (!url) {
  console.error("usage: pnpm w2f:login <login url> [-o .data/auth.json]");
  process.exit(2);
}
console.error("Log in in the browser window, wait until you're signed in, then close the window.");
saveLogin(url, values.out).then(
  (n) => {
    console.log(`saved ${values.out} (${n} cookies/origins). It's a live session: delete it when done.`);
    if (n === 0)
      console.error("warning: nothing was saved. Did the login finish before you closed the window?");
  },
  (e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
