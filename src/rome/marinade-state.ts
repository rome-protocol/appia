// Marinade State account decoder + price-quote helper.
//
// State byte layout (from `programs/marinade-finance/src/state/mod.rs`):
//
// Constant-size header (we only decode the fields we need):
//   0..8     discriminator         (Anchor; verified d8 92 6b 5e 68 4b b6 b1)
//   8..40    msol_mint                Pubkey
//   40..72   admin_authority          Pubkey
//   72..104  operational_sol_account  Pubkey
//   104..136 treasury_msol_account    Pubkey
//   136      reserve_bump_seed        u8
//   137      msol_mint_authority_bump u8
//   138..146 rent_exempt_for_token_acc u64
//   146..150 reward_fee.basis_points  u32          (Fee struct = 4 bytes)
//   ───────── StakeSystem (76 bytes total) ─────────
//   150..182 stake_list.account       Pubkey
//   182..186 stake_list.item_size     u32
//   186..190 stake_list.count         u32
//   190..222 stake_list.reserved1     Pubkey
//   222..226 stake_list.reserved2     u32
//   226..234 delayed_unstake_cooling_down u64
//   234      stake_deposit_bump_seed  u8
//   235      stake_withdraw_bump_seed u8
//   236..244 slots_for_stake_delta    u64
//   244..252 last_stake_delta_epoch   u64
//   252..260 min_stake                u64
//   260..264 extra_stake_delta_runs   u32
//   ───────── ValidatorSystem (89 bytes total) ─────────
//   264..296 validator_list.account   Pubkey
//   296..300 validator_list.item_size u32
//   300..304 validator_list.count     u32
//   304..336 validator_list.reserved1 Pubkey
//   336..340 validator_list.reserved2 u32
//   340..372 manager_authority        Pubkey
//   372..376 total_validator_score    u32
//   376..384 total_active_balance     u64          ← used in price calc
//   384      auto_add_validator       u8
//   ───────── LiqPool (~135 bytes) ─────────
//   385..417 lp_mint                  Pubkey
//   417      lp_mint_authority_bump   u8
//   418      sol_leg_bump_seed        u8
//   419      msol_leg_authority_bump  u8
//   420..452 msol_leg                 Pubkey       ← used in deposit ix
//   452..460 lp_liquidity_target      u64
//   460..464 lp_max_fee.bp            u32
//   464..468 lp_min_fee.bp            u32
//   468..472 treasury_cut.bp          u32
//   472..480 lp_supply                u64
//   480..488 lent_from_sol_leg        u64
//   488..496 liquidity_sol_cap        u64
//   ───────── State top-level continued ─────────
//   496..504 available_reserve_balance u64        ← used in price calc
//   504..512 msol_supply              u64         ← used in price calc
//   512..520 msol_price (cached)      u64
//   520..528 circulating_ticket_count u64
//   528..536 circulating_ticket_balance u64       ← used in price calc
//   536..544 lent_from_reserve        u64
//   544..552 min_deposit              u64
//   552..560 min_withdraw             u64
//   560..568 staking_sol_cap          u64
//   568..576 emergency_cooling_down   u64         ← used in price calc
//   576..608 pause_authority          Pubkey
//   ... (paused, fees, settings — unused in Sprint 1 quote)
//
// **Effective msol_price for deposits:**
//   total_lamports_under_control =
//       validator_system.total_active_balance
//     + (stake_system.delayed_unstake_cooling_down + emergency_cooling_down)
//     + available_reserve_balance
//   total_virtual_staked_lamports =
//       total_lamports_under_control - circulating_ticket_balance
//   msol_for(lamports)  =  lamports * msol_supply / total_virtual_staked_lamports
//
// `circulating_ticket_balance` is SOL earmarked for delayed-unstake
// tickets and is NOT swappable for new mSOL — analogous to Raydium's
// fee-accrual subtraction. Including it in the denominator would
// **overstate** mSOL output for new depositors.

import { PublicKey } from '@solana/web3.js';
import type { Hex } from 'viem';
import { useEffect, useState } from 'react';
import { STATE_DISC } from './marinade-program';
import { pubkeyBs58ToBytes32, pubkeyToBytes32 } from './solana-pda';

const RPC = '/api/rpc/solana-devnet';
const POLL_MS = 8_000;

export type MarinadeState = {
  /// Anchor disc (echoed for sanity-check).
  disc: number[];
  /// mSOL token mint (classic SPL Token, 9 decimals).
  msolMint: Hex;
  /// LP's mSOL token account (passed in deposit ix slot 3).
  msolLeg: Hex;
  /// LiqPool sub-struct bumps (used to derive the SOL-leg / mSOL-leg
  /// authority PDAs; we re-derive client-side rather than trust these).
  solLegBumpSeed: number;
  msolLegAuthorityBumpSeed: number;
  msolMintAuthorityBumpSeed: number;
  reserveBumpSeed: number;
  /// `validator_system.total_active_balance` — SOL staked across active validators.
  totalActiveBalance: bigint;
  /// `available_reserve_balance` — protocol's idle SOL reserve.
  availableReserveBalance: bigint;
  /// `stake_system.delayed_unstake_cooling_down` — SOL in delayed-unstake transit.
  delayedUnstakeCoolingDown: bigint;
  /// `emergency_cooling_down`.
  emergencyCoolingDown: bigint;
  /// `circulating_ticket_balance` — SOL reserved against unredeemed unstake tickets.
  /// Subtracted from total_lamports_under_control to get virtual_staked_lamports.
  circulatingTicketBalance: bigint;
  /// mSOL token total supply (from the State account, mirrored from the
  /// mint).
  msolSupply: bigint;
  /// Cached msol_price (legacy field — may be stale; we compute live).
  msolPrice: bigint;
  /// Minimum deposit in lamports. On devnet this is 1 (no floor).
  minDeposit: bigint;
};

function readPubkeyHex(buf: Buffer, off: number): Hex {
  return ('0x' + buf.subarray(off, off + 32).toString('hex')) as Hex;
}

/// Decode a Marinade State account's `data` field (raw bytes including
/// the 8-byte Anchor discriminator).
export function decodeMarinadeState(data: Buffer): MarinadeState {
  if (data.length < 576) {
    throw new Error(
      `marinade-state: data too short (got ${data.length}, expected >= 576)`,
    );
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== STATE_DISC[i]) {
      throw new Error(
        `marinade-state: discriminator mismatch (expected ${STATE_DISC.join(',')}, got ${[
          ...data.subarray(0, 8),
        ].join(',')})`,
      );
    }
  }

  return {
    disc: [...data.subarray(0, 8)],
    msolMint: readPubkeyHex(data, 8),
    reserveBumpSeed: data[136]!,
    msolMintAuthorityBumpSeed: data[137]!,
    delayedUnstakeCoolingDown: data.readBigUInt64LE(226),
    totalActiveBalance: data.readBigUInt64LE(376),
    solLegBumpSeed: data[418]!,
    msolLegAuthorityBumpSeed: data[419]!,
    msolLeg: readPubkeyHex(data, 420),
    availableReserveBalance: data.readBigUInt64LE(496),
    msolSupply: data.readBigUInt64LE(504),
    msolPrice: data.readBigUInt64LE(512),
    circulatingTicketBalance: data.readBigUInt64LE(528),
    emergencyCoolingDown: data.readBigUInt64LE(568),
    minDeposit: data.readBigUInt64LE(544),
  };
}

/// Fetch the Marinade State account from the given Solana RPC endpoint.
export async function fetchMarinadeState(
  rpcUrl: string,
  stateBs58: string,
): Promise<MarinadeState> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [stateBs58, { encoding: 'base64' }],
    }),
  });
  const json = await res.json();
  const value = json?.result?.value;
  if (!value) {
    throw new Error(`marinade-state: ${stateBs58} not found on this RPC`);
  }
  const buf = Buffer.from(value.data[0]!, 'base64');
  return decodeMarinadeState(buf);
}

// ─────────────────────────────────────────────────────────────────────
// React hook — live-state poll
// ─────────────────────────────────────────────────────────────────────

export type MarinadeStateView = {
  state: MarinadeState | null;
  /// total_lamports_under_control (effective basis for new mSOL price).
  totalLamportsUnderControl: bigint | null;
  /// total_virtual_staked_lamports = total - circulating_ticket_balance.
  totalVirtualStakedLamports: bigint | null;
  /// Live msol_price as a human-readable number (mSOL per SOL exchange rate).
  /// `null` while loading or if msol_supply is 0.
  msolPerSol: number | null;
  loading: boolean;
  error?: string;
};

const EMPTY: MarinadeStateView = {
  state: null,
  totalLamportsUnderControl: null,
  totalVirtualStakedLamports: null,
  msolPerSol: null,
  loading: true,
};

export function useMarinadeState(stateBs58: string | null): MarinadeStateView {
  const [view, setView] = useState<MarinadeStateView>(EMPTY);

  useEffect(() => {
    if (!stateBs58) {
      setView(EMPTY);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const state = await fetchMarinadeState(RPC, stateBs58);
        if (cancelled) return;
        const total =
          state.totalActiveBalance +
          state.delayedUnstakeCoolingDown +
          state.emergencyCoolingDown +
          state.availableReserveBalance;
        const virt =
          total > state.circulatingTicketBalance
            ? total - state.circulatingTicketBalance
            : 0n;
        const msolPerSol =
          virt > 0n && state.msolSupply > 0n
            ? Number(state.msolSupply) / Number(virt)
            : null;
        setView({
          state,
          totalLamportsUnderControl: total,
          totalVirtualStakedLamports: virt,
          msolPerSol,
          loading: false,
        });
      } catch (e) {
        if (!cancelled)
          setView({
            ...EMPTY,
            loading: false,
            error: (e as Error).message ?? String(e),
          });
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stateBs58]);

  return view;
}

// ─────────────────────────────────────────────────────────────────────
// Quote helper — pure (no network).
//
// Mirrors `State::calc_msol_from_lamports` in
// `programs/marinade-finance/src/state/mod.rs`:
//
//   shares_from_value(lamports, total_virtual_staked_lamports, msol_supply)
//     = (lamports * msol_supply) / total_virtual_staked_lamports
//
// The contract uses checked u128 arithmetic; we mirror with bigint.
//
// Note: ignores the LP fee path. When `total_virtual_staked_lamports`
// is small relative to msol_supply (post-rewards accumulation), this
// understates by up to 1 lamport from integer truncation — the
// adapter's `minimum_amount_out`-equivalent is just the slippage guard
// we apply on top.
// ─────────────────────────────────────────────────────────────────────

export function quoteMarinadeMsolFromLamports(
  lamports: bigint,
  totalVirtualStakedLamports: bigint,
  msolSupply: bigint,
): bigint {
  if (lamports <= 0n) return 0n;
  if (totalVirtualStakedLamports <= 0n) return lamports; // bootstrap case (1:1)
  if (msolSupply === 0n) return lamports; // same
  return (lamports * msolSupply) / totalVirtualStakedLamports;
}

void PublicKey;
void pubkeyBs58ToBytes32;
void pubkeyToBytes32;
