/**
 * Activity view-model. The Activity log presents what's reconstructable from chain TODAY —
 * the recoverable/in-flight items — in the log shape: rows with a type, a status
 * (in-flight / partial / done), an amount, an expandable story (journey legs), and one finish/resume
 * action. buildActivity maps the tested claim data (scanClaims → ClaimItem[], scanPendingRedeems →
 * PendingRedeem[]) into those rows. Full historical done-events (past swaps/stakes) need a tx indexer —
 * out of scope here (honest: we show what chain-truth gives now). Ordering: in-flight → partial → done.
 */
import { describe, it, expect } from "vitest";
import { buildActivity } from "../src/activity";
import type { ClaimItem } from "../src/claims";
import type { PendingRedeem } from "../src/bring-home";

const held: ClaimItem = { asset: "msol", amount: 8_187_770_315n, decimals: 9, claimState: "position-held", resumeLeg: null, canBringHome: false };
const partialSwap: ClaimItem = { asset: "usdc", amount: 1_200_000n, decimals: 6, claimState: "funds-in-pda", resumeLeg: "swap", canBringHome: true };
const partialStake: ClaimItem = { asset: "sol", amount: 100_000_000n, decimals: 9, claimState: "funds-in-pda", resumeLeg: "stake", canBringHome: true };
const pending: PendingRedeem = { vaa: "0xabcd", destChainId: 11155111, toChainWh: 10002, amount: 7431520n, tokenAddressHex: "0x00" };

describe("buildActivity — claim data → the filterable log rows", () => {
  it("a pending redeem → an in-flight bring-home row with a redeem action + the 3-leg story (III = now)", () => {
    const [r] = buildActivity([], [pending]);
    expect(r).toMatchObject({ type: "bring-home", status: "in-flight" });
    expect(r!.action).toMatchObject({ kind: "redeem" });
    expect(r!.action!.label).toMatch(/finish/i);
    expect(r!.legs.map((l) => l.status)).toEqual(["done", "done", "now"]); // sent-home, VAA, redeem-now
  });

  it("a mid-journey claim (resume=swap) → a partial row; legs before swap done, swap paused, rest pending", () => {
    const [r] = buildActivity([partialSwap], []);
    expect(r).toMatchObject({ status: "partial" });
    expect(r!.action).toMatchObject({ kind: "resume" });
    // journey legs: burn, delivered, swap, unwrap, stake
    expect(r!.legs.map((l) => l.status)).toEqual(["done", "done", "now", "pending", "pending"]);
  });

  it("resume=stake → burn/delivered/swap/unwrap done, stake paused", () => {
    const [r] = buildActivity([partialStake], []);
    expect(r!.legs.map((l) => l.status)).toEqual(["done", "done", "done", "done", "now"]);
  });

  it("a held mSOL position → a done stake row that can still be brought home", () => {
    const [r] = buildActivity([held], []);
    expect(r).toMatchObject({ type: "stake", status: "done" });
    expect(r!.action).toMatchObject({ kind: "bring-home" });
  });

  it("orders in-flight → partial → done, and every row carries an amount label", () => {
    const rows = buildActivity([held, partialSwap], [pending]);
    expect(rows.map((r) => r.status)).toEqual(["in-flight", "partial", "done"]);
    for (const r of rows) expect(r.amountLabel).toMatch(/\d/);
  });

  it("empty in → empty log", () => {
    expect(buildActivity([], [])).toEqual([]);
  });
});
