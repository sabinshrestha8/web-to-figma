// Bundles code.ts (Figma sandbox) and inlines ui.ts into ui.html (Figma loads the UI as one HTML string).
//   node build.mjs             dev build → dist/, for manifest.json (capture service: W2F_API_URL or localhost:8787)
//   node build.mjs --release   Community build → release/{manifest.json,dist/} (W2F_API_URL required, https only)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const release = process.argv.includes("--release");
const api = (process.env.W2F_API_URL ?? (release ? "" : "http://localhost:8787")).replace(/\/+$/, "");

function fail(message) {
  console.error(message);
  process.exit(1);
}
let origin;
try {
  origin = new URL(api).origin;
} catch {
  fail(`W2F_API_URL must be the capture service's URL, e.g. https://capture.example.com (got "${api}").`);
}
if (release) {
  const { protocol, hostname } = new URL(api);
  if (protocol !== "https:") fail("W2F_API_URL must use https:// for a release build.");
  if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(hostname))
    fail("W2F_API_URL must not point at this machine for a release build.");
}

const common = {
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  logLevel: "warning",
  define: { W2F_API_URL: JSON.stringify(api), W2F_RELEASE: String(release) },
};

const [code, ui] = await Promise.all([
  // The sandbox's JS engine lags browsers; es2017 keeps the syntax safe.
  build({ ...common, entryPoints: ["src/code.ts"], target: "es2017" }),
  build({ ...common, entryPoints: ["src/ui.ts"], target: "chrome110" }),
]);

// Function replacer: "$&"-style patterns in the minified script must not be interpreted.
const html = readFileSync("src/ui.html", "utf8").replace("/*UI_SCRIPT*/", () =>
  ui.outputFiles[0].text.replaceAll("</script", "<\\/script"),
);
const out = release ? "release" : ".";
if (release) rmSync("release", { recursive: true, force: true });
mkdirSync(`${out}/dist`, { recursive: true });
writeFileSync(`${out}/dist/code.js`, code.outputFiles[0].text);
writeFileSync(`${out}/dist/ui.html`, html);

if (release) {
  const manifest = JSON.parse(readFileSync("manifest.prod.json", "utf8"));
  if (process.env.W2F_PLUGIN_ID) manifest.id = process.env.W2F_PLUGIN_ID;
  else
    console.warn(
      `W2F_PLUGIN_ID not set: using "${manifest.id}". Figma assigns the real id (docs/release.md).`,
    );
  // The plugin may reach the capture service and nothing else.
  manifest.networkAccess = { allowedDomains: [origin] };
  writeFileSync("release/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
} else {
  const allowed = JSON.parse(readFileSync("manifest.json", "utf8")).networkAccess?.allowedDomains ?? [];
  if (!allowed.includes(origin))
    console.warn(`manifest.json does not allow ${origin}; add it to networkAccess.`);
}
console.log(
  `${out}/dist/code.js ${(code.outputFiles[0].text.length / 1024).toFixed(1)} KB, ${out}/dist/ui.html ${(html.length / 1024).toFixed(1)} KB, capture service ${origin}`,
);
