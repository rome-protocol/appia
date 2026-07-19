/**
 * New Rome leg builders (TDD): the SPL CloseAccount (unwrap wSOL → lamports)
 * invoke — the ONE leg of the Earn journey not already covered by a
 * proven-on-chain Cardo builder — plus the quote-composition math.
 */
import { describe, it, expect } from "vitest";
import { buildCloseAccountInvoke } from "../src/rome/spl-close.js";
import { composeEarnQuote } from "../src/quote-math.js";
import { deriveRomeUserPda, deriveAta, pubkeyBs58ToBytes32, bytes32ToPublicKey } from "../src/rome/solana-pda.js";

const USER = "0x2cD347E873424Ad72B1D4bB2c17D21BA6124B5f9" as const;
const WSOL = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_B32 = pubkeyBs58ToBytes32("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("spl close-account invoke (unwrap wSOL)", () => {
  it("targets SPL Token with data [9] and [ata(w), pda(w), pda(signer)]", () => {
    const inv = buildCloseAccountInvoke({ userEvmAddress: USER, mintB58: WSOL });
    expect(inv.program).toBe(SPL_TOKEN_B32);
    expect(inv.data).toBe("0x09");
    const pda = deriveRomeUserPda(USER);
    const ata = deriveAta(pda, pubkeyBs58ToBytes32(WSOL));
    expect(inv.accounts).toEqual([
      { pubkey: ata, is_signer: false, is_writable: true },
      { pubkey: pda, is_signer: false, is_writable: true },
      { pubkey: pda, is_signer: true, is_writable: false },
    ]);
    // sanity: derivations produce real base58 pubkeys
    expect(bytes32ToPublicKey(ata).toBase58().length).toBeGreaterThan(30);
  });
});

describe("earn quote composition", () => {
  it("chains bridge-out → pool constant-product → marinade rate, honestly floored", () => {
    const q = composeEarnQuote({
      bridgedUsdc6: 49_990_000n,          // pod amountOut after bridge fee
      feeUsdc6: 1_000_000n,               // appia fee (taken pre-swap)
      poolUsdcReserve6: 207_025_505n,     // live shape: ~207 USDC
      poolWsolReserve9: 26_765_661_109_665n, // ~26,765 wSOL (devnet pool skew)
      poolFeeBps: 25,
      msolPerSol: 1 / 1.0014,
      slippageBps: 100,
    });
    // swapIn = bridged - fee
    expect(q.swapInUsdc6).toBe(48_990_000n);
    expect(q.estWsol9 > 0n).toBe(true);
    expect(q.minWsol9 < q.estWsol9).toBe(true);
    expect(q.estMsol9 < q.estWsol9).toBe(true); // rate < 1 mSOL per SOL
  });

  it("throws when the fee eats the bridged amount", () => {
    expect(() => composeEarnQuote({
      bridgedUsdc6: 900_000n, feeUsdc6: 1_000_000n,
      poolUsdcReserve6: 1n, poolWsolReserve9: 1n, poolFeeBps: 25,
      msolPerSol: 1, slippageBps: 100,
    })).toThrow(/fee exceeds bridged amount/);
  });
});
