import { ROME_CHAIN } from "@/src/rome/rome-config";

/** Server-side Rome RPC proxy (same pattern as cardo /api/rpc/rome). */
export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(process.env.ROME_RPC_URL ?? ROME_CHAIN.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
