/**
 * wsHandler — per-connection lifecycle.
 *
 * Each WebSocket connection goes through: connect → join_table → actions → disconnect.
 * Connection state (which player, which table) is stored locally in the closure.
 */

import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import type { C2SMessage } from './protocol';
import { applyAction, createTable, joinTable, leaveTable, listTables, sendStateTo, startHand } from './tableManager';

interface ConnectionCtx {
	playerId: string | null;
	tableId: string | null;
}

export function handleConnection(ws: WebSocket, _req: IncomingMessage): void {
	const ctx: ConnectionCtx = { playerId: null, tableId: null };

	ws.on('message', (raw) => {
		let msg: C2SMessage;

		try {
			msg = JSON.parse(raw.toString()) as C2SMessage;
		} catch {
			ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
			return;
		}

		handleMessage(ws, ctx, msg);
	});

	ws.on('close', () => {
		if (ctx.playerId && ctx.tableId) {
			leaveTable(ctx.tableId, ctx.playerId);
		}
	});

	ws.on('error', (err) => {
		console.error('[ws] error', err.message);
	});
}

function handleMessage(ws: WebSocket, ctx: ConnectionCtx, msg: C2SMessage): void {
	switch (msg.type) {
		case 'list_tables': {
			ws.send(JSON.stringify({ type: 'table_list', tables: listTables() }));
			break;
		}

		case 'create_table': {
			if (ctx.playerId) {
				ws.send(JSON.stringify({ type: 'error', message: 'Already seated at a table' }));
				return;
			}
			const result = createTable(msg.tableName, msg.maxPlayers ?? 6, msg.playerName, ws);
			if (result) {
				ctx.playerId = result.playerId;
				ctx.tableId = result.tableId;
			}
			break;
		}

		case 'join_table': {
			if (ctx.playerId) {
				ws.send(JSON.stringify({ type: 'error', message: 'Already seated at a table' }));
				return;
			}

			const result = joinTable(msg.tableId, msg.playerName, ws);
			if (result) {
				ctx.playerId = result.playerId;
				ctx.tableId = result.tableId;
			}
			break;
		}

		case 'start_hand': {
			if (!ctx.playerId || !ctx.tableId) {
				ws.send(JSON.stringify({ type: 'error', message: 'Join a table first' }));
				return;
			}
			startHand(ctx.tableId, ctx.playerId);
			break;
		}

		case 'action': {
			if (!ctx.playerId || !ctx.tableId) {
				ws.send(JSON.stringify({ type: 'error', message: 'Join a table first' }));
				return;
			}
			applyAction(ctx.tableId, ctx.playerId, msg.action, msg.raiseToAmount);
			break;
		}

		default: {
			ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
		}
	}
}
