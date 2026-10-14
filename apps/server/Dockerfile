# The hosted capture service. Build from the repo root:
#   docker build -f apps/server/Dockerfile -t w2f-server .
#   docker run --rm -p 8787:8787 --env-file apps/server/.env w2f-server
# Base image = the Playwright version in packages/capture (Chromium + its system libraries).
FROM mcr.microsoft.com/playwright:v1.64.0-noble

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app
COPY . .
# The server and the workspace packages it imports; no dev tooling, no fixtures, no web app.
RUN pnpm install --frozen-lockfile --filter "@w2f/server..." \
 && chown -R pwuser:pwuser /app

USER pwuser
# tsx is resolved from here (the filtered install puts it in apps/server/node_modules).
WORKDIR /app/apps/server
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# node directly (not pnpm) so SIGTERM reaches the server and it shuts down cleanly.
CMD ["node", "--import", "tsx", "src/main.ts"]
