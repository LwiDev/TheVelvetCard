import type { GameState, Player, Pot } from './types';

// ─── Player queries ───────────────────────────────────────────────────────────

/** Players still in the hand (active or all-in, not folded or sitting-out). */
export function playersInHand(players: Player[]): Player[] {
	return players.filter((p) => p.status === 'active' || p.status === 'all-in');
}

/** Players who can still act (not folded, not all-in, not sitting-out). */
export function activePlayers(players: Player[]): Player[] {
	return players.filter((p) => p.status === 'active');
}

/**
 * Returns the index of the next active player after `fromIndex` (wraps around).
 * Returns -1 if no active player exists.
 */
export function nextActivePlayerIndex(players: Player[], fromIndex: number): number {
	for (let i = 1; i <= players.length; i++) {
		const idx = (fromIndex + i) % players.length;
		if (players[idx].status === 'active') return idx;
	}
	return -1;
}

// ─── Bet amounts ──────────────────────────────────────────────────────────────

/** Chips a player must put in to call (capped at their stack — they go all-in). */
export function callAmount(state: GameState, player: Player): number {
	return Math.min(state.currentBet - player.currentBet, player.chips);
}

export function canCheck(state: GameState, player: Player): boolean {
	return player.currentBet >= state.currentBet;
}

export function canRaise(player: Player): boolean {
	return player.chips > 0;
}

// ─── Betting round completion ─────────────────────────────────────────────────

/**
 * The betting round is over when every active player:
 *  1. has acted voluntarily at least once this round (`hasActedThisRound`)
 *  2. has matched the current bet (or is all-in, which is handled elsewhere)
 */
export function isBettingRoundComplete(state: GameState): boolean {
	const active = activePlayers(state.players);
	if (active.length === 0) return true;
	return active.every((p) => p.hasActedThisRound && p.currentBet === state.currentBet);
}

// ─── Chip movement ────────────────────────────────────────────────────────────

/** Return a new player with `amount` chips moved from stack to bet. */
export function applyBet(player: Player, amount: number): Player {
	return {
		...player,
		chips: player.chips - amount,
		currentBet: player.currentBet + amount,
		totalBetInHand: player.totalBetInHand + amount
	};
}

// ─── Side pot calculation ─────────────────────────────────────────────────────

/**
 * Build pots from each player's `totalBetInHand`.
 *
 * Algorithm:
 *   Sort unique all-in levels. At each level, the amount contributed by every
 *   player up to that level forms a pot that all non-folded contributors can win.
 *
 * Example:
 *   A all-in 100, B all-in 300, C called 300 (active)
 *   Level 100 → pot 300 (A+B+C each contributed 100), eligible: A, B, C
 *   Level 300 → pot 400 (B+C each contributed 200), eligible: B, C
 */
export function buildPots(players: Player[]): Pot[] {
	const pots: Pot[] = [];

	// Unique positive contribution levels, sorted ascending
	const levels = [...new Set(players.map((p) => p.totalBetInHand).filter((v) => v > 0))].sort(
		(a, b) => a - b
	);

	let prevLevel = 0;

	for (const level of levels) {
		// Players who contributed above the previous level cap
		const contributors = players.filter((p) => p.totalBetInHand > prevLevel);
		// Each contributor gives at most (level - prevLevel) to this tier
		const amount = contributors.reduce(
			(sum, p) => sum + Math.min(p.totalBetInHand, level) - prevLevel,
			0
		);

		if (amount <= 0) {
			prevLevel = level;
			continue;
		}

		// Only non-folded players who contributed at least `level` chips are eligible
		const eligible = players
			.filter((p) => p.status !== 'folded' && p.totalBetInHand >= level)
			.map((p) => p.id);

		// Merge with last pot if eligible set is identical (avoids unnecessary splits)
		const last = pots[pots.length - 1];
		if (
			last &&
			last.eligiblePlayerIds.length === eligible.length &&
			eligible.every((id) => last.eligiblePlayerIds.includes(id))
		) {
			last.amount += amount;
		} else {
			pots.push({ amount, eligiblePlayerIds: eligible });
		}

		prevLevel = level;
	}

	return pots;
}

// ─── Round reset ──────────────────────────────────────────────────────────────

/**
 * Reset per-street state at the start of a new betting round.
 * Clears `currentBet` and `hasActedThisRound` for all non-folded players.
 */
export function resetBettingRound(state: GameState): GameState {
	return {
		...state,
		currentBet: 0,
		minRaise: state.bigBlind,
		players: state.players.map((p) =>
			p.status === 'folded' || p.status === 'sitting-out'
				? p
				: { ...p, currentBet: 0, hasActedThisRound: false }
		)
	};
}
