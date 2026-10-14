import { createServer } from "node:http";
import { closeBrowser } from "@w2f/capture";
import { configFromEnv, createApp } from "./app.ts";

const config = configFromEnv(process.env);
const app = createApp(config);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const server = createServer((req, res) => void app.handle(req, res));
// Slow-loris guard: a client gets 30 s to send its (≤16 KB) request.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "listening",
      port,
      auth: config.apiTokens.length > 0,
      maxRunning: config.maxRunning,
      allowPrivateNetworks: config.allowPrivateNetworks,
    }),
  );
  if (config.allowPrivateNetworks)
    console.warn(
      "W2F_ALLOW_PRIVATE=1: this service can reach localhost and private networks. Development only.",
    );
});
setInterval(() => app.sweep(), 60_000).unref();

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: "stopping", signal }));
  app.abortAll();
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
