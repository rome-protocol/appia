/**
 * Wallet shim — an EIP-1193 window.ethereum backed by a real key, so
 * Playwright can drive the injected() connector and actually sign + broadcast.
 * The Cardo funded-e2e pattern: the browser provider forwards every call to a
 * node-side handler (page.exposeFunction) that signs with viem and hits each
 * chain's real RPC. No MetaMask extension needed.
 */
import type { Page } from "@playwright/test";
import { createWalletClient, createPublicClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, arbitrumSepolia, baseSepolia, avalancheFuji, polygonAmoy } from "viem/chains";

const CHAINS = { 11155111: sepolia, 421614: arbitrumSepolia, 84532: baseSepolia, 43113: avalancheFuji, 80002: polygonAmoy } as const;

export async function installWalletShim(page: Page, privateKey: Hex, initialChainId = 11155111) {
  const account = privateKeyToAccount(privateKey);
  let chainId = initialChainId;

  const clientFor = (id: number) => {
    const chain = CHAINS[id as keyof typeof CHAINS];
    if (!chain) throw new Error(`shim: unsupported chain ${id}`);
    return {
      wallet: createWalletClient({ account, chain, transport: http() }),
      pub: createPublicClient({ chain, transport: http() }),
    };
  };

  // node-side EIP-1193 handler
  await page.exposeFunction("__shimRequest", async (method: string, params: unknown[]) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return "0x" + chainId.toString(16);
      case "net_version":
        return String(chainId);
      case "wallet_switchEthereumChain": {
        const target = Number((params[0] as { chainId: string }).chainId);
        chainId = target;
        return null;
      }
      case "eth_sendTransaction": {
        const p = params[0] as { to: Hex; data?: Hex; value?: Hex; from?: Hex };
        const { wallet, pub } = clientFor(chainId);
        const hash = await wallet.sendTransaction({
          account, chain: wallet.chain, to: p.to,
          data: p.data, value: p.value ? BigInt(p.value) : 0n,
        });
        await pub.waitForTransactionReceipt({ hash });
        return hash;
      }
      case "personal_sign": {
        const msg = params[0] as Hex;
        return account.signMessage({ message: { raw: msg } });
      }
      case "eth_getBalance":
      case "eth_call":
      case "eth_getTransactionByHash":
      case "eth_getTransactionReceipt":
      case "eth_blockNumber":
      case "eth_estimateGas":
      case "eth_gasPrice":
      case "eth_getTransactionCount":
      case "eth_maxPriorityFeePerGas": {
        const { pub } = clientFor(chainId);
        return pub.request({ method: method as never, params: params as never });
      }
      default:
        return null;
    }
  });

  // Browser-side provider forwarding to the node handler. Injected as a raw
  // STRING (not a tsx-transpiled fn — that injects a `__name` helper that's
  // undefined in the page and kills the script before window.ethereum sets).
  await page.addInitScript(`(() => {
    const listeners = {};
    const provider = {
      isMetaMask: true,
      request: ({ method, params }) => window.__shimRequest(method, params || []),
      on: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); },
      removeListener: (ev, cb) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb); },
    };
    window.ethereum = provider;
    const info = { uuid: "appia-shim", name: "Appia Shim", icon: "data:image/svg+xml,<svg/>", rdns: "xyz.romeprotocol.appia.shim" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  })();`);

  return { address: account.address, setChain: (id: number) => { chainId = id; } };
}
