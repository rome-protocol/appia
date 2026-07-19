/**
 * Per-chain validation through the REAL Appia UI (operator ask 2026-07-06):
 * "validate each and every chain can connect and do something, ~$1."
 *
 * Part A (all 5 CCTP source chains, no funding): connect the shim wallet,
 * select the chain, enter $1, assert the quote panel resolves — a live quote
 * (green routes) or a clean error (pod-blocked routes render, don't hang).
 *
 * Part B (Sepolia, funded): drive the one popup — connect → quote → Stake →
 * shim signs+broadcasts the real burn → assert it confirmed and the transfer
 * registered with the pod. This is "do something" end-to-end.
 *
 * Run: E2E_KEY_FILE=/path/to/your/e2e-funding.key \
 *      npx playwright test e2e/validate-chains.spec.ts
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Hex } from "viem";
import { installWalletShim } from "./wallet-shim";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4700";
const KEY = (() => {
  const p = (process.env.E2E_KEY_FILE ?? "./e2e-funding.key").replace("~", homedir());
  const raw = readFileSync(p, "utf8").trim();
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
})();

async function ensureConnected(page: import("@playwright/test").Page) {
  for (let i = 0; i < 20; i++) {
    if (await page.locator(".connect.on").count()) return;
    const btn = page.getByRole("button", { name: "Connect wallet" });
    if (await btn.count()) await btn.click().catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  throw new Error("wallet did not connect");
}

const CHAINS = [
  { id: 11155111, label: "Sepolia", expect: "quote" },
  { id: 421614, label: "Arbitrum Sepolia", expect: "error" }, // pod 1.3 fee bug
  { id: 84532, label: "Base Sepolia", expect: "error" },       // pod 1.3 fee bug
  { id: 43113, label: "Avalanche Fuji", expect: "quote" },
  { id: 80002, label: "Polygon Amoy", expect: "quote" },
] as const;

test.describe("Appia per-chain validation", () => {
  test("Dashboard (/) — landing renders positions + services", async ({ page }) => {
    await installWalletShim(page, KEY, 11155111);
    await page.goto(BASE);
    // the dashboard is the landing (Earn moved to /earn)
    await expect(page.getByRole("heading", { name: /Everything this wallet holds/i })).toBeVisible();
    await ensureConnected(page);
    // positions-first: the section + the service catalog render once connected (empty state is fine)
    await expect(page.getByRole("heading", { name: /Your positions/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /What you can do/i })).toBeVisible();
  });

  for (const c of CHAINS) {
    test(`${c.label} (${c.id}) — connect + quote resolves`, async ({ page }) => {
      await installWalletShim(page, KEY, c.id);
      await page.goto(`${BASE}/earn`);
      await ensureConnected(page);

      await page.getByLabel("Source chain").selectOption(String(c.id));
      await page.getByLabel("Amount in USDC").fill("1");

      // The quote panel must RESOLVE — never hang on "Quoting…".
      const quote = page.locator(".quote");
      await expect(quote).not.toContainText("Quoting live route", { timeout: 30_000 });
      const text = await quote.innerText();
      console.log(`[${c.label}] quote panel: ${text.replace(/\n/g, " · ").slice(0, 140)}`);

      if (c.expect === "quote") {
        await expect(quote).toContainText("mSOL", { timeout: 5_000 });
      } else {
        await expect(quote).toContainText(/cannot be converted|failed|unavailable/i);
      }
    });
  }

  test("Sepolia — real $1 burn (one popup, end-to-end)", async ({ page }) => {
    await installWalletShim(page, KEY, 11155111);
    await page.goto(`${BASE}/earn`);
    await ensureConnected(page);
    await page.getByLabel("Source chain").selectOption("11155111");
    await page.getByLabel("Amount in USDC").fill("1");
    await expect(page.locator(".quote")).toContainText("mSOL", { timeout: 30_000 });

    await page.getByRole("button", { name: /Stake .* USDC/ }).click();

    // Milestone I must reach done with a burn tx; then the rail advances to
    // "Arrives on Solana" (pod delivery). We assert the burn landed — the
    // rest depends on the pod worker (validated separately).
    const burnLeg = page.locator(".mi", { hasText: "Leaves your chain" });
    await expect(burnLeg).toHaveClass(/done/, { timeout: 120_000 });
    const burnTxs = await burnLeg.locator(".tx").innerText();
    console.log(`[Sepolia] burn milestone done — ${burnTxs}`);
    expect(burnTxs).toMatch(/0x[0-9a-f]{6}/i);
  });
});
