/**
 * Live Meteora DAMM v1 pool reserves for the canonical USDC↔WSOL pool. A pool's REAL reserve is its LP
 * SHARE of the SHARED dynamic vault, not the vault's whole balance (which serves every pool on it):
 *   reserve = poolVaultLpBalance × vault.total_amount / vaultLpMint.supply
 * Reading the raw vault balance over-quotes ~4 orders → minimumOut lands above what the pool pays → the
 * swap reverts Meteora Custom(6004). One getMultipleAccounts of the six vault accounts, decoded by
 * offset, then effectiveReserve. The RPC is injectable so both the server quote route and the
 * client-driven resume share one implementation (browser default → the /api/rpc/solana proxy).
 */
import { ROME_METEORA_POOL } from "./rome/meteora-pool";
import { effectiveReserve } from "./quote-math";
import { bytes32ToPublicKey } from "./rome/solana-pda";

export type SolRpc = <T>(method: string, params: unknown[]) => Promise<T>;

// DAMM v1 offsets: dynamic-vault total_amount u64 @ 11; SPL token amount u64 @ 64; SPL mint supply u64 @ 36.
const VAULT_TOTAL_OFFSET = 11, TOKEN_AMOUNT_OFFSET = 64, MINT_SUPPLY_OFFSET = 36;

const defaultSolRpc: SolRpc = async (method, params) => {
  const r = await fetch("/api/rpc/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error(`solana ${method}: ${JSON.stringify(j.error)}`);
  return j.result as never;
};

export async function fetchPoolReserves(opts: { solRpc?: SolRpc } = {}): Promise<{ usdc6: bigint; wsol9: bigint }> {
  const rpc = opts.solRpc ?? defaultSolRpc;
  const p = ROME_METEORA_POOL;
  const keys = [p.aVault, p.bVault, p.aVaultLp, p.bVaultLp, p.aVaultLpMint, p.bVaultLpMint]
    .map((h) => bytes32ToPublicKey(h).toBase58());
  const res = await rpc<{ value: Array<{ data: [string, string] } | null> }>(
    "getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }],
  );
  const buf = (i: number): Buffer => {
    const d = res.value[i]?.data?.[0];
    if (!d) throw new Error(`pool account ${i} unreadable`);
    return Buffer.from(d, "base64");
  };
  const u64 = (b: Buffer, o: number) => b.readBigUInt64LE(o);
  // keys: [0]aVault [1]bVault [2]aVaultLp [3]bVaultLp [4]aVaultLpMint [5]bVaultLpMint. A=WSOL(9dp), B=USDC(6dp).
  const wsol9 = effectiveReserve(u64(buf(2), TOKEN_AMOUNT_OFFSET), u64(buf(0), VAULT_TOTAL_OFFSET), u64(buf(4), MINT_SUPPLY_OFFSET));
  const usdc6 = effectiveReserve(u64(buf(3), TOKEN_AMOUNT_OFFSET), u64(buf(1), VAULT_TOTAL_OFFSET), u64(buf(5), MINT_SUPPLY_OFFSET));
  if (wsol9 <= 0n || usdc6 <= 0n) throw new Error("pool reserves unavailable");
  return { usdc6, wsol9 };
}
