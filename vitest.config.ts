import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // APIMART_BURST: neutralize the per-key submit throttle under test — a huge burst means
    // the token bucket never depletes, so fetch-mocked apimart tests don't incur real ~3s
    // refill waits.
    // JWT_SECRET: encryption.ts refuses to derive a key without one (no dev fallback, by
    // design). Any value works; the tests only round-trip through it.
    env: { APIMART_BURST: "1000000", JWT_SECRET: "test-secret" },
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/stores/**/*.test.ts",
    ],
  },
});
