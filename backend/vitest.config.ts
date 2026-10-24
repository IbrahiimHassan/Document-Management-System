import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig({
  test: {
    // .env.test values win over .env, so tests never use your development settings
    env: loadEnv("test", process.cwd(), ""),
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // All test files share one database, so run them one at a time
    fileParallelism: false,
  },
});