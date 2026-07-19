// Mango v4 PDA derivations. Source: blockworks-foundation/mango-v4 + IDL.
// Lifted verbatim from Cardo lib/mango-pdas.ts.

import { PublicKey } from '@solana/web3.js';
import type { Hex } from 'viem';
import { bytes32ToPublicKey, pubkeyToBytes32 } from './solana-pda';
import { MANGO_ACCOUNT_SEED, MANGO_V4_PROGRAM } from './mango-program';

/// MangoAccount PDA —
/// PDA(["MangoAccount", group, owner, account_num_le_u32], MANGO_V4_PROGRAM).
///
/// `account_num` (u32 LE in the seed) lets a single owner hold many
/// MangoAccounts under the same group; Appia defaults to 0 (the first).
export function deriveMangoAccount(args: {
  groupHex: Hex;
  ownerHex: Hex;
  accountNum?: number;
}): Hex {
  const program = bytes32ToPublicKey(MANGO_V4_PROGRAM);
  const group = bytes32ToPublicKey(args.groupHex);
  const owner = bytes32ToPublicKey(args.ownerHex);
  const numLe = Buffer.alloc(4);
  numLe.writeUInt32LE(args.accountNum ?? 0, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [MANGO_ACCOUNT_SEED, group.toBuffer(), owner.toBuffer(), numLe],
    program,
  );
  return pubkeyToBytes32(pda);
}
