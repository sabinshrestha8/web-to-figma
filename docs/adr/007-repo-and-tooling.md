# ADR-007: Repository and tooling

**Status:** Accepted (2026-10-08)

## Context
Several runtimes (page script, Node, Next.js, Figma sandbox) share one schema. We want the simplest setup that can become production-grade.

## Problem
Repo layout, build approach and toolchain.

## Options considered
- Polyrepo vs **monorepo**.
- pnpm workspaces vs Turborepo/Nx.
- Per-package builds vs **source exports**.
- ESLint + Prettier vs **Biome**.
- Jest vs **Vitest**.
- webpack/vite vs **esbuild** for the collector and plugin.
- Any database, queue or object store.

## Decision
- A pnpm-workspace monorepo with packages split by **runtime boundary**: `ir`, `capture`, `convert`, `preview`, plus `apps/web`, `apps/figma-plugin`, `fixtures/site`.
- Packages export TS source (`exports: ./src/index.ts`), compiled by their consumer.
- TypeScript 7 strict, Biome, Vitest 4 (5 once Node ≥ 22.12 locally), esbuild.
- No database, queue, Redis or object storage.

## Reasoning
- One repo keeps the schema and its consumers changing together.
- Source exports remove a build step per package.
- One lint/format tool and one test runner. Package boundaries follow where code *runs*, which is what actually constrains dependencies (e.g. `convert` can't import Playwright).

## Consequences
- No task-graph caching until build times justify Turborepo.
- Packages appear only when a phase needs them.

## Rejected alternatives
- Microservices, Kubernetes, Redis, Kafka: no requirement justifies them in V1.
