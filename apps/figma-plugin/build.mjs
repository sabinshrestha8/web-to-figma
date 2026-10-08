// Bundles code.ts (Figma sandbox) and inlines ui.ts into ui.html (Figma loads the UI as one HTML string).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const common = { bundle: true, write: false, minify: true, format: "iife", logLevel: "warning" };

const [code, ui] = await Promise.all([
  // The sandbox's JS engine lags browsers; es2017 keeps the syntax safe.
  build({ ...common, entryPoints: ["src/code.ts"], target: "es2017" }),
  build({ ...common, entryPoints: ["src/ui.ts"], target: "chrome110" }),
]);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/code.js", code.outputFiles[0].text);
// Function replacer: "$&"-style patterns in the minified script must not be interpreted.
const html = readFileSync("src/ui.html", "utf8").replace("/*UI_SCRIPT*/", () =>
  ui.outputFiles[0].text.replaceAll("</script", "<\\/script"),
);
writeFileSync("dist/ui.html", html);
console.log(
  `dist/code.js ${(code.outputFiles[0].text.length / 1024).toFixed(1)} KB, dist/ui.html ${(html.length / 1024).toFixed(1)} KB`,
);
