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
 * based on phase, bet-to-stack ratio and random variance.
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
	const isPreflop = state.phase === 'preflop';

	// Detect if there's already been aggression (reraise situation)
	const alreadyRaised = isPreflop
		? state.currentBet > state.bigBlind
		: state.currentBet > 0;

	if (canCheck) {
		// Preflop open: ~15% raise | Postflop: ~20% | If pot already raised: ~8%
		const raiseChance = alreadyRaised ? 0.08 : isPreflop ? 0.15 : 0.20;
		if (rand >= raiseChance) return { action: 'check' };
		const target = state.currentBet + state.bigBlind * (1 + Math.floor(Math.random() * 3));
		const raiseToAmount = Math.min(target, player.currentBet + player.chips);
		if (raiseToAmount >= state.currentBet + state.minRaise) return { action: 'raise', raiseToAmount };
		return { action: 'check' };
	}

	// Must call or fold
	const pressure = toCall / player.chips; // 0..1
	// Fold more preflop to reraises, less postflop
	const foldBase = isPreflop && alreadyRaised ? 0.30 : 0.15;
	if (rand < foldBase + pressure * 0.35) return { action: 'fold' };

	// Reraise chance: low (5-10%)
	const reraiseChance = alreadyRaised ? 0.05 : 0.12;
	if (rand > 1 - reraiseChance && player.chips > toCall + state.minRaise) {
		const target = state.currentBet + state.bigBlind * (2 + Math.floor(Math.random() * 3));
		const raiseToAmount = Math.min(target, player.currentBet + player.chips);
		if (raiseToAmount >= state.currentBet + state.minRaise) return { action: 'raise', raiseToAmount };
	}
	return { action: 'call' };
}
