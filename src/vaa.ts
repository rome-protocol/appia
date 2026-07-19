/**
 * Wormhole transfer-VAA parser (payload type 1).
 *
 * Payload layout (after the 51-byte body header):
 *   type@0 (1) | amount@1 (32, u256 BE) | tokenAddress@33 (32) |
 *   tokenChain@65 (2) | to@67 (32) | toChain@99 (2)
 *
 * The to@67/toChain@99 offsets are the point of this module existing —
 * a hand-parse at 65/97 (tokenChain skipped) silently matched nothing
 * on 2026-07-06 and stalled a live redeem for an hour.
 */
import { keccak256, type Hex } from "viem";

export interface TransferVaa {
  payloadType: number;
  amount: bigint;
  tokenAddress: `0x${string}`;
  tokenChain: number;
  to: `0x${string}`;
  toChain: number;
  emitterChain: number;
  raw: Uint8Array;
}

export function parseTransferVaa(vaa: Uint8Array): TransferVaa | null {
  const buf = Buffer.from(vaa);
  if (buf.length < 6) return null;
  const sigCount = buf.readUInt8(5);
  const body = buf.subarray(6 + sigCount * 66);
  if (body.length < 51 + 101) return null;
  const emitterChain = body.readUInt16BE(8);
  const payload = body.subarray(51);
  const payloadType = payload.readUInt8(0);
  if (payloadType !== 1) return null;
  let amount = 0n;
  for (const b of payload.subarray(1, 33)) amount = (amount << 8n) | BigInt(b);
  return {
    payloadType,
    amount,
    tokenAddress: `0x${payload.subarray(33, 65).toString("hex")}`,
    tokenChain: payload.readUInt16BE(65),
    to: `0x${payload.subarray(67, 99).toString("hex")}`,
    toChain: payload.readUInt16BE(99),
    emitterChain,
    raw: vaa,
  };
}

/**
 * Wormhole replay key = keccak256(keccak256(body)), where body is the VAA AFTER the signature block
 * (version@0 + guardianSetIndex@1 + sigCount@5 + 66*sigCount signatures). This is the exact `hash` the
 * token bridge's `isTransferCompleted(bytes32)` takes and sets on redemption. Hashing the WHOLE VAA
 * (sigs included) is the classic bug — it would never match on-chain, so a "pending" check would always
 * report unredeemed. Single-keccak is the other trap: the core does a DOUBLE hash.
 */
export function vaaHash(vaa: Uint8Array): Hex {
  const buf = Buffer.from(vaa);
  const sigCount = buf.readUInt8(5);
  const body = Uint8Array.from(buf.subarray(6 + sigCount * 66));
  return keccak256(keccak256(body));
}
