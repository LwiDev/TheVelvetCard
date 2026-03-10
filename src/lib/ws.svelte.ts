/**
 * Singleton WebSocket store — shared across all routes.
 *
 * Import `wsStore` in any .svelte file to access reactive state and actions.
 * The connection is opened once by +layout.svelte and persists across navigation.
 */

import type { C2SMessage, S2CMessage, SanitizedGameState, StampedEvent, TableInfo } from '$lib/server/protocol';

export type ActionLabel =
	| 'DEAL' | 'BLINDS' | 'RAISE' | 'CALL' | 'CHECK'
	| 'BET' | 'FOLD' | 'ALL-IN' | 'WIN' | 'SHOW' | 'JOIN' | 'LEFT';

export interface LogEntry extends StampedEvent { ts: string; }

class WsStore {
	// raw socket — not reactive (avoids proxy loops)
	private socket: WebSocket | null = null;

	// ── Connection state ──────────────────────────────────────────────────────
	connected     = $state(false);
	connectError  = $state('');

	// ── Session (set on welcome) ──────────────────────────────────────────────
	myPlayerId    = $state<string | null>(null);
	currentTableId = $state<string | null>(null);
	mySeatIndex   = $state<number | null>(null);

	// ── Lobby ─────────────────────────────────────────────────────────────────
	lobbyTables   = $state<TableInfo[]>([]);
	lobbyLoading  = $state(false);

	// ── Game ──────────────────────────────────────────────────────────────────
	game          = $state<SanitizedGameState | null>(null);
	eventLog      = $state<LogEntry[]>([]);
	winnerGlow    = $state<string | null>(null);
	playerNames   = $state(new Map<string, string>());

	// ── Public API ────────────────────────────────────────────────────────────

	/** Open a new WebSocket. Returns a cleanup fn (close the socket). */
	connect(): () => void {
		const proto  = location.protocol === 'https:' ? 'wss' : 'ws';
		const host   = import.meta.env.DEV ? `${location.hostname}:2002` : location.host;
		const socket = new WebSocket(`${proto}://${host}/ws`);
		this.socket  = socket;

		socket.onopen = () => {
			this.connected    = true;
			this.connectError = '';
			socket.send(JSON.stringify({ type: 'list_tables' } satisfies C2SMessage));
		};

		socket.onmessage = (ev) => this.handleMessage(JSON.parse(ev.data) as S2CMessage);

		socket.onclose = () => {
			if (this.socket === socket) {
				this.connected = false;
				this.socket    = null;
			}
		};

		socket.onerror = () => {
			if (this.socket === socket) {
				this.connectError = 'Connection refused — is the server running?';
				this.connected    = false;
			}
		};

		return () => socket.close();
	}

	send(msg: C2SMessage) {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(msg));
		}
	}

	/**
	 * Leave the current table and reconnect.
	 * Closing the socket triggers the server's `leaveTable` via the `close` event.
	 */
	leaveAndReconnect() {
		this.myPlayerId     = null;
		this.currentTableId = null;
		this.mySeatIndex    = null;
		this.game           = null;
		this.eventLog       = [];
		this.winnerGlow     = null;
		this.connectError   = '';

		const old = this.socket;
		this.socket    = null;
		this.connected = false;
		old?.close();
		this.connect();
	}

	// ── Message handling ──────────────────────────────────────────────────────

	private handleMessage(msg: S2CMessage) {
		switch (msg.type) {
			case 'table_list':
				this.lobbyTables  = msg.tables;
				this.lobbyLoading = false;
				break;

			case 'welcome':
				this.myPlayerId     = msg.playerId;
				this.currentTableId = msg.tableId;
				this.mySeatIndex    = msg.seatIndex;
				this.connectError   = '';
				break;

			case 'state':
				this.game = msg.state;
				for (const p of msg.state.players) this.playerNames.set(p.id, p.name);
				break;

			case 'events': {
				for (const { event } of msg.events) {
					if (event.type === 'pot-awarded') {
						this.winnerGlow = event.playerId;
						setTimeout(() => { this.winnerGlow = null; }, 2200);
					}
				}
				const ts = new Date().toLocaleTimeString('en-US', {
					hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
				});
				this.eventLog = [
					...this.eventLog,
					...msg.events.map((e) => ({ ...e, ts })),
				].sort((a, b) => a.seq - b.seq).slice(-40);
				break;
			}

			case 'error':
				this.connectError = msg.message;
				break;
		}
	}
}

export const wsStore = new WsStore();
