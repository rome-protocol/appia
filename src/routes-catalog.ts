/**
 * Proven-routes catalog gating — the UI offers ONLY routes with a green,
 * fresh funded-harness run. Monad (10143) has no Wormhole token bridge, so
 * any journey whose terminal delivers an asset via Wormhole (swap always
 * does) is never offered there; earn-keep exits via CCTP and is allowed.
 */
export type JourneyKind = "swap" | "earn";

export interface RouteHealth {
  chainId: number;
  journey: JourneyKind;
  lastVerifiedAt: string;
  p50DurationMin: number;
  minAmountUsdc: string;
  status: "green" | "red";
}

const MONAD_TESTNET = 10143;
const WORMHOLE_DELIVERY_JOURNEYS: ReadonlySet<JourneyKind> = new Set(["swap"]);

export function gateRoutes(
  routes: RouteHealth[],
  opts: { nowMs: number; maxAgeHours: number },
): RouteHealth[] {
  const cutoff = opts.nowMs - opts.maxAgeHours * 3_600_000;
  return routes.filter((r) => {
    if (r.status !== "green") return false;
    if (Date.parse(r.lastVerifiedAt) < cutoff) return false;
    if (r.chainId === MONAD_TESTNET && WORMHOLE_DELIVERY_JOURNEYS.has(r.journey)) return false;
    return true;
  });
}
