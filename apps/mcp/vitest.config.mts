import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The OIDC tests sign and verify real tokens with a real key pair; nothing here needs
    // a database, a network or the MCP transport.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
