/**
 * The sponsor drip fuels the session key so its Rome legs pass Rome's
 * balance >= gas_limit * gasPrice pre-check. The legs declare up to 100M gas
 * (egress), so a *fixed* 0.02-gas drip fell below the pre-check as soon as
 * gasPrice rose (10.4 Gwei on Hadrian => a 30M-gas leg needs 0.31 gas, a 100M
 * egress needs 1.04 gas => "User does not have sufficient funds (Wei)").
 * Fix (principle #3, chain-first): size the drip = live gasPrice * a gas-units
 * budget that covers the largest session leg. dripGasWei is that sizing.
 */
import { describe, it, expect } from "vitest";
import { dripGasWei, DRIP_GAS_UNITS_DEFAULT } from "../src/drip-gas";

const HADRIAN_GAS_PRICE = 10_403_793_960n; // observed 2026-07-07
const EGRESS_LEG_GAS = 100_000_000n; // the largest gas_limit any session leg declares (deliver-home)

describe("dripGasWei — chain-sourced fuel sizing (principle #3)", () => {
  it("sizes = live gasPrice x units budget", () => {
    expect(dripGasWei(10n, 100n)).toBe(1000n);
    expect(dripGasWei(HADRIAN_GAS_PRICE, DRIP_GAS_UNITS_DEFAULT)).toBe(
      HADRIAN_GAS_PRICE * DRIP_GAS_UNITS_DEFAULT,
    );
  });

  it("default budget covers the largest leg's gas_limit (the pre-check ceiling)", () => {
    // one drip must cover the biggest single leg's gas_limit x gasPrice; unused
    // gas is refunded per tx, so the max-leg ceiling bounds the whole journey.
    expect(DRIP_GAS_UNITS_DEFAULT).toBeGreaterThanOrEqual(EGRESS_LEG_GAS);
  });

  it("at live gasPrice the drip clears the 100M-gas egress pre-check", () => {
    const drip = dripGasWei(HADRIAN_GAS_PRICE, DRIP_GAS_UNITS_DEFAULT);
    expect(drip).toBeGreaterThanOrEqual(EGRESS_LEG_GAS * HADRIAN_GAS_PRICE);
  });

  it("regression: the retired fixed 0.02-gas drip was BELOW the egress pre-check", () => {
    const oldFixed = 20_000_000_000_000_000n; // 0.02 gas — why the journey reverted
    expect(oldFixed).toBeLessThan(EGRESS_LEG_GAS * HADRIAN_GAS_PRICE);
  });
});
