/**
 * Pure resolver: rome-protocol/rome-registry chain files -> Appia's chain config.
 * Principle #3 (nothing hard-coded) — source carries no addresses; they come
 * from the registry via this resolver (fed fresh from origin by
 * scripts/build-chain-config.ts, NOT a stale local clone: the live
 * RomeBridgeWithdraw pointer moved 8.0.0 -> 9.0.0 and a stale read regresses
 * native egress).
 */
export interface RegistryInput {
  // origin uses `solana.rpc`; older/local clones used `solanaRpc.rpc` — accept both.
  chain: { chainId: number; romeEvmProgramId: string; rpcUrl: string; solana?: { rpc?: string }; solanaRpc?: { rpc?: string } };
  contracts: Array<{ name: string; versions: Array<{ address: string; version: string; status: string }> }>;
  tokens: Array<{ symbol: string; address: string; mintId: string; kind: string }>;
}

export interface ResolvedRomeChain {
  chainId: number;
  rpcUrl: string;
  solanaRpc: string;
  romeEvmProgramId: string;
  usdcMint: string;
  wsolMint: string;
  wsolWrapper: string;
  bridgeWithdraw: string;
}

const strip = (u: string) => u.replace(/\/$/, "");

function liveAddress(contracts: RegistryInput["contracts"], name: string): string {
  const entry = contracts.find((c) => c.name === name);
  const live = entry?.versions.find((v) => v.status === "live");
  if (!live) throw new Error(`no live ${name} in registry contracts`);
  return live.address;
}

function tokenMint(tokens: RegistryInput["tokens"], symbol: string): string {
  const t = tokens.find((x) => x.symbol === symbol);
  if (!t) throw new Error(`no ${symbol} token in registry tokens`);
  return t.mintId;
}

function tokenAddress(tokens: RegistryInput["tokens"], symbol: string): string {
  const t = tokens.find((x) => x.symbol === symbol);
  if (!t) throw new Error(`no ${symbol} token in registry tokens`);
  return t.address;
}

export function resolveRomeChain(reg: RegistryInput): ResolvedRomeChain {
  const solanaRpc = reg.chain.solana?.rpc ?? reg.chain.solanaRpc?.rpc;
  if (!solanaRpc) throw new Error("registry chain.json missing solana.rpc");
  return {
    chainId: reg.chain.chainId,
    rpcUrl: strip(reg.chain.rpcUrl),
    solanaRpc: strip(solanaRpc),
    romeEvmProgramId: reg.chain.romeEvmProgramId,
    usdcMint: tokenMint(reg.tokens, "USDC"),
    wsolMint: tokenMint(reg.tokens, "wSOL"),
    wsolWrapper: tokenAddress(reg.tokens, "wSOL"),
    bridgeWithdraw: liveAddress(reg.contracts, "RomeBridgeWithdraw"),
  };
}
