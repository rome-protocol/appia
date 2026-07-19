// Rome-only Meteora DAMM v1 pool constants used by the direct-precompile
// swap path.
//
// As of 2026-04-24 the canonical pair routes through the **canonical
// USDC ↔ WSOL pool on Solana devnet** (`YxX5pw3A…EEV2`). The legacy
// test pool (`CykBzSN…PhCLa`) used test mints (`testUSDC-A`, `testWSOL-B`)
// and is preserved at the bottom of this file for back-compat with
// the older test-token wrappers.
//
// IMPORTANT:
//   - In the canonical pool, **token A is WSOL** (9dp) and **token B is USDC** (6dp).
//     This is the lexicographic ordering Meteora's factory enforces — WSOL's
//     mint (`So11…112`) sorts before USDC's mint (`4zMM…ncDU`).
//     The legacy test pool happened to have A=USDC, B=WSOL because its test
//     USDC mint sorted before the test WSOL mint. The swap encoder picks the
//     direction based on the source/destination mints, so the A/B flip is
//     handled symmetrically.
//
// Notes on representation:
//   - Every `bytes32` here is a 0x-prefixed 32-byte hex encoding of a
//     Solana pubkey. They plug directly into `AccountMeta.pubkey`.
//   - The actual Meteora DAMM v1 program id is `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB`.

import type { Hex } from 'viem';

/// Meteora DAMM v1 program pubkey. Devnet == mainnet.
/// bs58: Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB
export const METEORA_DAMMV1_PROGRAM: Hex =
  '0xccf802d4cccc84d7fb21b5f73b49d81a16c5b4c88ee32394e1c91d3588cc4080';

/// `sha256("global:swap")[0..8]` — Anchor instruction discriminator.
/// Pinned to the value golden-tested in tests/MeteoraSwapProgram.test.ts.
export const METEORA_SWAP_DISC: Hex = '0xf8c69e91e17587c8';

/// Canonical Rome DAMM v1 pool — USDC (Circle devnet) ↔ WSOL (canonical).
///   bs58 pool:        YxX5pw3A5orw68fqJE7ZzqbKfdbm6WWcL5E57A4EEV2
///   tokenAMint = WSOL (So11…112) — A side
///   tokenBMint = USDC (4zMM…ncDU) — B side
/// Used by the WUSDC ↔ WWSOL pair on Cardo /swap.
export const ROME_METEORA_POOL = {
  pool: '0x082fc7be5e0c80e982088b28ce1136451d0ef7d70cb19e9b03c4e4e4dc1cc785' as Hex,
  aVault: '0xd3742176b89c5e14c96b748998421f38101e09e5c59331b168b625cd2715bb26' as Hex,
  bVault: '0x7ddd69be7e8ccb013532108994bf543de518d8128d918648af8ee02f8d37965a' as Hex,
  aVaultLp: '0x997375854d6761125996719d0334c721553acaaed571a8050dff4e2df9d31770' as Hex,
  bVaultLp: '0x1422a93425b5254e7baef914362870a2c40e0b71224bdea6a3d71c24989d3a64' as Hex,
  aTokenVault: '0xf617cd4510af70c761920499f8fe97d5b2311a69e19a17683ca2aaa48bec9a7d' as Hex,
  bTokenVault: '0xc35bb351211ae9942fede7524fbbadcec7589c4631cccfc48d9ac39bc2177d45' as Hex,
  aVaultLpMint: '0x02cca2aaece19457f1f3d1f73f1b86f47d7a17838b0b9ad4a00320a6829e30fe' as Hex,
  bVaultLpMint: '0x3b76fdb7daa0a4a46a24db5718f13aaf0a314fdf57b279dae22fbbf51464fc7a' as Hex,
  vaultProgram: '0x0fbfe8846d685cbdc62cca7e04c7e8f68dcc313ab31277e2e0112a2ec0e052e5' as Hex,
  tokenProgram: '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9' as Hex,
  protocolTokenAFee:
    '0x11a9fb2e981532647daa81551de89b82f12aab094fafdd8e83b5d3ae84886fdc' as Hex,
  protocolTokenBFee:
    '0xb04994e5fe134f16a1164a658e1a31f6e83de343f265a743161de62140849a21' as Hex,
  splMintA: '0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001' as Hex, // WSOL
  splMintB: '0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7' as Hex, // USDC
} as const;

/// User-created USDC ↔ WSOL pool at 4.0% fee tier (created 2026-04-24
/// by `/pool/new` from EOA `0x3403e0De…`).
///
///   bs58 pool:        8qsPLsiKRtH5Wa7XwdsYP7jpRwnGLs82jdx3xnMSa9uJ
///   tokenAMint = USDC (4zMM…ncDU) — A side  ← caller's chosen order
///   tokenBMint = WSOL (So11…112)  — B side
///
/// IMPORTANT: A/B labels are FLIPPED relative to the canonical 25-bps
/// pool. Meteora doesn't enforce A=larger-mint; it just sorts in the
/// pool PDA seed. The caller (us, via `derivePoolCreateAddresses`)
/// picks A vs B at init time, so it's whatever the form's "Token A"
/// dropdown was set to. Our /pool/new defaults to fromTok=USDC,
/// toTok=WSOL → A=USDC.
export const ROME_METEORA_POOL_400BPS = {
  pool: '0x7486a877255c719ee314bebf60ffcc608d61d49308c51d6761d9e69fca8badf1' as Hex,
  aVault: '0x7ddd69be7e8ccb013532108994bf543de518d8128d918648af8ee02f8d37965a' as Hex, // USDC vault
  bVault: '0xd3742176b89c5e14c96b748998421f38101e09e5c59331b168b625cd2715bb26' as Hex, // WSOL vault
  aVaultLp: '0xb838515dd19c8881fcef2992494a6829c85bc1f96de626e4bdd9a1b0be2b4d84' as Hex,
  bVaultLp: '0x0a2156ac8081e709692ce9d5ebbe850597e9aa39e88894c11754db60b0ca9923' as Hex,
  aTokenVault: '0xc35bb351211ae9942fede7524fbbadcec7589c4631cccfc48d9ac39bc2177d45' as Hex,
  bTokenVault: '0xf617cd4510af70c761920499f8fe97d5b2311a69e19a17683ca2aaa48bec9a7d' as Hex,
  aVaultLpMint: '0x3b76fdb7daa0a4a46a24db5718f13aaf0a314fdf57b279dae22fbbf51464fc7a' as Hex, // USDC vault LP mint (PDA-derived)
  bVaultLpMint: '0x02cca2aaece19457f1f3d1f73f1b86f47d7a17838b0b9ad4a00320a6829e30fe' as Hex, // WSOL vault LP mint (legacy non-PDA)
  vaultProgram: '0x0fbfe8846d685cbdc62cca7e04c7e8f68dcc313ab31277e2e0112a2ec0e052e5' as Hex,
  tokenProgram: '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9' as Hex,
  protocolTokenAFee:
    '0x49adddd479cdb24d8eccc0ba94e49e6fe65d6f8ff010f0adb6beb47c216a9ce0' as Hex, // ["fee", USDC, pool]
  protocolTokenBFee:
    '0xac4271af0bd1ab0a3dc264cd56748feb38c9b37bfb8d530f66fe76e2bd19591c' as Hex, // ["fee", WSOL, pool]
  splMintA: '0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7' as Hex, // USDC
  splMintB: '0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001' as Hex, // WSOL
} as const;

/// USDC ↔ mSOL pool (real devnet Marinade mSOL, 0.25% tier). Seeded
/// 2026-07-05 via the CPI pool-init flow (30 USDC + 0.4 mSOL from the
/// e2e treasury PDA). mSOL is mintable in-product: /stake-marinade
/// deposits SOL and the minted mSOL lands in the user's PDA ATA, ready
/// to swap here.
///   bs58 pool: 6jCS2qp8a68z3qR2ZaFBtaQSPDct4K5Ag4Jaiqeu6uai
///   tokenAMint = USDC (4zMM…ncDU) — A side
///   tokenBMint = mSOL (mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So), 9dp
/// NOTE bVaultLpMint is the on-chain value read from the pre-existing
/// devnet mSOL vault (legacy non-PDA lp_mint — same class of artifact
/// as the WSOL vault; see scripts/wormhole-lst/derive-pool-consts.ts).
export const ROME_METEORA_POOL_USDC_MSOL = {
  pool: '0x5519c11cacf1abbdc41f102cf24e8094f10d6c8d24a27357868187cc6f55e69b' as Hex,
  aVault: '0x7ddd69be7e8ccb013532108994bf543de518d8128d918648af8ee02f8d37965a' as Hex,
  bVault: '0x740ca89675e5a15da7ccbc2572d26e715bea81fe457d1ac384e75ee2b4669f34' as Hex,
  aVaultLp: '0xfb324fd618225d8d873aaf8558e64953d32539d8a27bf7e57a5ace33e74d3da2' as Hex,
  bVaultLp: '0x1b0198bfffbdede01cb26d29b81487f531741622e9714923e499e2c80299be86' as Hex,
  aTokenVault: '0xc35bb351211ae9942fede7524fbbadcec7589c4631cccfc48d9ac39bc2177d45' as Hex,
  bTokenVault: '0x2863f0074c337468a397bc5928577f15650a36f8c89940ffadbd1231af849793' as Hex,
  aVaultLpMint: '0x3b76fdb7daa0a4a46a24db5718f13aaf0a314fdf57b279dae22fbbf51464fc7a' as Hex,
  bVaultLpMint: '0x7001a581accf0a08c77b528e23d46f2e6af6c00852357744defe068abc755cdd' as Hex,
  vaultProgram: '0x0fbfe8846d685cbdc62cca7e04c7e8f68dcc313ab31277e2e0112a2ec0e052e5' as Hex,
  tokenProgram: '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9' as Hex,
  protocolTokenAFee: '0x80e0c10df3abafe7c04b459dbf9b1c51ddb736d495e0c9152d5e4498804a31da' as Hex,
  protocolTokenBFee: '0xb5ef326bfde1905c248f65b2539270acea985ca5cd22df8852970b3f22c067e7' as Hex,
  splMintA: '0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7' as Hex, // USDC
  splMintB: '0x0b62ba074f722c9d4114f2d8f70a00c66002337b9bf90c873657a6d201db4c80' as Hex, // mSOL
} as const;

/// USDC ↔ wJitoSOL pool (Wormhole-wrapped JitoSOL, 0.25% tier). No
/// mintable Jito stake pool exists on Solana devnet (the J1toso1…
/// devnet mint is a third-party restaking replica with zero DEX
/// liquidity), so Cardo's JitoSOL is the canonical Wormhole-wrapped
/// asset: Sepolia origin ERC-20 0x46FF8Fc923908d3F99b6C1392c2c24bfBDfb8c6b
/// (chain 10002), bridged in via the Wormhole Token Bridge. 8dp.
///   bs58 pool: 7GDV5GyEdKzFZLWuSncfAjzpowRe8ZMKsNddoqb3xZyq
///   tokenAMint = USDC (4zMM…ncDU) — A side
///   tokenBMint = wJitoSOL (8uz9RSxeKQxS1q3Cvs8xzNDTapUdJWRZhcHG2GegEtMS)
export const ROME_METEORA_POOL_USDC_WJITOSOL = {
  pool: '0x5d0bf30df03058c1d641236a908851088369d98da2f3ac6c6f9a00341381e858' as Hex,
  aVault: '0x7ddd69be7e8ccb013532108994bf543de518d8128d918648af8ee02f8d37965a' as Hex,
  bVault: '0xed07925cd6752b92a9b2068b8f2a8b99c38556eaa2086f1304a043221686618c' as Hex,
  aVaultLp: '0xeb904f8eb7fb45e0572afb6c5d2a7166274bac3486cfd6bf89ffdf2d95f0a3c4' as Hex,
  bVaultLp: '0xc5a7ec99f0cdc4dad4d2a61578f7c0a3fd31335e6776e335ddeb9f954ef113f6' as Hex,
  aTokenVault: '0xc35bb351211ae9942fede7524fbbadcec7589c4631cccfc48d9ac39bc2177d45' as Hex,
  bTokenVault: '0xddbc79a61b950d5a9b83317bf46f04d805773a38fbc0fb409c88f692941faf98' as Hex,
  aVaultLpMint: '0x3b76fdb7daa0a4a46a24db5718f13aaf0a314fdf57b279dae22fbbf51464fc7a' as Hex,
  bVaultLpMint: '0x5ae22c220bf9450647fc4ac41ba93617d342f52836b70415dc9e9404b0b40c1a' as Hex,
  vaultProgram: '0x0fbfe8846d685cbdc62cca7e04c7e8f68dcc313ab31277e2e0112a2ec0e052e5' as Hex,
  tokenProgram: '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9' as Hex,
  protocolTokenAFee: '0xdca46fcabfeee957bec923a9488e5e974ad5fb81e12da5900c3e6cd5a22edfe6' as Hex,
  protocolTokenBFee: '0xed4c374ba0dda0c25de39f565674cc51197fe761e2a01a20497d5885d4066b71' as Hex,
  splMintA: '0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7' as Hex, // USDC
  splMintB: '0x75949ff5663966b2ba38debcae9a733b9011895e2fce0fc643279d4f022ed7a5' as Hex, // wJitoSOL
} as const;

/// Registry of every DAMM v1 pool routable from Cardo /swap on Rome.
/// Pair-generic: /swap filters entries by matching splMintA/B against
/// the selected token pair, so one array carries every pair. `label`
/// is the fee-tier chip text.
export const ROME_METEORA_POOLS: ReadonlyArray<{
  feeBps: number;
  label: string;
  pool: typeof ROME_METEORA_POOL;
}> = [
  { feeBps: 25, label: '0.25%', pool: ROME_METEORA_POOL },
  { feeBps: 400, label: '4.0%', pool: ROME_METEORA_POOL_400BPS },
  { feeBps: 25, label: '0.25%', pool: ROME_METEORA_POOL_USDC_MSOL },
  { feeBps: 25, label: '0.25%', pool: ROME_METEORA_POOL_USDC_WJITOSOL },
];


/// @deprecated Legacy Rome DAMM v1 pool (test USDC-A / test WSOL-B).
/// Kept for back-compat with the test wrappers at 0x1be9…3533 and
/// 0xC407…3F70. Not used by the current /swap UI — the canonical
/// WUSDC ↔ WWSOL pair routes through ROME_METEORA_POOL above.
///   bs58 pool: CykBzSNzQXWaWx3f2LopuT7DGg8vUd6p7mcpHh6PhCLa
export const ROME_METEORA_POOL_LEGACY = {
  pool: '0xb1f9ea7f7d2a0c8ed492515ff3d960d52d9474929198a25bb9208e0144c625bb' as Hex,
  aVault: '0x7ddd69be7e8ccb013532108994bf543de518d8128d918648af8ee02f8d37965a' as Hex,
  bVault: '0xd3742176b89c5e14c96b748998421f38101e09e5c59331b168b625cd2715bb26' as Hex,
  aVaultLp: '0x7e22953d10f18025edf7cdc25db1e96ce1c025e3731a7ce288739617571d10e9' as Hex,
  bVaultLp: '0x07289b523e2b1125595f54708555d752cdc9837ffac61fa4446e2cb90b683d1c' as Hex,
  aTokenVault: '0xc35bb351211ae9942fede7524fbbadcec7589c4631cccfc48d9ac39bc2177d45' as Hex,
  bTokenVault: '0xf617cd4510af70c761920499f8fe97d5b2311a69e19a17683ca2aaa48bec9a7d' as Hex,
  aVaultLpMint: '0x3b76fdb7daa0a4a46a24db5718f13aaf0a314fdf57b279dae22fbbf51464fc7a' as Hex,
  bVaultLpMint: '0x02cca2aaece19457f1f3d1f73f1b86f47d7a17838b0b9ad4a00320a6829e30fe' as Hex,
  vaultProgram: '0x0fbfe8846d685cbdc62cca7e04c7e8f68dcc313ab31277e2e0112a2ec0e052e5' as Hex,
  tokenProgram: '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9' as Hex,
  protocolTokenAFee:
    '0xc42538562b7511ff730b13d61357f55ae2fcd724759b7d3e3453a5609fe99e5e' as Hex,
  protocolTokenBFee:
    '0x4fed32a414f400fef69947b252bd2253ac9353e96fde2c0a3ab1b578bf49c442' as Hex,
  splMintA: '0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7' as Hex, // test USDC == Circle USDC
  splMintB: '0x069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001' as Hex, // test WSOL == canonical WSOL
} as const;
