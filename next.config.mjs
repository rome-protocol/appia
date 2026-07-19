/** @type {import('next').NextConfig} */
// wagmi's connector barrel imports OPTIONAL deps we don't use (coinbase, base,
// metamask-sdk, porto) + a dynamic 'accounts' import. None are installed;
// alias them away so only injected() compiles.
const OPTIONAL = ["accounts", "@base-org/account", "@coinbase/wallet-sdk", "@metamask/connect-evm", "porto", "porto/internal"];
export default {
  reactStrictMode: true,
  output: "standalone", // lean standalone server: .next/standalone/server.js
  turbopack: { resolveAlias: Object.fromEntries(OPTIONAL.map((m) => [m, "./src/empty-module.ts"])) },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...Object.fromEntries(OPTIONAL.map((m) => [m, false])) };
    return config;
  },
};
