/**
 * Chain-first fuel sizing (principle #3). Rome pre-checks
 * `balance >= gas_limit * gasPrice` on every tx, so the operator drip must fund
 * the user's Rome address for the LARGEST leg's gas_limit at the LIVE gasPrice —
 * never a fixed Wei amount (a fixed 0.02 gas silently fell below the pre-check
 * once gasPrice rose, reverting the journey with "insufficient funds (Wei)").
 *
 * The Rome legs (src/drivers.ts, signed via RomeSigner) declare up to 100M gas
 * (deliver-home egress; swap/stake/create_ata are 30M). Unused gas is refunded
 * per tx, so one drip sized to the largest leg's ceiling (+ margin for the small
 * consumed amounts that accumulate) covers the whole journey. The budget is in
 * gas UNITS (a property of our own leg gas_limits); the price comes from chain.
 */

/** Largest gas_limit any Rome leg declares today (egress). */
export const MAX_LEG_GAS = 100_000_000n;

/** Default drip budget in gas units: the max leg ceiling + 50% margin. */
export const DRIP_GAS_UNITS_DEFAULT = (MAX_LEG_GAS * 3n) / 2n; // 150M

/** Drip amount in wei = live gasPrice * gas-units budget. */
export function dripGasWei(gasPriceWei: bigint, gasUnits: bigint = DRIP_GAS_UNITS_DEFAULT): bigint {
  return gasPriceWei * gasUnits;
}
