import { configDefaults, defineConfig } from "vitest/config";

const exclude = [...configDefaults.exclude, "**/.next/**"];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["**/*.test.ts"], exclude: [...exclude, "**/*.int.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["**/*.int.test.ts"],
          exclude,
          globalSetup: ["tests/fixture-server.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
