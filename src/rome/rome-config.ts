/**
 * Appia chain config. Registry-owned fields (chainId, RPCs, programId, USDC +
 * wSOL mints, wSOL wrapper, and the LIVE RomeBridgeWithdraw pointer) are
 * RESOLVED from rome-protocol/rome-registry via chain-config.generated.json
 * (produced by `npm run build:chain-config`, fetched FRESH from origin —
 * principle #3, nothing hard-coded; a stale local clone still shows the retired
 * 8.0.0 withdraw and would regress native egress).
 *
 * mSOL is app-level: the Marinade mint is a public Solana mint and the wrapper
 * was app-deployed; neither is in the registry's Hadrian tokens yet, so they
 * stay documented app constants until registered (then they move to the
 * resolver too).
 */
import generated from "./chain-config.generated.json";

// app-level (not in the registry's Hadrian tokens): Marinade mSOL mint +
// Appia-deployed wrapper. Documented here until registry-registered.
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const MSOL_WRAPPER = "0x0ea6e66d26c5e1f6fd3886a080db837b841c5b89";

export const ROME_CHAIN = {
  chainId: generated.chainId,
  rpcUrl: generated.rpcUrl,
  romeEvmProgramId: generated.romeEvmProgramId,
  solanaRpc: generated.solanaRpc,
  usdcMint: generated.usdcMint,
  wsolMint: generated.wsolMint,
  wsolWrapper: generated.wsolWrapper,
  msolMint: MSOL_MINT,
  msolWrapper: MSOL_WRAPPER,
  bridgeWithdraw: generated.bridgeWithdraw,
} as const;

export function activeChain() {
  return { romeEvmProgramId: ROME_CHAIN.romeEvmProgramId };
}

/**
 * App-level Solana program ids (not per-chain registry values — these programs
 * are deployed once on the Solana devnet substrate and shared by every Rome
 * chain). Documented here until registry-registered, same as the mSOL mint.
 *   - marinade: liquid-staking (devnet redeploy)
 *   - mangoV4:  Mango v4 margin/lend (same address on devnet + mainnet)
 */
export function solanaProgramId(key: string, _network = "devnet"): string {
  const ids: Record<string, string> = {
    marinade: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
    mangoV4: "4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg",
  };
  const id = ids[key];
  if (!id) throw new Error(`unknown solana program ${key}`);
  return id;
}
