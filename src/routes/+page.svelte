<script lang="ts">
	import { wsStore } from '$lib/ws.svelte';
	import { goto } from '$app/navigation';

	// ── Local lobby state ─────────────────────────────────────────────────────
	let lobbyName  = $state(`Guest${Math.floor(100 + Math.random() * 900)}`);
	let createName = $state('');
	let createSeats = $state(6);

	// Navigate to game as soon as we join/create a table
	$effect(() => {
		if (wsStore.myPlayerId && wsStore.currentTableId) {
			goto(`/${wsStore.currentTableId}`);
		}
	});

	// Auto-refresh lobby table list
	$effect(() => {
		if (wsStore.connected && !wsStore.myPlayerId) {
			const id = setInterval(() => {
				wsStore.lobbyLoading = true;
				wsStore.send({ type: 'list_tables' });
			}, 6000);
			return () => clearInterval(id);
		}
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	function refreshTables() {
		wsStore.lobbyLoading = true;
		wsStore.send({ type: 'list_tables' });
	}

	function lobbyJoin(tableId: string) {
		wsStore.send({ type: 'join_table', tableId, playerName: lobbyName.trim() || 'Guest' });
	}

	function lobbyCreate() {
		wsStore.send({
			type: 'create_table',
			tableName: createName.trim() || undefined,
			maxPlayers: createSeats,
			playerName: lobbyName.trim() || 'Guest',
		});
	}

	function retry() {
		wsStore.connectError = '';
		wsStore.leaveAndReconnect();
	}
</script>

<!-- ══════════════════════ CONNECTING ══════════════════════ -->
{#if !wsStore.connected && !wsStore.connectError}
	<div class="min-h-svh bg-bg flex flex-col items-center justify-center gap-4">
		<div class="w-7 h-7 rounded-full border-2 border-gold/20 border-t-gold animate-spin"></div>
		<p class="text-xs text-muted tracking-widest uppercase">Connecting…</p>
	</div>

<!-- ══════════════════════ ERROR ═══════════════════════════ -->
{:else if wsStore.connectError && !wsStore.myPlayerId}
	<div class="min-h-svh bg-bg flex flex-col items-center justify-center gap-4">
		<p class="text-sm text-danger text-center">{wsStore.connectError}</p>
		<button onclick={retry}
			class="px-5 py-2 border border-border rounded-lg bg-surface-high text-[#e4d8c4] text-sm font-semibold cursor-pointer hover:bg-border transition-colors">
			Retry
		</button>
	</div>

<!-- ══════════════════════ LOBBY ════════════════════════════ -->
{:else if wsStore.connected && !wsStore.myPlayerId}
	<div class="min-h-svh bg-bg flex items-center justify-center p-8"
		style="background-image: radial-gradient(ellipse 90% 55% at 50% -5%, rgba(196,146,42,0.09) 0%, transparent 65%), repeating-linear-gradient(45deg, transparent 0, transparent 38px, rgba(75,62,39,0.055) 38px, rgba(75,62,39,0.055) 39px), repeating-linear-gradient(-45deg, transparent 0, transparent 38px, rgba(75,62,39,0.055) 38px, rgba(75,62,39,0.055) 39px);">

		<div class="w-full max-w-[860px] animate-[fadeUp_0.45s_cubic-bezier(0.22,1,0.36,1)_both]">

			<!-- Title -->
			<header class="text-center mb-8">
				<div class="font-title text-[clamp(1.75rem,5vw,2.75rem)] font-bold text-gold-light tracking-[0.06em]"
					style="text-shadow: 0 0 32px rgba(232,184,64,0.35), 0 2px 4px rgba(0,0,0,0.5);">
					♠ <span>The Velvet Card</span> ♥
				</div>
				<p class="text-[0.65rem] tracking-[0.3em] uppercase text-muted mt-1">Texas Hold'em · Est. 2025</p>
				<div class="h-px mt-5"
					style="background: linear-gradient(90deg, transparent, rgba(196,146,42,0.5), rgba(232,184,64,0.7), rgba(196,146,42,0.5), transparent);">
				</div>
			</header>

			<!-- Player name -->
			<div class="flex flex-col items-center gap-2 mb-8">
				<label for="player-name" class="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Your name at the table</label>
				<input id="player-name" type="text" bind:value={lobbyName} maxlength="20" placeholder="Guest…"
					class="w-[min(280px,90vw)] bg-surface border border-gold/35 rounded-lg px-5 py-2 text-[#e8e0d0] font-title text-lg text-center tracking-wide outline-none transition-all focus:border-gold focus:shadow-[0_0_14px_rgba(196,146,42,0.22)] placeholder:text-muted/50" />
			</div>

			<!-- Panels -->
			<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">

				<!-- Create table -->
				<section class="bg-gradient-to-br from-surface-high to-surface border border-border rounded-xl overflow-hidden shadow-[0_4px_28px_rgba(0,0,0,0.45)]">
					<h2 class="font-title text-[0.8rem] font-semibold tracking-[0.12em] uppercase text-gold px-5 py-3.5 border-b border-border/50 m-0">♦ Open a Table</h2>
					<div class="p-5 flex flex-col gap-4">
						<div class="flex flex-col gap-1.5">
							<label for="inp-tname" class="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Table name <span class="opacity-50">(optional)</span></label>
							<input id="inp-tname" type="text" bind:value={createName} maxlength="30" placeholder="My table…"
								class="w-full bg-black/25 border border-border rounded-md px-3 py-2 text-[#e8e0d0] text-sm outline-none focus:border-gold/50 placeholder:text-muted/45 transition-colors" />
						</div>
						<div class="flex flex-col gap-1.5">
							<span class="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Max players</span>
							<div class="flex gap-1.5">
								{#each [2,3,4,5,6] as n}
									<button onclick={() => createSeats = n}
										class="flex-1 py-1.5 border rounded text-sm font-bold cursor-pointer transition-all {createSeats === n ? 'bg-gold/14 border-gold text-gold-light shadow-[0_0_8px_rgba(196,146,42,0.18)]' : 'bg-black/25 border-border text-muted'}">
										{n}
									</button>
								{/each}
							</div>
						</div>
						<button onclick={lobbyCreate}
							class="w-full bg-gradient-to-br from-gold to-gold-light text-[#140e04] font-extrabold text-xs tracking-[0.12em] uppercase py-2.5 rounded-md border-none cursor-pointer transition-all hover:brightness-110 shadow-[0_2px_14px_rgba(196,146,42,0.28)] hover:shadow-[0_4px_22px_rgba(196,146,42,0.42)]">
							Open Table
						</button>
					</div>
				</section>

				<!-- Join table -->
				<section class="bg-gradient-to-br from-surface-high to-surface border border-border rounded-xl overflow-hidden shadow-[0_4px_28px_rgba(0,0,0,0.45)]">
					<h2 class="font-title text-[0.8rem] font-semibold tracking-[0.12em] uppercase text-gold px-5 py-3.5 border-b border-border/50 m-0 flex items-center justify-between">
						<span>♣ Find a Game</span>
						<button onclick={refreshTables} class="bg-none border-none cursor-pointer text-muted text-base hover:text-gold transition-colors p-0 leading-none">
							<span class:animate-spin={wsStore.lobbyLoading}>↻</span>
						</button>
					</h2>
					<div class="p-5">
						{#if wsStore.lobbyTables.length === 0}
							<div class="flex flex-col items-center justify-center py-8 gap-2">
								<span class="text-3xl opacity-10">♠</span>
								<p class="text-sm text-muted text-center leading-relaxed">No tables open.<br/>Be the first to deal.</p>
							</div>
						{:else}
							<div class="flex flex-col gap-1">
								{#each wsStore.lobbyTables as t}
									<div role="button" tabindex="0"
										onclick={() => lobbyJoin(t.id)}
										onkeydown={(e) => e.key === 'Enter' && lobbyJoin(t.id)}
										class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent cursor-pointer transition-all hover:bg-gold/7 hover:border-gold/22">
										<div class="flex-1 min-w-0">
											<span class="block text-sm font-semibold text-[#e4d8c4] truncate">{t.name}</span>
											<span class="text-[0.65rem] text-muted uppercase tracking-wide">{t.phase === 'waiting' ? 'Waiting' : t.phase}</span>
										</div>
										<div class="flex flex-col items-end gap-1">
											<span class="text-xs font-mono"><span class="font-bold text-gold">{t.playerCount}</span><span class="text-muted">/{t.maxPlayers}</span></span>
											<div class="flex gap-1">
												{#each Array(t.maxPlayers) as _, i}
													<div class="w-1.5 h-1.5 rounded-full" class:bg-gold={i < t.playerCount} class:bg-border={i >= t.playerCount}></div>
												{/each}
											</div>
										</div>
										<button onclick={(e) => { e.stopPropagation(); lobbyJoin(t.id); }}
											class="shrink-0 border border-gold/40 text-gold text-[0.65rem] font-extrabold tracking-[0.14em] uppercase px-3 py-1.5 rounded cursor-pointer bg-transparent transition-all hover:bg-gold/14 hover:border-gold hover:shadow-[0_0_10px_rgba(196,146,42,0.2)]">
											Join
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes fadeUp {
		from { opacity: 0; transform: translateY(18px); }
		to   { opacity: 1; transform: translateY(0); }
	}
</style>
