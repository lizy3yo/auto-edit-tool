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
    // Neutralize the APIMART per-key submit throttle under test: a huge burst means the token
    // bucket never depletes, so fetch-mocked apimart tests don't incur real ~3s refill waits.
    env: { APIMART_BURST: "1000000" },
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/stores/**/*.test.ts",
    ],
  },
});
