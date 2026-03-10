import type { Card, Rank, Suit } from './types';

const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function createDeck(): Card[] {
	const deck: Card[] = [];
	for (const suit of SUITS) {
		for (const rank of RANKS) {
			deck.push({ rank, suit });
		}
	}
	return deck;
}

/** Fisher-Yates shuffle — returns a new array, does not mutate. */
export function shuffle(deck: Card[]): Card[] {
	const d = [...deck];
	for (let i = d.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[d[i], d[j]] = [d[j], d[i]];
	}
	return d;
}

/** Take `count` cards from the top of the deck. Returns cards + remaining deck. */
export function deal(
	deck: Card[],
	count: number
): { cards: Card[]; remaining: Card[] } {
	if (deck.length < count) throw new Error(`Not enough cards: need ${count}, have ${deck.length}`);
	return { cards: deck.slice(0, count), remaining: deck.slice(count) };
}
