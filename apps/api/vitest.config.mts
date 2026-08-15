import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Nest resolves injected providers from decorator metadata, and one Nest app per file
    // opening its own connection pool is enough to exhaust a default local Postgres.
    fileParallelism: false,
  },
  plugins: [
    // esbuild — vitest's default transformer — does not implement emitDecoratorMetadata,
    // so every constructor injection would resolve to undefined at runtime. SWC does.
    swc.vite({ module: { type: "es6" } }),
  ],
});
