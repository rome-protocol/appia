/**
 * Sponsor drip — fronts Rome gas to the user's own address so its Rome legs can
 * run. Transfers Rome gas from the sponsor EOA to the destination address, sized
 * from the LIVE chain gasPrice × a gas-units budget so it always clears each
 * leg's `balance >= gas_limit × gasPrice` pre-check (never a fixed amount; a
 * hardcoded 0.02 gas fell below the pre-check once gasPrice rose and reverted the
 * journey with "insufficient funds (Wei)"). Gas-only: the USDC ATA is funded
 * server-side during delivery, and the external_auth PDA is never pre-funded
 * (self-funds from the user's own ops).
 *
 * The sponsor key comes from an env FILE PATH; never in the repo. Rate limit:
 * one drip per address per hour (in-memory v0 — per-instance).
 */
import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROME_CHAIN } from "@/src/rome/rome-config";
import { dripGasWei, DRIP_GAS_UNITS_DEFAULT } from "@/src/drip-gas";

// Gas-units budget (config / last-resort tier); the wei amount is sized from the
// live chain gasPrice per request in POST — principle #3, chain first.
const DRIP_GAS_UNITS = BigInt(process.env.APPIA_DRIP_GAS_UNITS ?? DRIP_GAS_UNITS_DEFAULT.toString());
// Retired: hard-coded external_auth PDA rent reserve. The PDA is never pre-funded —
// creates are operator-funded (HelperProgram.create_ata) and the PDA self-funds from the
// user's own ops (unwrap) when a leg needs it. Only outbound funds it lazily at the burn leg.

const recent = new Map<string, number>();

function sponsorEvmKey(): Hex {
  const p = process.env.APPIA_SPONSOR_EVM_KEY_FILE;
  if (!p) throw new Error("APPIA_SPONSOR_EVM_KEY_FILE not set");
  const raw = readFileSync(p, "utf8").trim();
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}


export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { address?: string; sessionAddress?: string };
    const dest = body.address ?? body.sessionAddress ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(dest)) {
      return Response.json({ error: "bad address" }, { status: 400 });
    }
    const last = recent.get(dest.toLowerCase()) ?? 0;
    if (Date.now() - last < 3_600_000) {
      return Response.json({ ok: true, note: "already fueled this hour" });
    }

    // 1. Rome gas
    const rome = defineChain({
      id: ROME_CHAIN.chainId, name: "rome",
      nativeCurrency: { name: "gas", symbol: "GAS", decimals: 18 },
      rpcUrls: { default: { http: [process.env.ROME_RPC_URL ?? ROME_CHAIN.rpcUrl] } },
    });
    const account = privateKeyToAccount(sponsorEvmKey());
    const wallet = createWalletClient({ chain: rome, transport: http(), account });
    const pub = createPublicClient({ chain: rome, transport: http() });
    const gasPrice = await pub.getGasPrice(); // CHAIN first — size the drip to the live price
    const value = dripGasWei(gasPrice, DRIP_GAS_UNITS);
    const gasTx = await wallet.sendTransaction({ account, chain: rome, to: dest as Hex, value });
    await pub.waitForTransactionReceipt({ hash: gasTx });

    recent.set(dest.toLowerCase(), Date.now());
    return Response.json({ ok: true, gasTx, value: value.toString(), gasPrice: gasPrice.toString() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
