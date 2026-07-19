/**
 * buildLendView — the pure view-model behind the live /lend page. Turns (mode, amount,
 * wallet wSOL, supplied) into an honest render state: what you can supply/withdraw, the validation
 * message, and the empty states. Honesty rules it encodes:
 *  - supplied === null (reader couldn't read+validate) ⇒ NEVER shown as a position and NEVER withdrawable
 *    (hide, don't fabricate — matches parseMangoDepositedNative's null contract),
 *  - "needs SOL" only when there's nothing to supply AND nothing already supplied (→ prompt /swap),
 *  - you can't supply more than your wallet holds, nor withdraw more than you supplied.
 */
import { describe, it, expect } from "vitest";
import { buildLendView } from "../src/lend-view";

const SOL = (n: number) => BigInt(Math.round(n * 1e9)); // SOL → native 9dp

describe("buildLendView — supply side", () => {
  it("fresh wallet (no wSOL, nothing supplied) → prompt to get SOL, can't supply", () => {
    const v = buildLendView({ mode: "supply", amount9: SOL(1), walletWsol9: 0n, supplied9: 0n });
    expect(v.needsSol).toBe(true);
    expect(v.hasPosition).toBe(false);
    expect(v.canSubmit).toBe(false);
    expect(v.error).toMatch(/balance|more than/i);
  });

  it("amount within the wallet balance → can supply, no error", () => {
    const v = buildLendView({ mode: "supply", amount9: SOL(1), walletWsol9: SOL(2), supplied9: 0n });
    expect(v.canSubmit).toBe(true);
    expect(v.error).toBeNull();
    expect(v.needsSol).toBe(false);
  });

  it("amount over the wallet balance → blocked with a clear message", () => {
    const v = buildLendView({ mode: "supply", amount9: SOL(3), walletWsol9: SOL(2), supplied9: 0n });
    expect(v.canSubmit).toBe(false);
    expect(v.error).toMatch(/more than your wallet/i);
  });

  it("zero amount → not submittable, but no scary error", () => {
    const v = buildLendView({ mode: "supply", amount9: 0n, walletWsol9: SOL(2), supplied9: 0n });
    expect(v.canSubmit).toBe(false);
    expect(v.error).toBeNull();
  });
});

describe("buildLendView — withdraw side + position", () => {
  it("a supplied balance shows as a position; withdraw within it is allowed", () => {
    const v = buildLendView({ mode: "withdraw", amount9: SOL(0.5), walletWsol9: 0n, supplied9: SOL(1) });
    expect(v.hasPosition).toBe(true);
    expect(v.needsSol).toBe(false); // has a position → not "needs SOL"
    expect(v.maxWithdraw9).toBe(SOL(1));
    expect(v.canSubmit).toBe(true);
    expect(v.error).toBeNull();
  });

  it("withdrawing more than supplied is blocked", () => {
    const v = buildLendView({ mode: "withdraw", amount9: SOL(2), walletWsol9: 0n, supplied9: SOL(1) });
    expect(v.canSubmit).toBe(false);
    expect(v.error).toMatch(/more than you supplied/i);
  });

  it("supplied === null (unreadable) → no position, never withdrawable, no fabrication", () => {
    const v = buildLendView({ mode: "withdraw", amount9: SOL(0.5), walletWsol9: 0n, supplied9: null });
    expect(v.suppliedKnown).toBe(false);
    expect(v.hasPosition).toBe(false);
    expect(v.maxWithdraw9).toBe(0n);
    expect(v.canSubmit).toBe(false);
    expect(v.error).toMatch(/couldn.t read|can.t read|unavailable/i);
  });

  it("supply still works even when the position read is unavailable", () => {
    const v = buildLendView({ mode: "supply", amount9: SOL(1), walletWsol9: SOL(2), supplied9: null });
    expect(v.canSubmit).toBe(true);
    expect(v.error).toBeNull();
  });
});
