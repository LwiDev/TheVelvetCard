import type { Card, GameEvent, GamePhase, GameState, ShowdownResult } from './types';
import {
	activePlayers,
	buildPots,
	nextActivePlayerIndex,
	playersInHand,
	resetBettingRound
} from './betting';
import { compareHands, evaluateBestHand } from './evaluator';
import { deal } from './deck';

// ─── Phase ordering ───────────────────────────────────────────────────────────

const PHASE_ORDER: GamePhase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

function nextPhase(current: GamePhase): GamePhase {
	const idx = PHASE_ORDER.indexOf(current);
	return PHASE_ORDER[idx + 1] ?? 'showdown';
}

// ─── Phase advancement ────────────────────────────────────────────────────────

/**
 * Move the game from the current phase to the next one.
 * Deals community cards when appropriate, then either sets up the next
 * betting round or runs the showdown.
 */
export function advancePhase(state: GameState): { state: GameState; events: GameEvent[] } {
	const events: GameEvent[] = [];
	const from = state.phase;
	const to = nextPhase(from);

	events.push({ type: 'phase-change', from, to });

	// If only one player remains, skip straight to awarding the pot
	if (playersInHand(state.players).length === 1) {
		return { ...runShowdown(state), events: [...events] };
	}

	// Deal community cards
	let deck = state.deck;
	let communityCards = state.communityCards;

	if (to === 'flop') {
		const r = deal(deck, 3);
		deck = r.remaining;
		communityCards = [...communityCards, ...r.cards];
		events.push({ type: 'community-cards', cards: r.cards, street: 'flop' });
	} else if (to === 'turn') {
		const r = deal(deck, 1);
		deck = r.remaining;
		communityCards = [...communityCards, ...r.cards];
		events.push({ type: 'community-cards', cards: r.cards, street: 'turn' });
	} else if (to === 'river') {
		const r = deal(deck, 1);
		deck = r.remaining;
		communityCards = [...communityCards, ...r.cards];
		events.push({ type: 'community-cards', cards: r.cards, street: 'river' });
	} else if (to === 'showdown') {
		const { state: finalState, events: sdEvents } = runShowdown({ ...state, phase: 'river' });
		return { state: finalState, events: [...events, ...sdEvents] };
	}

	// Reset betting state
	let newState = resetBettingRound({ ...state, phase: to, deck, communityCards });

	// If no active players remain (everyone all-in), run out the board immediately
	if (activePlayers(newState.players).length <= 1) {
		return runOutBoard(newState, events);
	}

	// Set first player to act post-flop: first active player left of dealer
	const firstToAct = nextActivePlayerIndex(newState.players, newState.dealerIndex);
	newState = { ...newState, currentPlayerIndex: firstToAct };

	return { state: newState, events };
}

/**
 * When no betting is possible (≤1 active player), run all remaining streets
 * automatically and resolve at showdown.
 */
export function runOutBoard(
	state: GameState,
	priorEvents: GameEvent[] = []
): { state: GameState; events: GameEvent[] } {
	const allEvents = [...priorEvents];
	let current = state;

	while (current.phase !== 'showdown') {
		const { state: next, events } = advancePhase(current);
		allEvents.push(...events);
		current = next;
		if (current.phase === 'showdown') break;
	}

	return { state: current, events: allEvents };
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

export function runShowdown(state: GameState): { state: GameState; events: GameEvent[] } {
	const events: GameEvent[] = [];
	const inHand = playersInHand(state.players);

	// Build side pots
	const pots = buildPots(state.players);

	// Evaluate each player's best hand
	type Evaluated = { playerId: string; hand: ReturnType<typeof evaluateBestHand> };
	const evaluated: Evaluated[] = inHand
		.filter((p) => p.holeCards !== null)
		.map((p) => ({
			playerId: p.id,
			hand: evaluateBestHand(p.holeCards as [Card, Card], state.communityCards)
		}));

	// Track chips won per player
	const winnings = new Map<string, number>();

	const showdownResults: ShowdownResult[] = [];

	for (const pot of pots) {
		const eligible = evaluated.filter((e) => pot.eligiblePlayerIds.includes(e.playerId));
		if (eligible.length === 0) continue;

		// Sort best hand first
		eligible.sort((a, b) => compareHands(b.hand, a.hand));
		const bestHand = eligible[0].hand;
		const winners = eligible.filter((e) => compareHands(e.hand, bestHand) === 0);

		const share = Math.floor(pot.amount / winners.length);
		// Remainder (due to rounding) goes to the first winner
		const remainder = pot.amount - share * winners.length;

		winners.forEach((w, i) => {
			const amount = share + (i === 0 ? remainder : 0);
			winnings.set(w.playerId, (winnings.get(w.playerId) ?? 0) + amount);
			events.push({ type: 'pot-awarded', playerId: w.playerId, amount, hand: w.hand });
		});
	}

	// Build showdown result list (all players who were in the hand)
	for (const e of evaluated) {
		showdownResults.push({
			playerId: e.playerId,
			hand: e.hand,
			potWon: winnings.get(e.playerId) ?? 0
		});
	}

	events.push({ type: 'showdown', results: showdownResults });

	// Apply winnings to player stacks
	const newPlayers = state.players.map((p) => ({
		...p,
		chips: p.chips + (winnings.get(p.id) ?? 0)
	}));

	return {
		state: { ...state, phase: 'showdown', players: newPlayers, pots },
		events
	};
}
