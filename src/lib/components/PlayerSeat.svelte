<script lang="ts">
	import type { SanitizedPlayer, SanitizedGameState } from '$lib/server/protocol';
	import PokerCard from './PokerCard.svelte';

	interface Props {
		player: SanitizedPlayer;
		game: SanitizedGameState;
		myPlayerId: string | null;
		isActive: boolean;
		isWinner: boolean;
	}
	let { player, game, myPlayerId, isActive, isWinner }: Props = $props();

	const isMe     = $derived(player.id === myPlayerId);
	const folded   = $derived(player.status === 'folded');
	const allIn    = $derived(player.status === 'all-in');
	const isDealer = $derived(game.players[game.dealerIndex]?.id === player.id);
	const isSB     = $derived(game.players[game.smallBlindIndex]?.id === player.id);
	const isBB     = $derived(game.players[game.bigBlindIndex]?.id === player.id);
</script>

<div
	class="flex flex-col items-center gap-1.5 min-w-[140px] max-w-[160px] px-5 py-3 rounded-xl border transition-all duration-200 relative select-none shadow-[0_6px_28px_rgba(0,0,0,0.55)]"
	class:border-border={!isActive && !isWinner && !isMe}
	class:bg-gradient-to-br={true}
	class:from-surface-high={!isMe}
	class:to-surface={!isMe}
	class:from-[rgba(196,146,42,0.1)]={isMe}
	class:to-[rgba(42,32,21,0.92)]={isMe}
	class:border-[rgba(196,146,42,0.5)]={isMe && !isActive && !isWinner}
	class:opacity-35={folded}
	class:seat-active={isActive}
	class:seat-winner={isWinner}
>
	<!-- Badges -->
	<div class="flex gap-1 min-h-[20px] flex-wrap justify-center">
		{#if isDealer}
			<span class="text-[11px] font-extrabold rounded-full px-2 leading-[20px] bg-[#e8e0d0] text-[#1a1208]">D</span>
		{/if}
		{#if isSB}
			<span class="text-[11px] font-extrabold rounded-full px-2 leading-[20px] bg-gold/15 text-gold-light border border-gold/40">SB</span>
		{/if}
		{#if isBB}
			<span class="text-[11px] font-extrabold rounded-full px-2 leading-[20px] bg-gold/25 text-gold-light border border-gold/50">BB</span>
		{/if}
		{#if allIn}
			<span class="text-[11px] font-extrabold rounded-full px-2 leading-[20px] bg-[rgba(178,34,34,0.25)] text-[#f87171] border border-[rgba(178,34,34,0.45)]">ALL·IN</span>
		{/if}
	</div>

	<!-- Name -->
	<div class="text-[15px] font-semibold max-w-[130px] truncate font-body"
		class:text-[#e8e0d0]={isMe}
		class:text-[rgba(232,228,216,0.8)]={!isMe}>
		{player.name}{#if isMe}<span class="text-gold text-[11px]"> ●</span>{/if}
	</div>

	<!-- Stack -->
	<div class="text-[15px] font-bold font-mono tracking-tight text-gold-light">
		{player.chips.toLocaleString()} <span class="text-[11px] opacity-70">♦</span>
	</div>

	<!-- Bet -->
	{#if player.currentBet > 0}
		<div class="text-[12px] font-mono text-muted">bet {player.currentBet}</div>
	{/if}

	<!-- Cards -->
	<div class="flex gap-1.5 mt-1.5">
		{#if player.holeCards === null}
			<PokerCard card={null} size="md" />
			<PokerCard card={null} size="md" />
		{:else if player.holeCards[0] === '??'}
			<PokerCard card="??" size="md" />
			<PokerCard card="??" size="md" />
		{:else}
			<PokerCard card={player.holeCards[0]} size="md" />
			<PokerCard card={player.holeCards[1]} size="md" />
		{/if}
	</div>
</div>

<style>
	/* Active turn glow */
	.seat-active {
		border-color: var(--color-active) !important;
		box-shadow: 0 0 0 2px var(--color-active), 0 0 32px rgba(217,119,6,0.45), 0 6px 24px rgba(0,0,0,0.5);
	}
	/* Winner glow + pulse */
	.seat-winner {
		border-color: var(--color-gold-light) !important;
		box-shadow: 0 0 0 2px var(--color-gold), 0 0 40px rgba(232,184,64,0.55), 0 6px 24px rgba(0,0,0,0.5);
		animation: winner-pulse 0.6s ease-in-out 3;
	}
	@keyframes winner-pulse {
		0%, 100% { box-shadow: 0 0 0 2px var(--color-gold), 0 0 40px rgba(232,184,64,0.5),  0 6px 24px rgba(0,0,0,0.5); }
		50%       { box-shadow: 0 0 0 2px var(--color-gold), 0 0 72px rgba(232,184,64,0.8), 0 6px 24px rgba(0,0,0,0.5); }
	}
</style>
