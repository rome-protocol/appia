/**
 * Pure view-model for the live /lend page. Turns the user's current inputs + on-chain
 * reads into an honest render state — no I/O, fully unit-tested. Custody note: lending is self-custody
 * throughout (the user's Rome PDA owns the Mango position); nothing here can move funds.
 *
 * Honesty contract:
 *  - `supplied9 === null` means the reader (fetchMangoSolDeposited) couldn't read+validate the position;
 *    we then hide it (no position, not withdrawable) rather than fabricate a number.
 *  - "needs SOL" only when there's nothing to supply AND nothing supplied (→ send them to /swap).
 *  - never supply more than the wallet holds; never withdraw more than supplied.
 */
export type LendMode = "supply" | "withdraw";

export interface LendView {
  /// Supplied SOL in native (9dp); 0 when none or unreadable.
  supplied9: bigint;
  /// false when the reader returned null — we couldn't read+validate the Mango position.
  suppliedKnown: boolean;
  /// wSOL (9dp) available in the wallet to supply.
  walletWsol9: bigint;
  /// a real, positive supplied position exists.
  hasPosition: boolean;
  /// nothing to supply and nothing supplied → prompt the user to get SOL first (/swap).
  needsSol: boolean;
  /// the current mode's action is valid to submit.
  canSubmit: boolean;
  /// validation message for the current mode/amount (null = fine or simply empty).
  error: string | null;
  /// the max withdrawable (= supplied); 0 when unknown/none.
  maxWithdraw9: bigint;
}

export function buildLendView(args: {
  mode: LendMode;
  amount9: bigint;
  walletWsol9: bigint;
  supplied9: bigint | null;
}): LendView {
  const suppliedKnown = args.supplied9 !== null;
  const supplied9 = args.supplied9 ?? 0n;
  const hasPosition = suppliedKnown && supplied9 > 0n;
  const needsSol = args.walletWsol9 === 0n && !hasPosition;

  let canSubmit = false;
  let error: string | null = null;

  if (args.mode === "supply") {
    if (args.amount9 > args.walletWsol9) {
      error = "That's more than your wallet balance.";
    } else if (args.amount9 > 0n) {
      canSubmit = true;
    }
  } else {
    // withdraw
    if (!suppliedKnown) {
      error = "We couldn't read your Mango position right now.";
    } else if (args.amount9 > supplied9) {
      error = "That's more than you supplied.";
    } else if (args.amount9 > 0n) {
      canSubmit = true;
    }
  }

  return {
    supplied9,
    suppliedKnown,
    walletWsol9: args.walletWsol9,
    hasPosition,
    needsSol,
    canSubmit,
    error,
    maxWithdraw9: supplied9,
  };
}
