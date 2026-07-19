import { defineConfig } from "vitest/config";

// Unit tests only. e2e/ is Playwright (its own runner) — vitest must not
// collect it (both define test/describe; collection would otherwise fail).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // functional/** hits the live pod (not hermetic) — its own config + script.
    exclude: ["tests/functional/**", "e2e/**", "node_modules/**", ".next/**"],
  },
});
