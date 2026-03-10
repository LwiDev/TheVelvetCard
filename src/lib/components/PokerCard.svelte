<script lang="ts">
	import type { Card } from '$lib/poker/types';

	interface Props {
		card: Card | '??' | null;
		size?: 'sm' | 'md' | 'lg' | 'xl';
	}
	let { card, size = 'sm' }: Props = $props();

	const RANK_MAP: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
	const SUIT_MAP = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const;

	const dims  = { sm: 'w-[38px] h-[56px]', md: 'w-[52px] h-[76px]', lg: 'w-[68px] h-[98px]', xl: 'w-[88px] h-[126px]' };
	const rsz   = { sm: 'text-[10px]', md: 'text-[13px]', lg: 'text-[16px]', xl: 'text-[20px]' };
	const ssz   = { sm: 'text-[1.1rem]', md: 'text-[1.6rem]', lg: 'text-[2.1rem]', xl: 'text-[2.8rem]' };
</script>

{#if card === null}
	<div class="{dims[size]} rounded-md border border-dashed border-white/10 bg-black/15"></div>

{:else if card === '??'}
	<div class="{dims[size]} rounded-md bg-gradient-to-br from-[#1e2a4a] to-[#152038] border border-white/8 shadow-md flex items-center justify-center relative overflow-hidden">
		<span class="text-white/15 font-serif text-lg select-none">♠</span>
		<div class="absolute inset-[3px] border border-white/6 rounded-sm pointer-events-none"></div>
	</div>

{:else}
	{@const rank = RANK_MAP[card.rank] ?? String(card.rank)}
	{@const suit = SUIT_MAP[card.suit]}
	{@const red  = card.suit === 'hearts' || card.suit === 'diamonds'}
	<div class="{dims[size]} rounded-md bg-[#faf9f4] border border-black/15 shadow-[0_2px_8px_rgba(0,0,0,0.35)] flex items-center justify-center relative select-none p-[2px]">
		<span class="absolute top-[2px] left-[4px] {rsz[size]} font-extrabold leading-tight font-title text-center {red ? 'text-[#c0392b]' : 'text-[#1a1a1a]'}"
			>{rank}<br />{suit}</span>
		<span class="{ssz[size]} leading-none font-serif {red ? 'text-[#c0392b]' : 'text-[#1a1a1a]'}">{suit}</span>
		<span class="absolute bottom-[2px] right-[4px] {rsz[size]} font-extrabold leading-tight font-title text-center rotate-180 {red ? 'text-[#c0392b]' : 'text-[#1a1a1a]'}"
			>{rank}<br />{suit}</span>
	</div>
{/if}
