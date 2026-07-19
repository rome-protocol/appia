// Meteora DAMM v1 swap, encoded for the Rome CPI precompile.
//
// The live MeteoraCpiAdapter on Rome is blocked by an adapter/backend
// signer-mismatch bug. The fix is to bypass the
// adapter: call the CPI precompile directly from the user's EOA. Because
// `msg.sender at precompile == userEoa`, Rome auto-signs for
// `PDA(EXTERNAL_AUTHORITY, userEoa)`, which also owns the user's SPL
// ATAs. Meteora's swap instruction validates the signer is the user,
// reads from the user source ATA, writes into the user destination ATA,
// and everything lines up.
//
// Wire layout (must match the Anchor IDL field order of dynamic-amm's
// `Swap<'info>` — see rome-sdk/rome-meteora/src/dammv1/dynamic-amm/src/instructions/swap.rs
// and `accounts::Swap::to_account_metas` in the Rust adapter):
//
//   instruction.data = SWAP_DISC ++ u64le(in_amount) ++ u64le(minimum_out_amount)
//
//   accounts (15):
//     [ 0] pool                    writable
//     [ 1] user_source_token       writable (user's source-mint ATA)
//     [ 2] user_destination_token  writable (user's dest-mint ATA)
//     [ 3] a_vault                 writable
//     [ 4] b_vault                 writable
//     [ 5] a_token_vault           writable
//     [ 6] b_token_vault           writable
//     [ 7] a_vault_lp_mint         writable
//     [ 8] b_vault_lp_mint         writable
//     [ 9] a_vault_lp              writable
//     [10] b_vault_lp              writable
//     [11] protocol_token_fee      writable
//     [12] user                    signer, readonly (user's Rome PDA)
//     [13] vault_program           readonly (executable)
//     [14] token_program           readonly (executable)
//
// This intentionally differs from rome-solidity's
// `MeteoraDammV1Swap.buildAccountMetas` (which jumbles the middle slots
// and places protocol_token_fee at [14]). The rome-solidity order trips
// Anchor's `ConstraintExecutable` (error 3007) when the Mollusk
// emulator runs it because protocol_token_fee lands in the
// `token_program` slot — and protocol_token_fee is not executable. The
// live adapter ships with that bug; the direct-precompile path uses the
// canonical Anchor order and has been golden-verified via
// `rome_emulateTx` on Rome (scripts/verify-swap.mjs).

import { concat, numberToHex, type Address, type Hex } from 'viem';
import type { AccountMeta } from './cpi-precompile';
import { deriveUserAta, deriveRomeUserPda } from './solana-pda';
import {
  ROME_METEORA_POOL,
  METEORA_DAMMV1_PROGRAM,
  METEORA_SWAP_DISC,
} from './meteora-pool';

/// Resolved invoke arguments ready to pass into `writeContract({ args: [program, accounts, data] })`.
export type MeteoraSwapInvoke = {
  program: Hex;
  accounts: AccountMeta[];
  data: Hex;
};

/// Side of the swap: "A→B" (input is token A, output is token B) or "B→A".
export type SwapDirection = 'AToB' | 'BToA';

/// Little-endian u64 encoder — matches AnchorInstruction.u64le.
export function toU64Le(value: bigint): Hex {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`u64 out of range: ${value}`);
  }
  // `numberToHex(..., { size: 8 })` is big-endian; reverse to LE.
  const beHex = numberToHex(value, { size: 8 }).slice(2); // 16 chars
  const bytes: string[] = [];
  for (let i = beHex.length; i > 0; i -= 2) {
    bytes.push(beHex.slice(i - 2, i));
  }
  return ('0x' + bytes.join('')) as Hex;
}

/// Encode the Meteora swap Anchor instruction data:
///   disc(8) || u64le(in_amount) || u64le(minimum_out_amount)
export function encodeMeteoraSwapData(
  inAmount: bigint,
  minimumOutAmount: bigint,
): Hex {
  return concat([
    METEORA_SWAP_DISC,
    toU64Le(inAmount),
    toU64Le(minimumOutAmount),
  ]);
}

/// Build the 15 AccountMeta entries for the swap instruction.
/// Order + flags mirror the canonical Anchor IDL field order of
/// `dynamic_amm::accounts::Swap` (see rome-sdk/rome-meteora/src/dammv1/dynamic-amm/src/instructions/swap.rs).
/// See the module header for why this intentionally differs from
/// rome-solidity's `build_swap_account_metas`.
export function buildMeteoraSwapAccounts(args: {
  pool: Hex;
  userSourceToken: Hex;
  userDestinationToken: Hex;
  aVault: Hex;
  bVault: Hex;
  aTokenVault: Hex;
  bTokenVault: Hex;
  aVaultLpMint: Hex;
  bVaultLpMint: Hex;
  aVaultLp: Hex;
  bVaultLp: Hex;
  protocolTokenFee: Hex;
  user: Hex;
  vaultProgram: Hex;
  tokenProgram: Hex;
}): AccountMeta[] {
  return [
    { pubkey: args.pool, is_signer: false, is_writable: true },                  // [ 0]
    { pubkey: args.userSourceToken, is_signer: false, is_writable: true },       // [ 1]
    { pubkey: args.userDestinationToken, is_signer: false, is_writable: true },  // [ 2]
    { pubkey: args.aVault, is_signer: false, is_writable: true },                // [ 3]
    { pubkey: args.bVault, is_signer: false, is_writable: true },                // [ 4]
    { pubkey: args.aTokenVault, is_signer: false, is_writable: true },           // [ 5]
    { pubkey: args.bTokenVault, is_signer: false, is_writable: true },           // [ 6]
    { pubkey: args.aVaultLpMint, is_signer: false, is_writable: true },          // [ 7]
    { pubkey: args.bVaultLpMint, is_signer: false, is_writable: true },          // [ 8]
    { pubkey: args.aVaultLp, is_signer: false, is_writable: true },              // [ 9]
    { pubkey: args.bVaultLp, is_signer: false, is_writable: true },              // [10]
    { pubkey: args.protocolTokenFee, is_signer: false, is_writable: true },      // [11]
    { pubkey: args.user, is_signer: true, is_writable: false },                  // [12]  Rome auto-signs
    { pubkey: args.vaultProgram, is_signer: false, is_writable: false },         // [13]
    { pubkey: args.tokenProgram, is_signer: false, is_writable: false },         // [14]
  ];
}

/// Compose everything: resolve the user's PDA, compute both ATAs, pick
/// the right input/output mints + protocol fee side based on direction,
/// and return `{ program, accounts, data }` ready for wagmi.
///
/// `pool` defaults to the canonical 0.25% pool but can be overridden for
/// alternative fee-tier pools (different DAMM v1 PDAs, possibly with
/// flipped A/B labeling — see ROME_METEORA_POOL_400BPS for the
/// USDC-as-A example).
///
/// Throws if the EVM address can't be derived (malformed).
export function buildChainMeteoraSwapInvoke(args: {
  userEvmAddress: Address;
  direction: SwapDirection;
  amountIn: bigint;       // in token-decimals (USDC 6dp, WSOL 9dp)
  minimumOut: bigint;     // same decimals as output token
  pool?: typeof ROME_METEORA_POOL;
}): MeteoraSwapInvoke {
  const p = args.pool ?? ROME_METEORA_POOL;

  // Direction-specific pubkey selection. Fee is taken on the input side,
  // direction-specific pubkey selection.
  const [splIn, splOut, protocolFee] =
    args.direction === 'AToB'
      ? ([p.splMintA, p.splMintB, p.protocolTokenAFee] as const)
      : ([p.splMintB, p.splMintA, p.protocolTokenBFee] as const);

  const userPda = deriveRomeUserPda(args.userEvmAddress);
  const userSourceToken = deriveUserAta(args.userEvmAddress, splIn);
  const userDestinationToken = deriveUserAta(args.userEvmAddress, splOut);

  const accounts = buildMeteoraSwapAccounts({
    pool: p.pool,
    userSourceToken,
    userDestinationToken,
    aVaultLp: p.aVaultLp,
    bVaultLp: p.bVaultLp,
    aVault: p.aVault,
    bVault: p.bVault,
    aVaultLpMint: p.aVaultLpMint,
    bVaultLpMint: p.bVaultLpMint,
    aTokenVault: p.aTokenVault,
    bTokenVault: p.bTokenVault,
    user: userPda,
    vaultProgram: p.vaultProgram,
    tokenProgram: p.tokenProgram,
    protocolTokenFee: protocolFee,
  });

  const data = encodeMeteoraSwapData(args.amountIn, args.minimumOut);

  return {
    program: METEORA_DAMMV1_PROGRAM,
    accounts,
    data,
  };
}
