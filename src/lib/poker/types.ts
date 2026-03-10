// ─── Primitives ──────────────────────────────────────────────────────────────

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

/** 2–10 = face value, 11=J, 12=Q, 13=K, 14=A */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
	rank: Rank;
	suit: Suit;
}

// ─── Player ───────────────────────────────────────────────────────────────────

export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'sitting-out';

export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface Player {
	id: string;
	name: string;
	chips: number;
	holeCards: [Card, Card] | null;
	status: PlayerStatus;
	/** Amount bet in the current betting street only. Reset each street. */
	currentBet: number;
	/** Total amount committed across all streets this hand (used for side pots). */
	totalBetInHand: number;
	/**
	 * Whether this player has voluntarily acted in the current betting round.
	 * Reset to false at the start of every street, and whenever someone raises
	 * (reopening action for everyone else).
	 */
	hasActedThisRound: boolean;
	isBot: boolean;
	/** Fixed seat number 0–5. */
	seatIndex: number;
}

// ─── Pot ─────────────────────────────────────────────────────────────────────

export interface Pot {
	amount: number;
	/** Players who can win this pot (not folded, and contributed enough). */
	eligiblePlayerIds: string[];
}

// ─── Game state ───────────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface GameState {
	tableId: string;
	phase: GamePhase;
	/** Ordered by seatIndex. */
	players: Player[];
	deck: Card[];
	communityCards: Card[];
	pots: Pot[];
	/** Index in `players` whose turn it is to act. */
	currentPlayerIndex: number;
	dealerIndex: number;
	smallBlindIndex: number;
	bigBlindIndex: number;
	/** The amount every active player must match to stay in the hand. */
	currentBet: number;
	smallBlind: number;
	bigBlind: number;
	/** Minimum increment for a raise (not the total bet). */
	minRaise: number;
	handNumber: number;
}

// ─── Hand evaluation ──────────────────────────────────────────────────────────

export type HandCategory =
	| 'high-card'
	| 'one-pair'
	| 'two-pair'
	| 'three-of-a-kind'
	| 'straight'
	| 'flush'
	| 'full-house'
	| 'four-of-a-kind'
	| 'straight-flush';

export const HAND_CATEGORY_RANK: Record<HandCategory, number> = {
	'high-card': 0,
	'one-pair': 1,
	'two-pair': 2,
	'three-of-a-kind': 3,
	straight: 4,
	flush: 5,
	'full-house': 6,
	'four-of-a-kind': 7,
	'straight-flush': 8
};

export interface HandResult {
	category: HandCategory;
	categoryRank: number;
	/** Tiebreaker values ordered by importance (higher is better). */
	tiebreakers: number[];
	/** The 5 cards that make up the best hand. */
	bestCards: Card[];
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

export interface ShowdownResult {
	playerId: string;
	hand: HandResult;
	/** Chips won from all pots combined. 0 if lost. */
	potWon: number;
}

// ─── Action result & events ───────────────────────────────────────────────────

export interface ActionResult {
	success: boolean;
	error?: string;
	nextState: GameState;
	events: GameEvent[];
}

export type GameEvent =
	| { type: 'hand-start'; handNumber: number }
	| { type: 'blind-posted'; playerId: string; amount: number; blindType: 'small' | 'big' }
	| { type: 'cards-dealt'; playerId: string; cards: [Card, Card] }
	| { type: 'phase-change'; from: GamePhase; to: GamePhase }
	| { type: 'community-cards'; cards: Card[]; street: 'flop' | 'turn' | 'river' }
	| { type: 'player-action'; playerId: string; action: PlayerAction; amount?: number }
	| { type: 'pot-awarded'; playerId: string; amount: number; hand?: HandResult }
	| { type: 'showdown'; results: ShowdownResult[] };
