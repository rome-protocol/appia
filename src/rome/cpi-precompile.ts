// Rome CPI precompile ABI + a direct wagmi-friendly write handle.
//
// Background. Rome exposes arbitrary Solana CPI from EVM via a precompile
// at 0xFF00000000000000000000000000000000000008. An EVM tx whose `to` is
// that address is interpreted as `invoke(bytes32 program, AccountMeta[], bytes)`
// and routed into Solana. When `msg.sender` at the precompile is the user's
// EOA (not an EVM contract), Rome auto-signs for the user's
// `PDA([EXTERNAL_AUTHORITY, userEoaBytes], RomeEvmProgramId)` — matching
// the classic SPL ATA owner derivation. That is the signer-match Cardo
// relies on here.
//
// This module does NOT know about Meteora. It just ships the raw
// precompile constants + the `invoke` ABI so any adapter-free CPI
// flow can piggyback. Meteora-specific encoding lives in lib/meteora-swap.ts.

import type { Address, Hex } from 'viem';

/// Rome CPI precompile on every Rome EVM network.
export const CPI_PRECOMPILE: Address =
  '0xFF00000000000000000000000000000000000008';

/// ABI for `invoke(bytes32 program_id, AccountMeta[] accounts, bytes data)`.
/// AccountMeta field order matches `ICrossProgramInvocation.AccountMeta`
/// in rome-solidity/contracts/interface.sol:
///   { pubkey: bytes32; is_signer: bool; is_writable: bool }
export const CPI_INVOKE_ABI = [
  {
    name: 'invoke',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'program_id', type: 'bytes32' },
      {
        name: 'accounts',
        type: 'tuple[]',
        components: [
          { name: 'pubkey', type: 'bytes32' },
          { name: 'is_signer', type: 'bool' },
          { name: 'is_writable', type: 'bool' },
        ],
      },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/// `AccountMeta` as the precompile expects it.
export type AccountMeta = {
  pubkey: Hex;       // bytes32, bs58-decoded Solana pubkey
  is_signer: boolean;
  is_writable: boolean;
};
