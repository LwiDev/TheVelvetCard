/**
 * WebSocket message protocol (client ↔ server).
 * All messages are JSON-serialised.
 */

import type { Card, GameEvent, GamePhase, PlayerAction, PlayerStatus, Pot } from '../poker/types';

// ─── Lobby ────────────────────────────────────────────────────────────────────

export interface TableInfo {
	id: string;
	name: string;
	playerCount: number;
	maxPlayers: number;
	phase: GamePhase;
}

// ─── Sanitised state ──────────────────────────────────────────────────────────
// The server never sends other players' hole cards (except at showdown).

export interface SanitizedPlayer {
	id: string;
	name: string;
	chips: number;
	/** Own cards are visible; opponents' are null (not yet dealt) or '??' (hidden). */
	holeCards: [Card, Card] | ['??', '??'] | null;
	status: PlayerStatus;
	currentBet: number;
	isBot: boolean;
	seatIndex: number;
}

export interface SanitizedGameState {
	tableId: string;
	phase: GamePhase;
	players: SanitizedPlayer[];
	communityCards: Card[];
	pots: Pot[];
	currentPlayerIndex: number;
	dealerIndex: number;
	smallBlindIndex: number;
	bigBlindIndex: number;
	currentBet: number;
	smallBlind: number;
	bigBlind: number;
	minRaise: number;
	handNumber: number;
	/** Seat count limit. */
	maxPlayers: number;
	/** Total chips committed by all players this hand (across all streets). */
	pot: number;
}

// ─── Client → Server ──────────────────────────────────────────────────────────

export type C2SMessage =
	| { type: 'list_tables' }
	| { type: 'join_table'; tableId: string; playerName: string }
	| { type: 'create_table'; tableName?: string; maxPlayers?: number; playerName: string }
	| { type: 'start_hand' }
	| { type: 'action'; action: PlayerAction; raiseToAmount?: number };

// ─── Server → Client ──────────────────────────────────────────────────────────

/** Server-level events that are not part of the poker engine (joins, leaves). */
export type ServerEvent =
	| { type: 'player-joined'; name: string }
	| { type: 'player-left'; name: string };

export interface StampedEvent {
	seq: number;
	event: GameEvent | ServerEvent;
}

export type S2CMessage =
	| { type: 'welcome'; playerId: string; tableId: string; seatIndex: number }
	| { type: 'table_list'; tables: TableInfo[] }
	| { type: 'state'; state: SanitizedGameState }
	| { type: 'events'; events: StampedEvent[] }
	| { type: 'error'; message: string };
