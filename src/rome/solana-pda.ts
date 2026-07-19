// Rome user identity on Solana: derive the user's Rome PDA + SPL ATAs
// entirely client-side. Mirrors the on-chain derivations in
// rome-solidity/contracts/rome_evm_account.sol (EXTERNAL_AUTHORITY seed)
// and AssociatedSplToken (ATA seed).
//
// These run in the browser. We pull `@solana/web3.js` purely for
// `PublicKey.findProgramAddressSync`; nothing here hits the network.

import { PublicKey } from '@solana/web3.js';
import type { Hex } from 'viem';
import { activeChain } from './rome-config';

// ---- Canonical Solana program ids (bs58 strings) ----

/// Rome EVM program id for the ACTIVE chain — registry-driven (was
/// hardcoded to the retired `DP1dshBz…` program, which made every user
/// PDA/ATA derivation wrong on the live chains: Hadrian uses
/// `RPTWwELX…`, Nerva `RomeTaTN…`). This program id is the seed program
/// for `PDA([EXTERNAL_AUTHORITY, userEoa], ROME_EVM_PROGRAM_ID)`, so it
/// MUST match the chain Rome auto-signs against or the derived PDA/ATAs
/// won't be the ones the precompile signs for. Source: registry
/// `chains/<id>/chain.json#romeEvmProgramId` via chain-config.
export const ROME_EVM_PROGRAM_ID = new PublicKey(activeChain().romeEvmProgramId);

/// Classic SPL Token program (Tokenkeg…).
export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

/// Associated Token program (ATokenGPvb…).
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/// Seed for Rome's external-authority PDA. Must match the byte sequence
/// used by the Rome EVM on-chain + rome-solidity RomeEVMAccount.pda().
export const EXTERNAL_AUTHORITY_SEED = Buffer.from('EXTERNAL_AUTHORITY');

// ---- Derivations ----

/// Derive the user's Rome external-authority PDA from their EVM address.
///
/// Matches `PDA([EXTERNAL_AUTHORITY, userEoaBytes], ROME_EVM_PROGRAM_ID)`.
/// This is the pubkey that owns the user's SPL ATAs and that Rome
/// auto-signs for when `msg.sender at cpi precompile == userEoa`.
///
/// Returns the 32-byte pubkey as a `0x…` hex for easy wiring into
/// bytes32-typed `AccountMeta.pubkey`.
export function deriveRomeUserPda(evmAddress: string): Hex {
  if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) {
    throw new Error(`invalid evm address for PDA derivation: ${evmAddress}`);
  }
  const userAddrBytes = Buffer.from(evmAddress.slice(2), 'hex');
  const [pda] = PublicKey.findProgramAddressSync(
    [EXTERNAL_AUTHORITY_SEED, userAddrBytes],
    ROME_EVM_PROGRAM_ID,
  );
  return pubkeyToBytes32(pda);
}

/// Derive the user's classic-SPL ATA for a given mint, given their Rome PDA.
/// PDA([ownerPda, TOKEN_PROGRAM, mint], ASSOCIATED_TOKEN_PROGRAM).
export function deriveAta(ownerPdaHex: Hex, mintHex: Hex): Hex {
  const owner = bytes32ToPublicKey(ownerPdaHex);
  const mint = bytes32ToPublicKey(mintHex);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return pubkeyToBytes32(ata);
}

/// Convenience: derive the user's ATA for a mint in one step.
export function deriveUserAta(evmAddress: string, mintHex: Hex): Hex {
  const userPda = deriveRomeUserPda(evmAddress);
  return deriveAta(userPda, mintHex);
}

// ---- Pubkey encoding helpers ----

/// bs58 pubkey → 0x-prefixed bytes32.
export function pubkeyBs58ToBytes32(bs58: string): Hex {
  return pubkeyToBytes32(new PublicKey(bs58));
}

/// PublicKey → 0x-prefixed bytes32.
export function pubkeyToBytes32(pk: PublicKey): Hex {
  return ('0x' + pk.toBuffer().toString('hex')) as Hex;
}

/// 0x-prefixed bytes32 → PublicKey (for re-derivation chains).
export function bytes32ToPublicKey(hex: Hex): PublicKey {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) {
    throw new Error(`bytes32 must be 32 bytes, got ${clean.length / 2}`);
  }
  return new PublicKey(Buffer.from(clean, 'hex'));
}
