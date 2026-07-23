# Appia

> **Built on [Rome Protocol](https://docs.rome.builders)** — EVM chains that run natively inside the Solana runtime, where Solidity apps call Solana programs atomically (CPI) and Solana users drive EVM apps: two VMs, one chain, one block.

**Own Solana from the wallet you already have.** Appia is a positions-first, cross-VM DeFi app. Pay USDC from your own L2 — Arbitrum, Monad, or elsewhere — and Appia buys SOL and puts it to work on Solana: staked with Marinade, lent on Mango, swapped on Meteora. The position belongs to **your key**, not to Appia.

Self-custody only: your wallet is the Rome identity and signs every leg directly. There is no session key and no custody surface — nothing Appia or your browser holds can move your funds.

Live at **https://appia.devnet.romeprotocol.xyz**. Built with Next.js 15, TypeScript, and viem + wagmi for the EVM wallet.

## Why this works on Rome

- **Single state** — an EVM transaction settles against Solana protocols directly, with no bridge and no wrapped-asset hop. A token on Solana and its ERC-20 form are the same account.
- **Atomic CPI access** — Solidity calldata invokes Solana programs (Marinade, Mango, Meteora) atomically through Rome's CPI precompile, in one transaction.
- **Self-custody by construction** — the user's EOA calls the CPI precompile directly, so Rome signs as the PDA that owns the user's SPL accounts. Funds are only ever in the user's own PDA/ATA and are recoverable by the user alone.
- **From your home chain** — USDC arrives from an L2 over public cross-chain transport (Circle CCTP, Wormhole); users never leave the wallet they already have.

In Rome's terms, Appia is the **"from home"** pattern: reach a Rome app from your home chain and get to Solana without moving.

| You can | Where it lands on Solana |
|---|---|
| Pay USDC from your L2 → buy + stake SOL | Marinade (mSOL position in **your** PDA) |
| Swap | Meteora DAMM, via Rome CPI |
| Lend | Mango |
| Recover / claim positions | your key, always — no custody surface |

## What's in the repo

```
appia/
├── app/                            # Next.js App Router
│   ├── earn/                       # pay USDC from your L2 -> buy + stake SOL (Marinade)
│   ├── swap/                       # Meteora DAMM swaps via Rome CPI
│   ├── lend/  borrow/              # Mango lend / borrow
│   ├── claims/                     # recover / claim positions
│   └── api/                        # server routes (quotes, bridge status)
├── src/rome/                       # the Rome layer:
│   │                               #   CPI encoders, PDA derivation,
│   │                               #   registry-driven chain config, bridge wiring
│   ├── chain-resolve.ts            # pure resolver: registry -> chain config
│   ├── solana-pda.ts               # external-authority PDA + ATA derivation
│   ├── meteora-swap.ts             # Meteora swap, encoded for the Rome CPI precompile
│   └── marinade-program.ts         # Marinade staking program wiring
├── scripts/build-chain-config.mts  # regenerates the chain config from @rome-protocol/registry
├── tests/                          # unit tests (resolver, encoders)
└── e2e/                            # Playwright end-to-end journeys
```

Nothing is hard-coded: chain id, RPC, program id, token mints, and bridge addresses all resolve from the public [`@rome-protocol/registry`](https://github.com/rome-protocol/rome-registry) via `scripts/build-chain-config.mts` into a committed `src/rome/chain-config.generated.json`. Point it at another Rome chain and rebuild.

## Run & test

```bash
npm install
npm run build:chain-config   # regenerate chain config from @rome-protocol/registry
npm run dev                  # http://localhost:4700
npm test                     # vitest (resolver, encoders, guards)
npm run typecheck
npx playwright test          # e2e journeys (e2e/)
```

## License

Apache-2.0 — see [LICENSE](LICENSE). Appia is an original app; third-party protocol attributions (Marinade, Mango, Meteora, Wormhole, CCTP) are in [NOTICE](NOTICE).

## Learn more

- **[Rome Protocol documentation](https://docs.rome.builders)** — how EVM execution and CPI work inside Solana, and the four ways to build.
- Companion repos worth reading: [rome-dex](https://github.com/rome-protocol/rome-dex) (a dual-lane AMM), [cardo](https://github.com/rome-protocol/cardo) (EVM-side UI for Solana protocols), and the [`@rome-protocol/sdk`](https://github.com/rome-protocol/rome-sdk-ts).

## Building on Rome with an agent
See [`AGENTS.md`](./AGENTS.md) — the Rome-specific rules a coding agent needs.
