/**
 * tableManager — in-memory store for all active poker tables.
 *
 * Bots fill empty seats automatically. They act with a short delay.
 * Post-hand housekeeping removes busted players, rebalances bots,
 * and auto-starts the next hand after a brief pause.
 */

import type { WebSocket } from 'ws';
import type { GameState, GameEvent } from '../poker/types';
import type { SanitizedGameState, SanitizedPlayer, S2CMessage, StampedEvent, ServerEvent, TableInfo } from './protocol';
import {
	createInitialState,
	createPlayer,
	addPlayer,
	removePlayer,
	startHand as engineStartHand,
	processAction,
	MAX_PLAYERS
} from '../poker/engine';
import { decideBotAction, pickBotName, releaseBotName } from './botManager';

// ─── Internal structures ──────────────────────────────────────────────────────

interface Table {
	tableId: string;
	name: string;
	maxPlayers: number;
	state: GameState;
	/** Only human players have WebSocket connections. */
	connections: Map<string, WebSocket>;
	nextSeatIndex: number;
	/** How many bots should be at this table. Decrements when humans join. */
	targetBotCount: number;
	/** Pending timer handle (post-hand delay or auto-start). Prevents double-scheduling. */
	handTimer: ReturnType<typeof setTimeout> | null;
	/** True while a bot action timeout is in-flight. Prevents duplicate bot timeouts. */
	botActionScheduled: boolean;
}

/** tableId → Table */
const tables = new Map<string, Table>();

let globalSeq = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreateTable(tableId: string, name?: string, maxPlayers = 6): Table {
	if (!tables.has(tableId)) {
		const cap = Math.min(Math.max(maxPlayers, 2), MAX_PLAYERS);
		const targetBotCount = Math.min(2 + Math.floor(Math.random() * 3), cap - 1);
		const table: Table = {
			tableId,
			name: name || tableId,
			maxPlayers: cap,
			state: createInitialState(tableId),
			connections: new Map(),
			nextSeatIndex: 0,
			targetBotCount,
			handTimer: null,
			botActionScheduled: false
		};
		tables.set(tableId, table);
		fillBots(table);
	}
	return tables.get(tableId)!;
}

function send(ws: WebSocket, msg: S2CMessage): void {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sanitize(state: GameState, forPlayerId: string): SanitizedGameState {
	const revealAll = state.phase === 'showdown';

	const players: SanitizedPlayer[] = state.players.map((p) => {
		let holeCards: SanitizedPlayer['holeCards'];
		if (p.holeCards === null) {
			holeCards = null;
		} else if (p.id === forPlayerId || revealAll) {
			holeCards = p.holeCards;
		} else {
			holeCards = ['??', '??'];
		}
		return {
			id: p.id,
			name: p.name,
			chips: p.chips,
			holeCards,
			status: p.status,
			currentBet: p.currentBet,
			isBot: p.isBot,
			seatIndex: p.seatIndex
		};
	});

	return {
		tableId: state.tableId,
		phase: state.phase,
		players,
		communityCards: state.communityCards,
		pots: state.pots,
		currentPlayerIndex: state.currentPlayerIndex,
		dealerIndex: state.dealerIndex,
		smallBlindIndex: state.smallBlindIndex,
		bigBlindIndex: state.bigBlindIndex,
		currentBet: state.currentBet,
		smallBlind: state.smallBlind,
		bigBlind: state.bigBlind,
		minRaise: state.minRaise,
		handNumber: state.handNumber,
		maxPlayers: MAX_PLAYERS,
		pot: state.players.reduce((sum, p) => sum + p.totalBetInHand, 0)
	};
}

function broadcastState(table: Table): void {
	for (const [playerId, ws] of table.connections) {
		send(ws, { type: 'state', state: sanitize(table.state, playerId) });
	}
	// After broadcasting, decide what happens next
	triggerNextAction(table);
}

function broadcastEvents(table: Table, events: GameEvent[]): void {
	if (events.length === 0) return;
	const stamped: StampedEvent[] = events.map((event) => ({ seq: ++globalSeq, event }));
	const msg: S2CMessage = { type: 'events', events: stamped };
	for (const ws of table.connections.values()) {
		send(ws, msg);
	}
}

function broadcastServerEvent(table: Table, event: ServerEvent): void {
	const stamped: StampedEvent[] = [{ seq: ++globalSeq, event }];
	const msg: S2CMessage = { type: 'events', events: stamped };
	for (const ws of table.connections.values()) {
		send(ws, msg);
	}
}

// ─── Bot & lifecycle logic ────────────────────────────────────────────────────

/** Add one bot to the table (does not broadcast). */
function addBot(table: Table): void {
	if (table.state.players.length >= table.maxPlayers) return;
	const botId = crypto.randomUUID();
	const name = pickBotName();
	const bot = createPlayer(botId, name, table.nextSeatIndex++, true);
	table.state = addPlayer(table.state, bot);
}

/** Fill empty bot slots up to targetBotCount (does not broadcast). */
function fillBots(table: Table): void {
	const currentBots = table.state.players.filter((p) => p.isBot).length;
	const totalPlayers = table.state.players.length;
	const toAdd = Math.min(
		table.targetBotCount - currentBots,
		table.maxPlayers - totalPlayers
	);
	for (let i = 0; i < toAdd; i++) addBot(table);
}

/**
 * Decide what happens next after a state broadcast:
 * - If hand is over: schedule post-hand housekeeping.
 * - If it's a bot's turn: schedule their action.
 */
function triggerNextAction(table: Table): void {
	const { state, tableId } = table;

	if (state.phase === 'waiting' || state.phase === 'showdown') {
		if (!table.handTimer) {
			table.handTimer = setTimeout(() => postHandHousekeeping(tableId), 3500);
		}
		return;
	}

	const current = state.players[state.currentPlayerIndex];
	if (current?.isBot && !table.botActionScheduled) {
		table.botActionScheduled = true;
		const delay = 700 + Math.random() * 800; // 700–1500 ms
		setTimeout(() => {
			table.botActionScheduled = false;
			executeBotAction(tableId, current.id);
		}, delay);
	}
}

/** Execute a queued bot action — verifies it's still that bot's turn. */
function executeBotAction(tableId: string, botId: string): void {
	const table = tables.get(tableId);
	if (!table) return;

	const current = table.state.players[table.state.currentPlayerIndex];
	if (!current || current.id !== botId || !current.isBot) return;
	if (table.state.phase === 'waiting' || table.state.phase === 'showdown') return;

	const { action, raiseToAmount } = decideBotAction(table.state, botId);
	let result = processAction(table.state, botId, action, raiseToAmount);

	if (!result.success) {
		// Fallback: fold
		result = processAction(table.state, botId, 'fold');
		if (!result.success) return;
	}

	table.state = result.nextState;
	broadcastEvents(table, result.events);
	broadcastState(table);
}

/** Remove busted players, rebalance bots, auto-start next hand. */
function postHandHousekeeping(tableId: string): void {
	const table = tables.get(tableId);
	if (!table) return;
	table.handTimer = null;

	// Guard: a new hand may have started manually before this timer fired
	if (table.state.phase !== 'waiting' && table.state.phase !== 'showdown') return;

	// Remove busted players (0 chips)
	const busted = table.state.players.filter((p) => p.chips <= 0);
	for (const p of busted) {
		table.state = removePlayer(table.state, p.id);
		table.connections.delete(p.id); // no-op for bots
		if (p.isBot) releaseBotName(p.name);
	}

	// Remove excess bots (e.g. humans joined and decremented targetBotCount)
	const excessBots = table.state.players.filter((p) => p.isBot).length - table.targetBotCount;
	if (excessBots > 0) {
		const bots = table.state.players.filter((p) => p.isBot);
		for (let i = 0; i < excessBots; i++) {
			table.state = removePlayer(table.state, bots[i].id);
			releaseBotName(bots[i].name);
		}
	}

	// Fill missing bots
	fillBots(table);

	// Set the auto-start timer BEFORE broadcasting.
	// broadcastState → triggerNextAction checks handTimer; if it's already set,
	// it won't schedule a second postHandHousekeeping (the root cause of mid-hand removals).
	const eligible = table.state.players.filter((p) => p.chips > 0);
	if (eligible.length >= 2) {
		table.handTimer = setTimeout(() => autoStartHand(tableId), 2000);
	}

	broadcastState(table);
}

function autoStartHand(tableId: string): void {
	const table = tables.get(tableId);
	if (!table) return;
	table.handTimer = null;
	if (table.state.phase !== 'waiting' && table.state.phase !== 'showdown') return;

	try {
		const { state, events } = engineStartHand(table.state);
		table.state = state;
		broadcastEvents(table, events);
		broadcastState(table);
	} catch {
		// Not enough players — wait for more to join
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface JoinResult {
	playerId: string;
	tableId: string;
	seatIndex: number;
}

function findAvailableTableId(): string {
	for (const [id, table] of tables) {
		if (table.state.players.length < table.maxPlayers) return id;
	}
	return `table${tables.size + 1}`;
}

export function listTables(): TableInfo[] {
	return [...tables.values()].map((t) => ({
		id: t.tableId,
		name: t.name,
		playerCount: t.state.players.length,
		maxPlayers: t.maxPlayers,
		phase: t.state.phase
	}));
}

export function createTable(
	tableName: string | undefined,
	maxPlayers: number,
	playerName: string,
	ws: WebSocket
): JoinResult | null {
	const tableId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
	const name = (tableName?.trim() || `Table ${tables.size + 1}`);
	getOrCreateTable(tableId, name, maxPlayers);
	return joinTable(tableId, playerName, ws);
}

export function joinTable(
	tableId: string,
	playerName: string,
	ws: WebSocket
): JoinResult | null {
	const resolvedId = tableId === 'auto' ? findAvailableTableId() : tableId;
	const table = getOrCreateTable(resolvedId);

	if (table.state.players.length >= table.maxPlayers) {
		send(ws, { type: 'error', message: 'Table is full' });
		return null;
	}

	// One bot steps back to make room for the human
	if (table.targetBotCount > 0) table.targetBotCount--;

	const seatIndex = table.nextSeatIndex++;
	const playerId = crypto.randomUUID();
	const player = createPlayer(playerId, playerName, seatIndex);

	table.state = addPlayer(table.state, player);
	table.connections.set(playerId, ws);

	send(ws, { type: 'welcome', playerId, tableId: resolvedId, seatIndex });
	broadcastServerEvent(table, { type: 'player-joined', name: playerName });
	broadcastState(table);

	// If no hand is running and we now have enough players, start one soon
	if (
		(table.state.phase === 'waiting' || table.state.phase === 'showdown') &&
		table.state.players.filter((p) => p.chips > 0).length >= 2 &&
		!table.handTimer
	) {
		table.handTimer = setTimeout(() => autoStartHand(resolvedId), 2000);
	}

	return { playerId, tableId: resolvedId, seatIndex };
}

export function leaveTable(tableId: string, playerId: string): void {
	const table = tables.get(tableId);
	if (!table) return;

	// Auto-fold if it's their turn mid-hand
	const playerIdx = table.state.players.findIndex((p) => p.id === playerId);
	if (
		table.state.phase !== 'waiting' &&
		table.state.phase !== 'showdown' &&
		playerIdx === table.state.currentPlayerIndex &&
		table.state.players[playerIdx]?.status === 'active'
	) {
		const result = processAction(table.state, playerId, 'fold');
		if (result.success) {
			table.state = result.nextState;
			broadcastEvents(table, result.events);
		}
	}

	// Give the bot slot back when a human leaves
	const leaving = table.state.players.find((p) => p.id === playerId);
	if (leaving && !leaving.isBot) {
		table.targetBotCount = Math.min(table.targetBotCount + 1, MAX_PLAYERS - 1);
		broadcastServerEvent(table, { type: 'player-left', name: leaving.name });
	}

	table.state = removePlayer(table.state, playerId);
	table.connections.delete(playerId);

	if (table.connections.size === 0 && table.state.players.filter((p) => !p.isBot).length === 0) {
		// No humans left — clean up table
		if (table.handTimer) clearTimeout(table.handTimer);
		tables.delete(tableId);
		return;
	}

	broadcastState(table);
}

export function startHand(tableId: string, requestingPlayerId: string): void {
	const table = tables.get(tableId);
	if (!table) return;
	const ws = table.connections.get(requestingPlayerId);
	if (!ws) return;

	// Cancel any pending auto-start or housekeeping timer
	if (table.handTimer) { clearTimeout(table.handTimer); table.handTimer = null; }

	try {
		const { state, events } = engineStartHand(table.state);
		table.state = state;
		broadcastEvents(table, events);
		broadcastState(table);
	} catch (err) {
		send(ws, {
			type: 'error',
			message: err instanceof Error ? err.message : 'Cannot start hand'
		});
	}
}

export function applyAction(
	tableId: string,
	playerId: string,
	action: Parameters<typeof processAction>[2],
	raiseToAmount?: number
): void {
	const table = tables.get(tableId);
	if (!table) return;
	const ws = table.connections.get(playerId);
	if (!ws) return;

	const result = processAction(table.state, playerId, action, raiseToAmount);

	if (!result.success) {
		send(ws, { type: 'error', message: result.error ?? 'Invalid action' });
		return;
	}

	table.state = result.nextState;
	broadcastEvents(table, result.events);
	broadcastState(table);
}

export function sendStateTo(tableId: string, playerId: string): void {
	const table = tables.get(tableId);
	if (!table) return;
	const ws = table.connections.get(playerId);
	if (!ws) return;
	send(ws, { type: 'state', state: sanitize(table.state, playerId) });
}
