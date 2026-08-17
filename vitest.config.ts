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
    // AIREITER_LANES: vitest injects the developer's real .env, so a machine running the
    // AIReiter bolt-on would silently reroute the stills/b-roll lanes under test and fail
    // suites that assert the OpenAI/APIMART path. Pinned off; the bolt-on's own tests set
    // ENV.aireiterLanes directly.
    env: {
      APIMART_BURST: "1000000",
      JWT_SECRET: "test-secret",
      AIREITER_LANES: "",
    },
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/stores/**/*.test.ts",
      // Pure logic lifted out of components so it can be tested without a DOM — the
      // scene-preview A/V sync is the first. Still `environment: "node"`: these must not
      // reach for `document`, or they belong in a jsdom project of their own.
      "client/src/components/**/*.test.ts",
    ],
  },
});
