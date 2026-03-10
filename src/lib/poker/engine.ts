/**
 * engine.ts — public API for the poker engine.
 *
 * All functions are pure: they take state, return new state + events.
 * No I/O, no side-effects, no UI concerns.
 */

import type { ActionResult, GameEvent, GameState, Player, PlayerAction } from './types';
import { createDeck, deal, shuffle } from './deck';
import {
	activePlayers,
	applyBet,
	callAmount,
	canCheck,
	canRaise,
	isBettingRoundComplete,
	nextActivePlayerIndex,
	playersInHand,
	resetBettingRound
} from './betting';
import { advancePhase, runOutBoard, runShowdown } from './phases';

// ─── Constants ────────────────────────────────────────────────────────────────

export const STARTING_CHIPS = 500;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const MAX_PLAYERS = 6;

// ─── Table management ─────────────────────────────────────────────────────────

export function createInitialState(tableId: string): GameState {
	return {
		tableId,
		phase: 'waiting',
		players: [],
		deck: [],
		communityCards: [],
		pots: [],
		currentPlayerIndex: 0,
		dealerIndex: 0,
		smallBlindIndex: 0,
		bigBlindIndex: 0,
		currentBet: 0,
		smallBlind: SMALL_BLIND,
		bigBlind: BIG_BLIND,
		minRaise: BIG_BLIND,
		handNumber: 0
	};
}

export function createPlayer(
	id: string,
	name: string,
	seatIndex: number,
	isBot = false
): Player {
	return {
		id,
		name,
		chips: STARTING_CHIPS,
		holeCards: null,
		status: 'sitting-out',
		currentBet: 0,
		totalBetInHand: 0,
		hasActedThisRound: false,
		isBot,
		seatIndex
	};
}

/** Add a player to an available seat. Throws if table is full. */
export function addPlayer(state: GameState, player: Player): GameState {
	if (state.players.length >= MAX_PLAYERS) throw new Error('Table is full');
	const players = [...state.players, player].sort((a, b) => a.seatIndex - b.seatIndex);
	return { ...state, players };
}

/** Remove a player. Their chips are lost. */
export function removePlayer(state: GameState, playerId: string): GameState {
	return { ...state, players: state.players.filter((p) => p.id !== playerId) };
}

/**
 * Replace the first bot at the table with a human player.
 * If no bot is found, add the player to a new seat instead.
 */
export function replaceBot(state: GameState, humanPlayer: Player): GameState {
	const botIdx = state.players.findIndex((p) => p.isBot);
	if (botIdx === -1) return addPlayer(state, humanPlayer);

	const newPlayers = [...state.players];
	newPlayers[botIdx] = { ...humanPlayer, seatIndex: newPlayers[botIdx].seatIndex };
	return { ...state, players: newPlayers };
}

// ─── Hand lifecycle ───────────────────────────────────────────────────────────

/**
 * Start a new hand. Rotates the dealer button, posts blinds, deals hole cards.
 * Requires at least 2 players with chips.
 */
export function startHand(state: GameState): { state: GameState; events: GameEvent[] } {
	const events: GameEvent[] = [];

	const eligible = state.players.filter((p) => p.chips > 0);
	if (eligible.length < 2) throw new Error('Need at least 2 players with chips to start');

	const handNumber = state.handNumber + 1;
	events.push({ type: 'hand-start', handNumber });

	// ── Reset player state ──
	let players: Player[] = state.players.map((p) => ({
		...p,
		holeCards: null,
		currentBet: 0,
		totalBetInHand: 0,
		hasActedThisRound: false,
		status: p.chips > 0 ? 'active' : 'sitting-out'
	}));

	// ── Rotate dealer ──
	let dealerIndex = state.dealerIndex;
	if (handNumber > 1) {
		dealerIndex = nextActivePlayerIndex(players, state.dealerIndex);
	} else {
		// First hand: dealer is the first active player (seat 0 or lowest)
		dealerIndex = players.findIndex((p) => p.status === 'active');
	}

	// ── Blind positions ──
	const smallBlindIndex = nextActivePlayerIndex(players, dealerIndex);
	const bigBlindIndex = nextActivePlayerIndex(players, smallBlindIndex);

	// ── Post blinds ──
	players = postBlind(players, smallBlindIndex, state.smallBlind, 'small', events);
	players = postBlind(players, bigBlindIndex, state.bigBlind, 'big', events);

	// ── Shuffle and deal hole cards ──
	let deck = shuffle(createDeck());
	for (let i = 0; i < players.length; i++) {
		if (players[i].status !== 'active' && players[i].status !== 'all-in') continue;
		const { cards, remaining } = deal(deck, 2);
		deck = remaining;
		players[i] = { ...players[i], holeCards: cards as [typeof cards[0], typeof cards[1]] };
		events.push({ type: 'cards-dealt', playerId: players[i].id, cards: players[i].holeCards! });
	}

	// ── First to act preflop: left of big blind ──
	const firstToAct = nextActivePlayerIndex(players, bigBlindIndex);

	const newState: GameState = {
		...state,
		phase: 'preflop',
		players,
		deck,
		communityCards: [],
		pots: [],
		currentPlayerIndex: firstToAct,
		dealerIndex,
		smallBlindIndex,
		bigBlindIndex,
		currentBet: state.bigBlind,
		minRaise: state.bigBlind,
		handNumber
	};

	events.push({ type: 'phase-change', from: 'waiting', to: 'preflop' });

	return { state: newState, events };
}

function postBlind(
	players: Player[],
	playerIndex: number,
	amount: number,
	blindType: 'small' | 'big',
	events: GameEvent[]
): Player[] {
	const player = players[playerIndex];
	const actual = Math.min(amount, player.chips);
	const updated = applyBet(player, actual);
	const result = [...players];
	result[playerIndex] = {
		...updated,
		// If posting blind uses all chips → all-in
		status: updated.chips === 0 ? 'all-in' : 'active',
		// Blinds don't count as "acted" — BB still gets the option
		hasActedThisRound: false
	};
	events.push({ type: 'blind-posted', playerId: player.id, amount: actual, blindType });
	return result;
}

// ─── Action processing ────────────────────────────────────────────────────────

/**
 * Process a player action and return the resulting game state + events.
 *
 * For `raise`, `raiseToAmount` is the **total bet** the player wants to make
 * (not the increment). E.g. if currentBet is 20 and player raises to 60,
 * pass raiseToAmount = 60.
 */
export function processAction(
	state: GameState,
	playerId: string,
	action: PlayerAction,
	raiseToAmount?: number
): ActionResult {
	// ── Validation ──
	const playerIndex = state.players.findIndex((p) => p.id === playerId);
	if (playerIndex === -1) return fail('Player not found', state);
	if (state.currentPlayerIndex !== playerIndex) return fail('Not your turn', state);

	const player = state.players[playerIndex];
	if (player.status !== 'active') return fail('Player cannot act', state);

	// ── Apply action ──
	const events: GameEvent[] = [];
	let players = [...state.players];
	let currentBet = state.currentBet;
	let minRaise = state.minRaise;

	switch (action) {
		case 'fold': {
			players[playerIndex] = { ...player, status: 'folded', hasActedThisRound: true };
			events.push({ type: 'player-action', playerId, action: 'fold' });
			break;
		}

		case 'check': {
			if (!canCheck(state, player)) return fail('Cannot check — must call or raise', state);
			players[playerIndex] = { ...player, hasActedThisRound: true };
			events.push({ type: 'player-action', playerId, action: 'check' });
			break;
		}

		case 'call': {
			const toCall = callAmount(state, player);
			if (toCall === 0) {
				// Nothing to call → treat as check
				players[playerIndex] = { ...player, hasActedThisRound: true };
				events.push({ type: 'player-action', playerId, action: 'check' });
			} else {
				const updated = applyBet(player, toCall);
				players[playerIndex] = {
					...updated,
					status: updated.chips === 0 ? 'all-in' : 'active',
					hasActedThisRound: true
				};
				events.push({ type: 'player-action', playerId, action: 'call', amount: toCall });
			}
			break;
		}

		case 'raise': {
			if (!canRaise(player)) return fail('Cannot raise — no chips', state);
			if (raiseToAmount === undefined) return fail('raiseToAmount required for raise', state);

			const increment = raiseToAmount - currentBet;
			if (increment < minRaise) return fail(`Minimum raise to ${currentBet + minRaise}`, state);

			const chipsNeeded = raiseToAmount - player.currentBet;
			if (chipsNeeded > player.chips) return fail('Not enough chips', state);

			currentBet = raiseToAmount;
			minRaise = increment;

			const updated = applyBet(player, chipsNeeded);
			players[playerIndex] = {
				...updated,
				status: updated.chips === 0 ? 'all-in' : 'active',
				hasActedThisRound: true
			};

			// Reopen action for all other active players
			players = reopenBetting(players, playerIndex);

			events.push({ type: 'player-action', playerId, action: 'raise', amount: raiseToAmount });
			break;
		}

		case 'all-in': {
			const allInChips = player.chips;
			const newTotalBet = player.currentBet + allInChips;
			const updated = applyBet(player, allInChips);
			players[playerIndex] = { ...updated, status: 'all-in', hasActedThisRound: true };

			events.push({ type: 'player-action', playerId, action: 'all-in', amount: allInChips });

			if (newTotalBet > currentBet) {
				const increment = newTotalBet - currentBet;
				currentBet = newTotalBet;
				// Only reopen betting if the all-in is at least a full raise
				if (increment >= minRaise) {
					minRaise = increment;
					players = reopenBetting(players, playerIndex);
				}
			}
			break;
		}

		default:
			return fail(`Unknown action: ${action}`, state);
	}

	let newState: GameState = { ...state, players, currentBet, minRaise };

	// ── Check for last player standing ──
	const inHand = playersInHand(newState.players);
	if (inHand.length === 1) {
		const winner = inHand[0];
		const total = newState.players.reduce((s, p) => s + p.totalBetInHand, 0);
		const result = newState.players.map((p) =>
			p.id === winner.id ? { ...p, chips: p.chips + total } : p
		);
		events.push({ type: 'pot-awarded', playerId: winner.id, amount: total });
		return ok({ ...newState, phase: 'showdown', players: result }, events);
	}

	// ── Advance to next player or next phase ──
	if (isBettingRoundComplete(newState)) {
		// No active players left (everyone all-in) → run out board
		if (activePlayers(newState.players).length <= 1) {
			const { state: final, events: outEvents } = runOutBoard(newState);
			return ok(final, [...events, ...outEvents]);
		}
		const { state: phaseState, events: phaseEvents } = advancePhase(newState);
		return ok(phaseState, [...events, ...phaseEvents]);
	}

	const nextIdx = nextActivePlayerIndex(newState.players, playerIndex);
	return ok({ ...newState, currentPlayerIndex: nextIdx }, events);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mark all other active players as needing to act again (after a raise).
 */
function reopenBetting(players: Player[], raisingIndex: number): Player[] {
	return players.map((p, i) => {
		if (i === raisingIndex) return p;
		if (p.status === 'active') return { ...p, hasActedThisRound: false };
		return p;
	});
}

function fail(error: string, state: GameState): ActionResult {
	return { success: false, error, nextState: state, events: [] };
}

function ok(state: GameState, events: GameEvent[]): ActionResult {
	return { success: true, nextState: state, events };
}
