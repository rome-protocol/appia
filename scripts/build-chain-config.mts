/**
 * Generates src/rome/chain-config.generated.json from rome-protocol/rome-registry.
 * Fetches FRESH from origin (gh api) — NOT a local clone: the live
 * RomeBridgeWithdraw pointer moved 8.0.0 -> 9.0.0 and a stale local clone still
 * shows the retired 8.0.0, which would regress native egress. Run at build/
 * deploy (and to refresh the committed snapshot). Requires `gh` auth to read
 * the public rome-registry.
 *
 *   npm run build:chain-config            # 200010-hadrian
 *   APPIA_CHAIN=<id-slug> npm run build:chain-config
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveRomeChain } from "../src/rome/chain-resolve.js";

const CHAIN = process.env.APPIA_CHAIN ?? "200010-hadrian";

function fetchOrigin(file: string): unknown {
  const b64 = execSync(
    `gh api repos/rome-protocol/rome-registry/contents/chains/${CHAIN}/${file}.json --jq .content`,
    { encoding: "utf8" },
  );
  return JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf8"));
}

const reg = {
  chain: fetchOrigin("chain") as never,
  contracts: fetchOrigin("contracts") as never,
  tokens: fetchOrigin("tokens") as never,
};
const resolved = resolveRomeChain(reg);
const out = {
  _generated: "by scripts/build-chain-config.mts from rome-protocol/rome-registry (origin, fresh). DO NOT EDIT — run `npm run build:chain-config`.",
  chainSlug: CHAIN,
  ...resolved,
};
writeFileSync(new URL("../src/rome/chain-config.generated.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote src/rome/chain-config.generated.json:", JSON.stringify(resolved));
