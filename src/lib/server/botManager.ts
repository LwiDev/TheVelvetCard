/**
 * botManager — bot name pool + action decisions.
 * Pure functions, no side effects.
 */

import type { GameState, PlayerAction } from '../poker/types';

const BOT_NAMES = [
	'Atlas', 'Blaze', 'Cipher', 'Dusk', 'Echo',
	'Flint', 'Ghost', 'Hex', 'Iris', 'Jinx',
	'Knox', 'Luna', 'Mox', 'Nova', 'Onyx'
];

const usedNames = new Set<string>();

export function pickBotName(): string {
	const available = BOT_NAMES.filter((n) => !usedNames.has(n));
	const pool = available.length > 0 ? available : BOT_NAMES;
	const name = pool[Math.floor(Math.random() * pool.length)];
	usedNames.add(name);
	return name;
}

export function releaseBotName(name: string): void {
	usedNames.delete(name);
}

/**
 * Simple heuristic bot: check when free, otherwise call/raise/fold
 * based on bet-to-stack ratio and random variance.
 */
export function decideBotAction(
	state: GameState,
	botId: string
): { action: PlayerAction; raiseToAmount?: number } {
	const player = state.players.find((p) => p.id === botId);
	if (!player || player.status !== 'active') return { action: 'fold' };

	const toCall = Math.min(state.currentBet - player.currentBet, player.chips);
	const canCheck = toCall === 0;
	const rand = Math.random();

	if (canCheck) {
		// Check 65%, raise 35%
		if (rand < 0.65) return { action: 'check' };
		const target = state.currentBet + state.bigBlind * (1 + Math.floor(Math.random() * 3));
		const raiseToAmount = Math.min(target, player.currentBet + player.chips);
		if (raiseToAmount >= state.currentBet + state.minRaise) return { action: 'raise', raiseToAmount };
		return { action: 'check' };
	}

	// Must call or fold
	const pressure = toCall / player.chips; // 0..1
	if (rand < 0.15 + pressure * 0.35) return { action: 'fold' };
	if (rand < 0.80 || player.chips <= toCall + state.minRaise) return { action: 'call' };

	// Raise
	const target = state.currentBet + state.bigBlind * (2 + Math.floor(Math.random() * 4));
	const raiseToAmount = Math.min(target, player.currentBet + player.chips);
	if (raiseToAmount >= state.currentBet + state.minRaise) return { action: 'raise', raiseToAmount };
	return { action: 'call' };
}
