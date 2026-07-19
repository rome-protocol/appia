/**
 * Rome leg signer — the custody boundary. Appia is self-custody ONLY: the user's own wallet signs
 * every Rome leg (walletRomeSigner). There is NO session key. keyRomeSigner signs with a raw private
 * key for the headless harness + tests (a stand-in for the user's wallet, never a browser-held key).
 * Both expose the same surface so the drivers don't know or care which custody path is active.
 */
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface RomeSigner {
  address: Address;
  /** Sign+send a Rome tx and resolve with its hash once mined at status 0x1 (throws on revert). */
  sendRomeTx(to: Address, data: Hex, gas?: bigint): Promise<string>;
}

type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a Rome tx to a terminal receipt: return on 0x1, throw on 0x0, throw if never mined. */
async function confirm(rpc: Rpc, hash: string, pollMs: number, tries: number): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const rec = await rpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (rec) {
      if (rec.status === "0x1") return;
      throw new Error(`rome tx ${hash} reverted`);
    }
    await sleep(pollMs);
  }
  throw new Error(`rome tx ${hash} not mined`);
}

/**
 * Key-backed signer — signs a legacy Rome tx with a raw private key and broadcasts via `rpc`.
 * For the headless harness + unit tests; NOT a session key (the product never generates or stores
 * one). Identical wire behavior to the browser path so a harness run proves the real flow.
 */
export function keyRomeSigner(
  privateKey: Hex,
  deps: { rpc: Rpc; chainId: number; pollMs?: number; tries?: number },
): RomeSigner {
  const account = privateKeyToAccount(privateKey);
  const pollMs = deps.pollMs ?? 2000;
  const tries = deps.tries ?? 90;
  return {
    address: account.address,
    async sendRomeTx(to, data, gas = 30_000_000n) {
      const [nonceHex, gasPriceHex] = await Promise.all([
        deps.rpc<string>("eth_getTransactionCount", [account.address, "pending"]),
        deps.rpc<string>("eth_gasPrice", []),
      ]);
      const signed = await account.signTransaction({
        chainId: deps.chainId,
        type: "legacy",
        nonce: Number.parseInt(nonceHex, 16),
        gasPrice: BigInt(gasPriceHex),
        gas,
        to,
        value: 0n,
        data,
      });
      const hash = await deps.rpc<string>("eth_sendRawTransaction", [signed]);
      await confirm(deps.rpc, hash, pollMs, tries);
      return hash;
    },
  };
}

/** Minimal viem-walletClient surface we depend on (kept narrow so it's trivially mockable). */
export interface WalletLike {
  sendTransaction(args: {
    account?: Address;
    to: Address;
    data: Hex;
    gas?: bigint;
    value?: bigint;
    chainId?: number;
  }): Promise<`0x${string}`>;
}

/**
 * Wallet-backed signer — the user's OWN wallet signs each Rome leg (self-custody, the browser path).
 * Assumes the wallet is already on the Rome chain (the UI performs Add-Rome + switch before the first
 * Rome leg). Confirmation is polled via `rpc` (the same /api/rpc/rome proxy the reads use).
 */
export function walletRomeSigner(deps: {
  address: Address;
  walletClient: WalletLike;
  rpc: Rpc;
  chainId: number;
  pollMs?: number;
  tries?: number;
}): RomeSigner {
  const pollMs = deps.pollMs ?? 2000;
  const tries = deps.tries ?? 90;
  return {
    address: deps.address,
    async sendRomeTx(to, data, gas = 30_000_000n) {
      const hash = await deps.walletClient.sendTransaction({
        account: deps.address,
        to,
        data,
        gas,
        value: 0n,
        chainId: deps.chainId,
      });
      await confirm(deps.rpc, hash, pollMs, tries);
      return hash;
    },
  };
}
