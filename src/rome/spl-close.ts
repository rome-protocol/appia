/**
 * SPL Token CloseAccount via the CPI precompile — the "unwrap" leg.
 *
 * Closing the user's wSOL ATA releases its ENTIRE lamport balance (wrapped
 * SOL + rent) to the owner (the user's Rome PDA), which is exactly the
 * lamports Marinade's deposit consumes next. Owner signs via Rome
 * (msg.sender == user ⇒ PDA auto-sign), same pattern as every Cardo leg.
 */
import type { Address, Hex } from "viem";
import type { AccountMeta } from "./cpi-precompile";
import { deriveAta, deriveRomeUserPda, pubkeyBs58ToBytes32, pubkeyToBytes32, SPL_TOKEN_PROGRAM_ID } from "./solana-pda";

const CLOSE_ACCOUNT_IX = "0x09" as Hex; // SPL Token instruction tag 9

export function buildCloseAccountInvoke(args: { userEvmAddress: Address; mintB58: string }): {
  program: Hex; accounts: AccountMeta[]; data: Hex;
} {
  const pda = deriveRomeUserPda(args.userEvmAddress);
  const ata = deriveAta(pda, pubkeyBs58ToBytes32(args.mintB58));
  return {
    program: pubkeyToBytes32(SPL_TOKEN_PROGRAM_ID),
    accounts: [
      { pubkey: ata, is_signer: false, is_writable: true },
      { pubkey: pda, is_signer: false, is_writable: true },
      { pubkey: pda, is_signer: true, is_writable: false },
    ],
    data: CLOSE_ACCOUNT_IX,
  };
}
