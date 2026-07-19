import { defineConfig } from "vitest/config";

// FUNCTIONAL tests only — hit the live bridge-api pod / devnet (not hermetic).
// CI-only: run via `npm run test:functional` with APPIA_FUNCTIONAL=1. Kept in
// a separate config so the default `npm test` (unit) stays fast + offline.
export default defineConfig({
  test: {
    include: ["tests/functional/**/*.func.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
