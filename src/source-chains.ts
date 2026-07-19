/**
 * Supported bridge-source L2s (CCTP). The connected wallet's chain IS the source — no picker (design
 * spec). Stake/Swap bridge USDC in from the connected L2, so it must be one of these; otherwise the flow
 * prompts to switch. Kept as ids (the wagmi chain objects live in app/providers).
 */
export const SUPPORTED_SOURCE_IDS = [11155111, 421614, 84532, 43113, 80002] as const;

export function isSupportedSource(chainId: number | undefined): boolean {
  return chainId != null && (SUPPORTED_SOURCE_IDS as readonly number[]).includes(chainId);
}

/** Display names for the supported sources — powers the helpful "these chains are supported, connect
 *  with any of these" message (shown pre-connect / on an unsupported chain), instead of a vague nag. */
export const SOURCE_CHAIN_NAMES: Record<number, string> = {
  11155111: "Ethereum Sepolia",
  421614: "Arbitrum Sepolia",
  84532: "Base Sepolia",
  43113: "Avalanche Fuji",
  80002: "Polygon Amoy",
};

export function supportedSourceNames(): string[] {
  return SUPPORTED_SOURCE_IDS.map((id) => SOURCE_CHAIN_NAMES[id] ?? `Chain ${id}`);
}
