import { ROME_CHAIN } from "@/src/rome/rome-config";
import { composeEarnQuote } from "@/src/quote-math";
import { quoteFee } from "@/src/fee";
import { fetchPoolReserves } from "@/src/pool-reserves";

const POD = process.env.BRIDGE_API_URL ?? "https://bridge-api.devnet.romeprotocol.xyz";
const FEE_BPS = Number(process.env.APPIA_FEE_BPS ?? "100");
const FEE_FLOOR_USDC6 = BigInt(process.env.APPIA_FEE_FLOOR_USDC6 ?? "1000000");

const MARINADE_STATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(process.env.SOLANA_RPC_URL ?? ROME_CHAIN.solanaRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: T; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result as T;
}

/** Marinade SOL-per-mSOL from the State account's cached msol_price
 * (u64 LE @ 512, scaled 2^32 — offsets per cardo/lib/marinade-state.ts).
 * Cached ⇒ can lag the live-computed rate by an epoch; fine for the DISPLAY
 * quote (the swap leg's minimumOut is the real user protection). */
async function marinadeMsolPerSol(): Promise<number> {
  const info = await solRpc<{ value: { data: [string, string] } }>("getAccountInfo", [
    MARINADE_STATE, { encoding: "base64" },
  ]);
  const buf = Buffer.from(info.value.data[0], "base64");
  const msolPrice = buf.readBigUInt64LE(512);
  const solPerMsol = Number(msolPrice) / 2 ** 32;
  return 1 / solPerMsol;
}

export async function POST(req: Request) {
  try {
    const { sourceChainId, amountUsdc6, sender, recipient } = (await req.json()) as {
      sourceChainId?: number; amountUsdc6: string; sender?: string; recipient?: string;
    };

    // Wallet-less PREVIEW: with no sender/sourceChain we skip the bridge leg and quote the deterministic
    // USDC→SOL swap on the entered amount (the pool math needs no wallet). Network fees + ETA come once
    // the user connects on a supported chain (the full quote path). Lets every tab show a real, honest
    // quote before connecting — the deterministic outcome the operator asked for.
    const preview = !sender || !sourceChainId;
    let podQuote: { amountOut?: string; steps?: unknown[]; message?: string } | null = null;
    let bridgedUsdc6: bigint;
    if (preview) {
      bridgedUsdc6 = BigInt(amountUsdc6);
    } else {
      podQuote = await (await fetch(`${POD}/v1/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset: "USDC", direction: "to-rome", sourceChain: `eip155:${sourceChainId}`,
          romeChainId: String(ROME_CHAIN.chainId), amount: amountUsdc6,
          intent: "wrapper", speed: "fast",
          sender: { ethereum: sender }, recipient,
        }),
      })).json() as { amountOut?: string; steps?: unknown[]; message?: string };
      if (!podQuote.amountOut) {
        return Response.json({ error: `bridge quote failed: ${podQuote.message ?? "no amountOut"}` }, { status: 502 });
      }
      bridgedUsdc6 = BigInt(podQuote.amountOut);
    }

    const [{ usdc6, wsol9 }, msolPerSol] = await Promise.all([
      fetchPoolReserves({ solRpc }),
      marinadeMsolPerSol(),
    ]);
    const feeUsdc6 = quoteFee({ amountUsdc6: bridgedUsdc6, feeBps: FEE_BPS, floorUsdc6: FEE_FLOOR_USDC6 });
    const q = composeEarnQuote({
      bridgedUsdc6, feeUsdc6,
      poolUsdcReserve6: usdc6,
      poolWsolReserve9: wsol9,
      poolFeeBps: 25,
      msolPerSol,
      slippageBps: 300, // shallow-pool honesty (cardo scripts/wormhole-lst/README.md)
    });

    return Response.json({
      podQuote,
      preview,
      feeUsdc6: feeUsdc6.toString(),
      swapInUsdc6: q.swapInUsdc6.toString(),
      estWsol9: q.estWsol9.toString(),
      minWsol9: q.minWsol9.toString(),
      estMsol9: q.estMsol9.toString(),
      solPerMsol: (1 / msolPerSol).toFixed(4),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
