import type { Card, HandResult, HandCategory } from './types';
import { HAND_CATEGORY_RANK } from './types';

// ─── Utilities ────────────────────────────────────────────────────────────────

/** All C(n, k) combinations of `arr`. */
function combinations<T>(arr: T[], k: number): T[][] {
	if (k === 0) return [[]];
	if (arr.length < k) return [];
	const [first, ...rest] = arr;
	return [
		...combinations(rest, k - 1).map((c) => [first, ...c]),
		...combinations(rest, k)
	];
}

// ─── 5-card evaluator ─────────────────────────────────────────────────────────

function evaluate5(cards: Card[]): HandResult {
	// Sort ranks descending for easier processing
	const sorted = [...cards].sort((a, b) => b.rank - a.rank);
	const ranks = sorted.map((c) => c.rank);
	const suits = sorted.map((c) => c.suit);

	const isFlush = suits.every((s) => s === suits[0]);

	// Straight detection (including A-2-3-4-5 wheel)
	let isStraight = false;
	let straightHigh = 0;

	const uniqueRanks = new Set(ranks);
	if (uniqueRanks.size === 5) {
		if (ranks[0] - ranks[4] === 4) {
			// Normal straight
			isStraight = true;
			straightHigh = ranks[0];
		} else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) {
			// Wheel: A-2-3-4-5 (ace plays as 1)
			isStraight = true;
			straightHigh = 5;
		}
	}

	// Count rank occurrences, sort by frequency desc then rank desc
	const rankCounts = new Map<number, number>();
	for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
	const groups = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
	const groupSizes = groups.map((g) => g[1]);

	// ── Straight flush (incl. royal flush) ──
	if (isFlush && isStraight) {
		return make('straight-flush', [straightHigh], sorted);
	}

	// ── Four of a kind ──
	if (groupSizes[0] === 4) {
		return make('four-of-a-kind', [groups[0][0], groups[1][0]], sorted);
	}

	// ── Full house ──
	if (groupSizes[0] === 3 && groupSizes[1] === 2) {
		return make('full-house', [groups[0][0], groups[1][0]], sorted);
	}

	// ── Flush ──
	if (isFlush) {
		return make('flush', ranks, sorted);
	}

	// ── Straight ──
	if (isStraight) {
		return make('straight', [straightHigh], sorted);
	}

	// ── Three of a kind ──
	if (groupSizes[0] === 3) {
		const kickers = groups.slice(1).map((g) => g[0]);
		return make('three-of-a-kind', [groups[0][0], ...kickers], sorted);
	}

	// ── Two pair ──
	if (groupSizes[0] === 2 && groupSizes[1] === 2) {
		return make('two-pair', [groups[0][0], groups[1][0], groups[2][0]], sorted);
	}

	// ── One pair ──
	if (groupSizes[0] === 2) {
		const kickers = groups.slice(1).map((g) => g[0]);
		return make('one-pair', [groups[0][0], ...kickers], sorted);
	}

	// ── High card ──
	return make('high-card', ranks, sorted);
}

function make(category: HandCategory, tiebreakers: number[], bestCards: Card[]): HandResult {
	return { category, categoryRank: HAND_CATEGORY_RANK[category], tiebreakers, bestCards };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Given 2 hole cards and 3–5 community cards, return the best 5-card hand.
 * Tries all C(7,5) = 21 combinations and returns the highest-ranked result.
 */
export function evaluateBestHand(
	holeCards: [Card, Card],
	communityCards: Card[]
): HandResult {
	const all = [...holeCards, ...communityCards];
	const combos = combinations(all, 5);

	let best: HandResult | null = null;
	for (const combo of combos) {
		const result = evaluate5(combo);
		if (!best || compareHands(result, best) > 0) best = result;
	}

	// combos is non-empty as long as all.length >= 5
	return best!;
}

/**
 * Compare two hand results.
 * Returns positive if `a` beats `b`, negative if `b` beats `a`, 0 for tie.
 */
export function compareHands(a: HandResult, b: HandResult): number {
	if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
	for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
		const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}
