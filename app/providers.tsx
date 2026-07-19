"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia, arbitrumSepolia, baseSepolia, avalancheFuji, polygonAmoy } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { useState } from "react";
import { ROME_CHAIN } from "@/src/rome/rome-config";

/**
 * Source chains = the CCTP-proven inbound set. MetaMask (injected) is the
 * v0 connector — "connect my wallet" — WalletConnect QR lands with the
 * public deploy.
 */
export const SOURCE_CHAINS = [sepolia, arbitrumSepolia, baseSepolia, avalancheFuji, polygonAmoy] as const;

/**
 * Rome (Hadrian) as a wallet chain — self-custody signs its Rome legs with the user's OWN wallet, so
 * the wallet must know the chain. The UI does a one-time Add-Rome + switch (wagmi triggers
 * wallet_addEthereumChain from this def). chainId + rpcUrl are registry-sourced (ROME_CHAIN); gas is
 * 18-dp (Rome credits 1e18 = 1 gas). The symbol is a display-only flagged literal (principle #3
 * last-resort) until the registry carries the gas-token metadata.
 */
export const romeChain = defineChain({
  id: ROME_CHAIN.chainId,
  name: "Rome · Hadrian",
  nativeCurrency: { name: "Rome Gas", symbol: "RGAS", decimals: 18 }, // TODO: source symbol from registry
  rpcUrls: { default: { http: [ROME_CHAIN.rpcUrl] } },
});

const config = createConfig({
  chains: [...SOURCE_CHAINS, romeChain],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [baseSepolia.id]: http(),
    [avalancheFuji.id]: http(),
    [polygonAmoy.id]: http(),
    [romeChain.id]: http(ROME_CHAIN.rpcUrl),
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
