// The lab's own test config: without it vitest walks up to the app's config and runs the app's
// suite. Only this folder's tests run here.
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
