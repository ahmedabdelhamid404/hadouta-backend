import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Auth tests share a single DB; run sequentially to avoid race on user inserts.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
