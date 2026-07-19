import { ROME_CHAIN } from "@/src/rome/rome-config";

/** Server-side Solana devnet RPC proxy (internal node; never exposed raw). */
export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(process.env.SOLANA_RPC_URL ?? ROME_CHAIN.solanaRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
