const POD = process.env.BRIDGE_API_URL ?? "https://bridge-api.devnet.romeprotocol.xyz";

/** Register a transfer with the bridge pod (proxy: browser → same-origin). */
export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(`${POD}/v1/transfers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}

/** Poll a transfer: GET /api/pod/transfers?id=txf_… */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const upstream = await fetch(`${POD}/v1/transfers/${encodeURIComponent(id)}`);
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
