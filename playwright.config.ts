import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4700" },
});
