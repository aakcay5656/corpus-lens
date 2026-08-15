import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests sit beside the code they test. Nothing here reaches the network or a
    // database: the chunker takes a string, and the embedding tests use the
    // deterministic provider, which is the point of it existing.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
