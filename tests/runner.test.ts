/**
 * Resume runner. A parked journey resumes by running the REMAINING Rome legs from where it stalled,
 * signed by the user's own wallet, reading live on-chain amounts. legsFrom is the pure sequence; the
 * executor (resumeFromLeg) orchestrates the tested drivers.
 */
import { describe, it, expect } from "vitest";
import { legsFrom } from "../src/runner";

describe("legsFrom — the remaining Rome legs from a parked leg", () => {
  it("swap → swap, unwrap, stake", () => expect(legsFrom("swap")).toEqual(["swap", "unwrap", "stake"]));
  it("unwrap → unwrap, stake", () => expect(legsFrom("unwrap")).toEqual(["unwrap", "stake"]));
  it("stake → stake", () => expect(legsFrom("stake")).toEqual(["stake"]));
  it("throws on a leg that isn't a Rome leg", () => {
    expect(() => legsFrom("burn" as never)).toThrow(/rome leg/i);
    expect(() => legsFrom("deliver" as never)).toThrow(/rome leg/i);
  });
});
