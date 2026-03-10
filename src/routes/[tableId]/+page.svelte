<script lang="ts">
    import type { SanitizedPlayer } from "$lib/server/protocol";
    import type { Card, GameEvent, HandCategory } from "$lib/poker/types";
    import type { LogEntry, ActionLabel } from "$lib/ws.svelte";
    import type { StampedEvent, ServerEvent } from "$lib/server/protocol";
    import { wsStore } from "$lib/ws.svelte";
    import { goto } from "$app/navigation";
    import { evaluateBestHand } from "$lib/poker/evaluator";
    import PokerCard from "$lib/components/PokerCard.svelte";
    import PlayerSeat from "$lib/components/PlayerSeat.svelte";

    // ─── Constants ────────────────────────────────────────────────────────────

    const SEAT_POS = [
        { top: "61%", left: "50%" }, // 0 – bottom (local player)
        { top: "56%", left: "82%" }, // 1 – bottom-right
        { top: "32%", left: "84%" }, // 2 – right
        { top: "11%", left: "66%" }, // 3 – top-right
        { top: "11%", left: "34%" }, // 4 – top-left
        { top: "32%", left: "16%" }, // 5 – left
    ] as const;

    const HANDS_REF = [
        {
            name: "Royal Flush",
            example: "A♠ K♠ Q♠ J♠ T♠",
            desc: "Ace-high straight flush",
        },
        {
            name: "Straight Flush",
            example: "9♣ 8♣ 7♣ 6♣ 5♣",
            desc: "5 consecutive, same suit",
        },
        {
            name: "Four of a Kind",
            example: "K♠ K♥ K♦ K♣ 3♠",
            desc: "4 cards of the same rank",
        },
        {
            name: "Full House",
            example: "Q♠ Q♥ Q♦ 8♠ 8♥",
            desc: "Three of a kind + pair",
        },
        {
            name: "Flush",
            example: "A♥ J♥ 9♥ 4♥ 2♥",
            desc: "5 cards of the same suit",
        },
        {
            name: "Straight",
            example: "8♠ 7♥ 6♦ 5♣ 4♠",
            desc: "5 consecutive cards",
        },
        {
            name: "Three of a Kind",
            example: "J♠ J♥ J♦ 7♠ 3♦",
            desc: "3 cards of the same rank",
        },
        {
            name: "Two Pair",
            example: "A♠ A♥ K♦ K♣ 5♠",
            desc: "Two different pairs",
        },
        {
            name: "One Pair",
            example: "T♠ T♦ A♣ 6♥ 2♠",
            desc: "2 cards of the same rank",
        },
        {
            name: "High Card",
            example: "A♠ K♦ 9♣ 6♥ 2♠",
            desc: "Highest card plays",
        },
    ] as const;

    const HAND_LABELS: Record<HandCategory, string> = {
        "high-card": "High Card",
        "one-pair": "One Pair",
        "two-pair": "Two Pair",
        "three-of-a-kind": "Three of a Kind",
        straight: "Straight",
        flush: "Flush",
        "full-house": "Full House",
        "four-of-a-kind": "Four of a Kind",
        "straight-flush": "Straight Flush",
    };
    const HAND_TIER: Record<HandCategory, number> = {
        "high-card": 0,
        "one-pair": 0,
        "two-pair": 1,
        "three-of-a-kind": 1,
        straight: 2,
        flush: 2,
        "full-house": 2,
        "four-of-a-kind": 3,
        "straight-flush": 3,
    };

    // ─── Redirect if not in a game ────────────────────────────────────────────

    $effect(() => {
        if (wsStore.connected && !wsStore.myPlayerId) {
            goto("/");
        }
    });

    // ─── UI state ─────────────────────────────────────────────────────────────

    let raiseInput = $state(0);
    let logEl = $state<HTMLElement | null>(null);
    let logCollapsed = $state(false);
    let handRankingsCollapsed = $state(true);
    let showMobileLog = $state(false);
    let showMobileRankings = $state(false);

    // ─── Derived ──────────────────────────────────────────────────────────────

    const me = $derived(
        wsStore.game?.players.find((p) => p.id === wsStore.myPlayerId) ?? null,
    );

    const isMyTurn = $derived(
        !!wsStore.game &&
            !!wsStore.myPlayerId &&
            !!me &&
            me.status === "active" &&
            wsStore.game.players[wsStore.game.currentPlayerIndex]?.id ===
                wsStore.myPlayerId &&
            ["preflop", "flop", "turn", "river"].includes(wsStore.game.phase),
    );

    const callAmt = $derived(
        me && wsStore.game
            ? Math.min(wsStore.game.currentBet - me.currentBet, me.chips)
            : 0,
    );
    const isCheck = $derived(callAmt === 0);
    const minRaiseTo = $derived(
        wsStore.game ? wsStore.game.currentBet + wsStore.game.minRaise : 0,
    );
    const maxRaiseTo = $derived(me ? me.chips + me.currentBet : 0);
    const canRaise = $derived(isMyTurn && me !== null && me.chips > callAmt);

    const halfPotRaise = $derived(
        Math.min(
            maxRaiseTo,
            Math.max(
                minRaiseTo,
                minRaiseTo + Math.round((wsStore.game?.pot ?? 0) * 0.5),
            ),
        ),
    );
    const potRaise = $derived(
        Math.min(
            maxRaiseTo,
            Math.max(minRaiseTo, minRaiseTo + (wsStore.game?.pot ?? 0)),
        ),
    );

    const canStartHand = $derived(
        wsStore.connected &&
            !!wsStore.myPlayerId &&
            !!wsStore.game &&
            (wsStore.game.phase === "waiting" ||
                wsStore.game.phase === "showdown"),
    );

    const myHand = $derived.by(() => {
        if (!me || !me.holeCards || me.holeCards[0] === "??") return null;
        const community = wsStore.game?.communityCards ?? [];
        if (community.length === 0) return null;
        return evaluateBestHand(me.holeCards as [Card, Card], community);
    });

    const playersByPos = $derived.by(() => {
        const slots: (SanitizedPlayer | null)[] = Array(6).fill(null);
        if (!wsStore.game) return slots;
        for (const p of wsStore.game.players)
            slots[displayPos(p.seatIndex)] = p;
        return slots;
    });

    // Auto-scroll log to bottom
    $effect(() => {
        const _ = wsStore.eventLog.length;
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });

    // Update raise input when turn starts
    $effect(() => {
        if (isMyTurn) raiseInput = minRaiseTo;
    });

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function displayPos(seatIndex: number): number {
        if (wsStore.mySeatIndex === null) return seatIndex % 6;
        return (seatIndex - wsStore.mySeatIndex + 6) % 6;
    }

    function pname(id: string) {
        return wsStore.playerNames.get(id) ?? id.slice(0, 8);
    }

    function cardStr(c: Card): string {
        const rank =
            ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[
                c.rank
            ] ?? String(c.rank);
        const suit = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[
            c.suit
        ];
        return rank + suit;
    }

    interface FormattedEvent {
        label: ActionLabel | null;
        text: string;
        amount: string | null;
    }

    function formatEvent(ev: GameEvent | ServerEvent): FormattedEvent {
        const w = (id: string) => pname(id);
        const mk = (
            label: ActionLabel | null,
            text: string,
            amount: string | null = null,
        ): FormattedEvent => ({ label, text, amount });

        if (ev.type === "player-joined")
            return mk("JOIN", `${ev.name} joined`, null);
        if (ev.type === "player-left")
            return mk("LEFT", `${ev.name} left`, null);

        switch (ev.type) {
            case "hand-start":
                return mk(
                    "DEAL",
                    `New hand dealt. Hand #${ev.handNumber}`,
                    null,
                );
            case "blind-posted":
                return mk(
                    "BLINDS",
                    `${w(ev.playerId)} posted ${ev.blindType === "small" ? "small blind" : "big blind"}`,
                    String(ev.amount),
                );
            case "cards-dealt":
                return ev.playerId === wsStore.myPlayerId
                    ? mk(
                          "DEAL",
                          `Your cards: ${ev.cards.map(cardStr).join(" ")}`,
                          null,
                      )
                    : mk("DEAL", `${w(ev.playerId)} dealt cards`, null);
            case "phase-change":
                return ev.to === "preflop"
                    ? mk(null, "", null)
                    : mk("DEAL", ev.to.toUpperCase(), null);
            case "community-cards":
                return mk(
                    "DEAL",
                    `${ev.street.charAt(0).toUpperCase() + ev.street.slice(1)}: ${ev.cards.map(cardStr).join(" ")}`,
                    null,
                );
            case "player-action": {
                const n = w(ev.playerId);
                switch (ev.action) {
                    case "fold":
                        return mk("FOLD", `${n} folded.`, null);
                    case "check":
                        return mk("CHECK", `${n} checked.`, null);
                    case "call":
                        return mk(
                            "CALL",
                            `${n} called.`,
                            ev.amount ? String(ev.amount) : null,
                        );
                    case "raise":
                        return mk(
                            "RAISE",
                            `${n} raised to`,
                            ev.amount ? String(ev.amount) : null,
                        );
                    case "all-in":
                        return mk(
                            "ALL-IN",
                            `${n} is all-in!`,
                            ev.amount ? String(ev.amount) : null,
                        );
                    default:
                        return mk(null, `${n} ${ev.action}`, null);
                }
            }
            case "pot-awarded":
                return mk(
                    "WIN",
                    `${w(ev.playerId)} wins${ev.hand ? ` · ${ev.hand.category.replace(/-/g, " ")}` : ""}`,
                    String(ev.amount),
                );
            case "showdown":
                return mk("SHOW", "Showdown", null);
        }
        return mk(null, "", null);
    }

    function leaveTable() {
        wsStore.leaveAndReconnect();
        goto("/");
    }
</script>

<div class="h-svh flex flex-col bg-bg overflow-hidden">
    <!-- Header -->
    <header
        class="shrink-0 flex items-center justify-between px-3 lg:px-6 h-[52px] lg:h-[60px] border-b border-[rgba(75,62,39,0.6)] bg-[rgba(20,14,8,0.85)]"
    >
        <!-- Left: Leave + table name + phase -->
        <div class="flex items-center gap-2 lg:gap-4 min-w-0">
            <button
                onclick={leaveTable}
                class="shrink-0 text-muted text-sm hover:text-gold transition-colors cursor-pointer bg-transparent border-none p-0 font-body"
            >
                ← Leave
            </button>
            <span class="text-border/40 hidden lg:inline shrink-0">|</span>
            <!-- Table name: truncated, tap-to-copy on mobile -->
            <button
                onclick={() => navigator.clipboard?.writeText(wsStore.game?.tableId ?? '')}
                title="Tap to copy table ID"
                class="font-title text-sm lg:text-lg text-gold font-semibold tracking-wide truncate max-w-[90px] sm:max-w-[160px] lg:max-w-[220px] bg-transparent border-none cursor-pointer p-0 text-left hover:text-gold-light transition-colors"
            >♠ {wsStore.game?.tableId ?? "…"}</button>
            {#if wsStore.game?.phase && wsStore.game.phase !== "waiting"}
                <span class="shrink-0 text-[0.6rem] lg:text-[0.7rem] font-extrabold uppercase tracking-[0.15em] text-active bg-active/10 border border-active/35 px-2 lg:px-3 py-0.5 lg:py-1 rounded">
                    {wsStore.game.phase}
                </span>
            {/if}
            {#if wsStore.game?.handNumber}
                <span class="hidden sm:inline text-xs lg:text-sm text-muted shrink-0">#{wsStore.game.handNumber}</span>
            {/if}
        </div>
        <!-- Right: icon buttons (mobile) + name + dot -->
        <div class="flex items-center gap-2 lg:gap-3 shrink-0">
            <!-- Mobile icon-only panel toggles -->
            <div class="flex items-center gap-1.5 lg:hidden">
                <button
                    onclick={() => (showMobileLog = !showMobileLog)}
                    title="Hand History"
                    class="w-8 h-8 flex items-center justify-center rounded-lg border cursor-pointer transition-all text-base {showMobileLog ? 'bg-gold/15 border-gold/55 text-gold-light' : 'bg-white/5 border-border/45 text-muted hover:text-gold hover:border-gold/35'}"
                >☰</button>
                <button
                    onclick={() => (showMobileRankings = !showMobileRankings)}
                    title="Hand Rankings"
                    class="w-8 h-8 flex items-center justify-center rounded-lg border cursor-pointer transition-all text-base {showMobileRankings ? 'bg-gold/15 border-gold/55 text-gold-light' : 'bg-white/5 border-border/45 text-muted hover:text-gold hover:border-gold/35'}"
                >♠</button>
            </div>
            <span class="font-semibold text-[#e4d8c4] text-sm lg:text-base truncate max-w-[80px] lg:max-w-none">{me?.name ?? "…"}</span>
            <span
                class="w-2.5 h-2.5 rounded-full transition-all {wsStore.connected
                    ? 'bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.6)]'
                    : 'bg-danger'}"
            ></span>
        </div>
    </header>

    <!-- Table area -->
    <div class="flex-1 min-h-0 relative">
        <div class="absolute inset-0 overflow-hidden">
            <!-- Felt oval -->
            <div class="felt-oval"></div>

            <!-- Community cards + pot -->
            <div
                class="absolute inset-0 flex flex-col items-center justify-center gap-5 pointer-events-none pb-[36%]"
            >
                <div class="flex gap-3">
                    {#each Array(5) as _, i}
                        <PokerCard
                            card={wsStore.game?.communityCards?.[i] ?? null}
                            size="lg"
                        />
                    {/each}
                </div>
                {#if (wsStore.game?.pot ?? 0) > 0}
                    <div
                        class="flex items-center gap-2.5 bg-black/50 border border-gold/35 rounded-full px-6 py-2"
                    >
                        <span
                            class="text-[0.7rem] font-bold tracking-[0.18em] uppercase text-muted"
                            >POT</span
                        >
                        <span
                            class="text-2xl font-extrabold font-mono text-gold-light"
                            >{wsStore.game!.pot.toLocaleString()}</span
                        >
                        <span class="text-lg text-gold opacity-75">♦</span>
                    </div>
                {/if}
            </div>

            <!-- Player seats -->
            {#each playersByPos as player, pos}
                <div
                    class="absolute -translate-x-1/2 -translate-y-1/2 z-[2] scale-[0.7] lg:scale-100"
                    style="top:{SEAT_POS[pos].top}; left:{SEAT_POS[pos].left};"
                >
                    {#if player !== null}
                        <PlayerSeat
                            {player}
                            game={wsStore.game!}
                            myPlayerId={wsStore.myPlayerId}
                            isActive={wsStore.game?.players[
                                wsStore.game.currentPlayerIndex
                            ]?.id === player.id}
                            isWinner={wsStore.winnerGlow === player.id}
                        />
                    {:else}
                        <div
                            class="w-10 h-10 rounded-full border border-dashed border-border/30 flex items-center justify-center text-border/30 text-lg"
                        >
                            ·
                        </div>
                    {/if}
                </div>
            {/each}

            <!-- ── Action HUD ──────────────────────────────────────────────── -->
            <div
                class="absolute bottom-[2%] left-1/2 -translate-x-1/2 w-[90%] lg:w-[min(860px,calc(100%-480px))] z-10 flex flex-col gap-3 lg:gap-4 rounded-2xl border border-[rgba(75,62,39,0.75)] p-2 pb-3 lg:p-5 lg:pb-6 backdrop-blur-xl bg-[rgba(10,7,3,0.93)]"
                style="box-shadow: 0 -2px 0 rgba(196,146,42,0.1) inset, 0 8px 48px rgba(0,0,0,0.7);"
            >
                <!-- Info row -->
                <div class="flex items-center gap-3 flex-wrap min-h-7">
                    {#if myHand}
                        {@const tier = HAND_TIER[myHand.category]}
                        {@const tierBadgeCls = [
                            "border-border text-muted bg-black/20",
                            "border-active/45 text-[#fbbf24] bg-active/10",
                            "border-[rgba(34,197,94,0.4)] text-[#86efac] bg-[rgba(34,197,94,0.08)]",
                            "border-gold text-gold-light bg-gold/14 shadow-[0_0_14px_rgba(196,146,42,0.25)]",
                        ][tier]}
                        <div
                            class="flex items-center gap-2 text-sm font-bold px-3.5 py-1 rounded-full border font-body {tierBadgeCls}"
                        >
                            {HAND_LABELS[myHand.category]}
                            <span class="text-[0.68rem] font-mono opacity-70"
                                >{myHand.bestCards
                                    .map((c) => cardStr(c))
                                    .join(" ")}</span
                            >
                        </div>
                    {/if}
                    {#if !isMyTurn && wsStore.game?.phase !== "waiting" && wsStore.game?.phase !== "showdown" && wsStore.game?.players[wsStore.game.currentPlayerIndex]}
                        <div
                            class="flex items-center gap-1.5 text-sm text-muted font-body"
                        >
                            <span
                                class="w-1.5 h-1.5 rounded-full bg-active animate-pulse shrink-0"
                            ></span>
                            {pname(
                                wsStore.game.players[
                                    wsStore.game.currentPlayerIndex
                                ].id,
                            )}'s turn
                        </div>
                    {/if}
                    {#if me}
                        <div class="flex items-center gap-2 ml-auto">
                            <span
                                class="text-[0.65rem] uppercase tracking-wide text-muted font-body"
                                >Stack</span
                            >
                            <span
                                class="text-base font-bold font-mono text-gold-light"
                                >{me.chips.toLocaleString()} ♦</span
                            >
                        </div>
                    {/if}
                </div>

                <!-- Deal button -->
                {#if canStartHand}
                    <button
                        onclick={() => wsStore.send({ type: "start_hand" })}
                        class="w-full py-2 lg:py-4 bg-gradient-to-br from-gold to-gold-light text-[#140e04] font-extrabold text-sm lg:text-base tracking-[0.14em] uppercase rounded-xl border-none cursor-pointer transition-all hover:brightness-110 shadow-[0_3px_18px_rgba(196,146,42,0.35)] hover:shadow-[0_6px_28px_rgba(196,146,42,0.5)] font-body"
                    >
                        Deal Cards
                    </button>
                {/if}

                <!-- Action buttons -->
                {#if isMyTurn}
                    <div class="flex gap-2 lg:gap-2.5">
                        <button
                            onclick={() =>
                                wsStore.send({
                                    type: "action",
                                    action: "fold",
                                })}
                            class="flex-1 py-2 lg:py-3 rounded-xl border font-bold text-sm lg:text-base cursor-pointer transition-all flex items-center justify-center gap-2 font-body bg-[rgba(178,34,34,0.12)] border-[rgba(178,34,34,0.4)] text-[#fca5a5] hover:bg-[rgba(178,34,34,0.24)] hover:border-[rgba(178,34,34,0.7)]"
                        >
                            Fold
                        </button>
                        {#if isCheck}
                            <button
                                onclick={() =>
                                    wsStore.send({
                                        type: "action",
                                        action: "check",
                                    })}
                                class="flex-1 py-2 lg:py-3 rounded-xl border font-bold text-sm lg:text-base cursor-pointer transition-all flex items-center justify-center gap-2 font-body bg-[rgba(31,59,40,0.3)] border-[rgba(59,106,58,0.55)] text-[#86efac] hover:bg-[rgba(31,59,40,0.55)] hover:border-[rgba(59,106,58,0.8)]"
                            >
                                Check
                            </button>
                        {:else}
                            <button
                                onclick={() =>
                                    wsStore.send({
                                        type: "action",
                                        action: "call",
                                    })}
                                class="flex-1 py-2 lg:py-3 rounded-xl border font-bold text-sm lg:text-base cursor-pointer transition-all flex items-center justify-center gap-2 font-body bg-[rgba(31,59,40,0.3)] border-[rgba(59,106,58,0.55)] text-[#86efac] hover:bg-[rgba(31,59,40,0.55)] hover:border-[rgba(59,106,58,0.8)]"
                            >
                                Call <span
                                    class="font-mono text-base opacity-85"
                                    >{callAmt}</span
                                >
                            </button>
                        {/if}
                        <button
                            onclick={() =>
                                wsStore.send({
                                    type: "action",
                                    action: "all-in",
                                })}
                            class="flex-1 py-2 lg:py-3 rounded-xl border font-bold text-sm lg:text-base cursor-pointer transition-all flex items-center justify-center gap-2 font-body bg-[rgba(217,119,6,0.12)] border-[rgba(217,119,6,0.4)] text-[#fbbf24] hover:bg-[rgba(217,119,6,0.24)] hover:border-[rgba(217,119,6,0.7)]"
                        >
                            All-In <span class="font-mono text-base opacity-85"
                                >{me?.chips}</span
                            >
                        </button>
                    </div>

                    {#if canRaise}
                        <div class="flex flex-col gap-2.5">
                            <div class="flex justify-between items-baseline">
                                <span
                                    class="text-sm uppercase tracking-wide text-muted font-body"
                                    >Raise to</span
                                >
                                <span class="text-sm font-mono text-muted/65"
                                    >min {minRaiseTo} · max {maxRaiseTo}</span
                                >
                            </div>
                            <div class="flex gap-2.5 items-stretch">
                                <button
                                    onclick={() =>
                                        (raiseInput = Math.max(
                                            minRaiseTo,
                                            raiseInput -
                                                (wsStore.game?.bigBlind ?? 10),
                                        ))}
                                    class="w-10 lg:w-14 shrink-0 bg-border/20 border border-border/55 rounded-lg text-[#e4d8c4] text-2xl lg:text-3xl font-bold flex items-center justify-center cursor-pointer transition-all hover:bg-gold/18 hover:border-gold/50 hover:text-gold-light active:scale-95"
                                >
                                    −
                                </button>
                                <input
                                    type="number"
                                    bind:value={raiseInput}
                                    min={minRaiseTo}
                                    max={maxRaiseTo}
                                    class="flex-1 min-w-0 bg-black/45 border border-border/55 rounded-lg px-2 py-1.5 text-gold-light text-base font-bold font-mono text-center outline-none focus:border-gold/60 transition-colors lg:px-3 lg:py-2.5 lg:text-lg"
                                />
                                <button
                                    onclick={() =>
                                        (raiseInput = Math.min(
                                            maxRaiseTo,
                                            raiseInput +
                                                (wsStore.game?.bigBlind ?? 10),
                                        ))}
                                    class="w-10 lg:w-14 shrink-0 bg-border/20 border border-border/55 rounded-lg text-[#e4d8c4] text-2xl lg:text-3xl font-bold flex items-center justify-center cursor-pointer transition-all hover:bg-gold/18 hover:border-gold/50 hover:text-gold-light active:scale-95"
                                >
                                    +
                                </button>
                                <button
                                    onclick={() =>
                                        wsStore.send({
                                            type: "action",
                                            action: "raise",
                                            raiseToAmount: raiseInput,
                                        })}
                                    class="shrink-0 px-3 lg:px-6 bg-[rgba(183,121,31,0.2)] border border-[rgba(183,121,31,0.55)] text-[#fbbf24] text-base font-extrabold uppercase tracking-wide rounded-xl cursor-pointer transition-all hover:bg-[rgba(183,121,31,0.35)] hover:border-gold/80 font-body whitespace-nowrap"
                                >
                                    Raise
                                </button>
                            </div>
                            <div class="flex gap-2">
                                {#each [["Min", minRaiseTo], ["½ Pot", halfPotRaise], ["Pot", potRaise], ["Max", maxRaiseTo]] as [label, val]}
                                    <button
                                        onclick={() =>
                                            (raiseInput = val as number)}
                                        class="flex-1 py-1 lg:py-2 bg-white/4 border border-border/45 rounded-md text-xs lg:text-sm font-bold uppercase tracking-wide text-muted cursor-pointer transition-all hover:bg-gold/12 hover:border-gold/45 hover:text-gold-light font-body"
                                    >
                                        {label}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/if}

                {#if wsStore.connectError}
                    <p class="text-sm text-danger text-center">
                        {wsStore.connectError}
                    </p>
                {/if}
            </div>

            <!-- ── Floating: Hand Rankings ─────────────────────────── -->
            <div
                class="hidden lg:flex absolute bottom-[2%] right-[1.5%] w-[clamp(200px,15vw,320px)] z-[15] bg-[rgba(12,8,4,0.96)] border border-[rgba(75,62,39,0.65)] rounded-2xl backdrop-blur-xl overflow-hidden flex-col shadow-[0_8px_40px_rgba(0,0,0,0.65)]"
            >
                <button
                    class="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/4 transition-colors bg-transparent text-left"
                    onclick={() =>
                        (handRankingsCollapsed = !handRankingsCollapsed)}
                    aria-expanded={!handRankingsCollapsed}
                >
                    <span
                        class="font-title text-[0.9rem] font-bold tracking-[0.08em] text-gold-light"
                        style="text-shadow: 0 0 16px rgba(232,184,64,0.3);"
                        >Hand Rankings</span
                    >
                    <span class="text-[0.75rem] text-muted"
                        >{handRankingsCollapsed ? "▲" : "▼"}</span
                    >
                </button>
                {#if !handRankingsCollapsed}
                    <div
                        class="overflow-y-auto p-3 grid grid-cols-2 gap-2 scrollbar-thin max-h-[clamp(300px,40vh,500px)]"
                    >
                        {#each HANDS_REF as hand, i}
                            {@const tier =
                                i < 2 ? 3 : i < 5 ? 2 : i < 7 ? 1 : 0}
                            {@const cardBorder = [
                                "border-border/35",
                                "border-[rgba(251,146,60,0.3)]",
                                "border-[rgba(74,222,128,0.28)]",
                                "border-gold/45",
                            ][tier]}
                            {@const cardBg = [
                                "bg-[rgba(20,14,6,0.7)]",
                                "bg-[rgba(251,146,60,0.06)]",
                                "bg-[rgba(74,222,128,0.05)]",
                                "bg-gold/7",
                            ][tier]}
                            {@const nameClr = [
                                "text-[#c8c0b0]",
                                "text-[#fdba74]",
                                "text-[#86efac]",
                                "text-gold-light",
                            ][tier]}
                            {@const badgeBg = [
                                "bg-[rgba(160,154,140,0.18)] text-[#908880]",
                                "bg-[rgba(251,146,60,0.18)] text-[#fdba74]",
                                "bg-[rgba(74,222,128,0.15)] text-[#86efac]",
                                "bg-gold/18 text-gold-light",
                            ][tier]}
                            <div
                                class="relative flex flex-col gap-2 p-3 rounded-xl border transition-all hover:brightness-110 {cardBorder} {cardBg}"
                            >
                                <span
                                    class="absolute top-2 right-2 text-[0.58rem] font-extrabold font-mono px-1.5 py-0.5 rounded-full leading-none {badgeBg}"
                                    >#{i + 1}</span
                                >
                                <span
                                    class="text-[0.82rem] font-extrabold font-body pr-7 leading-tight {nameClr}"
                                    >{hand.name}</span
                                >
                                <div class="flex flex-wrap gap-[3px]">
                                    {#each hand.example.split(" ") as token}
                                        {@const red =
                                            token.includes("♥") ||
                                            token.includes("♦")}
                                        <span
                                            class="text-[0.68rem] font-mono px-[5px] py-[2px] rounded leading-none font-bold bg-[#f5f3ec] border border-black/10 shadow-[0_1px_3px_rgba(0,0,0,0.35)] {red
                                                ? 'text-[#c0392b]'
                                                : 'text-[#1a1a1a]'}"
                                            >{token}</span
                                        >
                                    {/each}
                                </div>
                                <span
                                    class="text-[0.68rem] text-muted font-body leading-snug"
                                    >{hand.desc}</span
                                >
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- ── Floating: Hand History ─────────────────────────── -->
            <div
                class="hidden lg:block absolute bottom-[2%] left-[1.5%] w-[clamp(200px,15vw,320px)] z-[15] bg-[rgba(12,8,4,0.96)] border border-[rgba(75,62,39,0.65)] rounded-2xl backdrop-blur-xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.65)]"
            >
                <button
                    class="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/4 transition-colors bg-transparent text-left"
                    onclick={() => (logCollapsed = !logCollapsed)}
                    aria-expanded={!logCollapsed}
                >
                    <span
                        class="font-title text-[0.9rem] font-bold tracking-[0.08em] text-gold-light"
                        style="text-shadow: 0 0 16px rgba(232,184,64,0.3);"
                        >Hand History</span
                    >
                    <span class="text-[0.75rem] text-muted"
                        >{logCollapsed ? "▲" : "▼"}</span
                    >
                </button>
                {#if !logCollapsed}
                    <div
                        class="max-h-[clamp(280px,35vh,420px)] overflow-y-auto px-3 pb-3 flex flex-col gap-2 scrollbar-thin"
                        bind:this={logEl}
                    >
                        {#if wsStore.eventLog.length === 0}
                            <p
                                class="text-sm text-muted text-center italic py-4"
                            >
                                Waiting for events…
                            </p>
                        {:else}
                            {#each wsStore.eventLog as { seq, event, ts } (seq)}
                                {@const fmt = formatEvent(event)}
                                {#if fmt.text && fmt.label !== null}
                                    {@const labelColors =
                                        {
                                            DEAL: "text-[#c8a84a] bg-[rgba(200,168,74,0.14)] border-[rgba(200,168,74,0.32)]",
                                            BLINDS: "text-[#b8963c] bg-[rgba(184,150,60,0.12)] border-[rgba(184,150,60,0.3)]",
                                            RAISE: "text-[#fbbf24] bg-[rgba(251,191,36,0.14)] border-[rgba(251,191,36,0.38)]",
                                            CALL: "text-[#86efac] bg-[rgba(134,239,172,0.1)] border-[rgba(134,239,172,0.28)]",
                                            CHECK: "text-[#a0a09a] bg-[rgba(160,160,154,0.1)] border-[rgba(160,160,154,0.24)]",
                                            BET: "text-[#fb923c] bg-[rgba(251,146,60,0.12)] border-[rgba(251,146,60,0.3)]",
                                            FOLD: "text-[#f87171] bg-[rgba(248,113,113,0.1)] border-[rgba(248,113,113,0.26)]",
                                            "ALL-IN":
                                                "text-[#f97316] bg-[rgba(249,115,22,0.15)] border-[rgba(249,115,22,0.38)]",
                                            WIN: "text-[#fde68a] bg-[rgba(253,230,138,0.18)] border-[rgba(253,230,138,0.42)]",
                                            SHOW: "text-[#c4b5fd] bg-[rgba(196,181,253,0.1)] border-[rgba(196,181,253,0.28)]",
                                            JOIN: "text-[#94a3b8] bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.2)]",
                                            LEFT: "text-[#94a3b8] bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.2)]",
                                        }[fmt.label] ??
                                        "text-muted bg-black/20 border-border/30"}
                                    <div
                                        class="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-[rgba(75,62,39,0.35)] bg-[rgba(20,14,6,0.6)]"
                                    >
                                        <span
                                            class="shrink-0 text-[0.6rem] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none mt-0.5 font-body {labelColors}"
                                            >{fmt.label}</span
                                        >
                                        <div class="flex-1 min-w-0">
                                            <div
                                                class="flex items-baseline justify-between gap-1.5"
                                            >
                                                <span
                                                    class="text-[0.82rem] font-semibold leading-snug font-body {fmt.label ===
                                                    'WIN'
                                                        ? 'text-gold-light'
                                                        : fmt.label ===
                                                                'JOIN' ||
                                                            fmt.label === 'LEFT'
                                                          ? 'text-muted'
                                                          : 'text-[#e8e0d0]'}"
                                                    >{fmt.text}</span
                                                >
                                                {#if fmt.amount}
                                                    <span
                                                        class="shrink-0 text-[0.85rem] font-extrabold font-mono {fmt.label ===
                                                        'WIN'
                                                            ? 'text-gold'
                                                            : 'text-[#e8c96a]'}"
                                                        >${fmt.amount}</span
                                                    >
                                                {/if}
                                            </div>
                                            <span
                                                class="text-[0.65rem] text-muted/55 font-mono mt-0.5 block"
                                                >{ts}</span
                                            >
                                        </div>
                                    </div>
                                {/if}
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- ── Mobile: Hand History overlay ──────────────────────────── -->
    {#if showMobileLog}
        <div
            class="fixed inset-0 z-[60] flex flex-col bg-[rgba(8,5,2,0.98)] lg:hidden"
        >
            <div
                class="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0"
            >
                <span
                    class="font-title text-lg font-bold text-gold-light"
                    style="text-shadow: 0 0 16px rgba(232,184,64,0.3);"
                    >Hand History</span
                >
                <button
                    onclick={() => (showMobileLog = false)}
                    class="text-3xl text-muted hover:text-[#e4d8c4] bg-transparent border-none cursor-pointer leading-none px-2"
                    >×</button
                >
            </div>
            <div
                class="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2"
                bind:this={logEl}
            >
                {#if wsStore.eventLog.length === 0}
                    <p class="text-sm text-muted text-center italic py-8">
                        Waiting for events…
                    </p>
                {:else}
                    {#each wsStore.eventLog as { seq, event, ts } (seq)}
                        {@const fmt = formatEvent(event)}
                        {#if fmt.text && fmt.label !== null}
                            {@const labelColors =
                                {
                                    DEAL: "text-[#c8a84a] bg-[rgba(200,168,74,0.14)] border-[rgba(200,168,74,0.32)]",
                                    BLINDS: "text-[#b8963c] bg-[rgba(184,150,60,0.12)] border-[rgba(184,150,60,0.3)]",
                                    RAISE: "text-[#fbbf24] bg-[rgba(251,191,36,0.14)] border-[rgba(251,191,36,0.38)]",
                                    CALL: "text-[#86efac] bg-[rgba(134,239,172,0.1)] border-[rgba(134,239,172,0.28)]",
                                    CHECK: "text-[#a0a09a] bg-[rgba(160,160,154,0.1)] border-[rgba(160,160,154,0.24)]",
                                    BET: "text-[#fb923c] bg-[rgba(251,146,60,0.12)] border-[rgba(251,146,60,0.3)]",
                                    FOLD: "text-[#f87171] bg-[rgba(248,113,113,0.1)] border-[rgba(248,113,113,0.26)]",
                                    "ALL-IN":
                                        "text-[#f97316] bg-[rgba(249,115,22,0.15)] border-[rgba(249,115,22,0.38)]",
                                    WIN: "text-[#fde68a] bg-[rgba(253,230,138,0.18)] border-[rgba(253,230,138,0.42)]",
                                    SHOW: "text-[#c4b5fd] bg-[rgba(196,181,253,0.1)] border-[rgba(196,181,253,0.28)]",
                                    JOIN: "text-[#94a3b8] bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.2)]",
                                    LEFT: "text-[#94a3b8] bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.2)]",
                                }[fmt.label] ??
                                "text-muted bg-black/20 border-border/30"}
                            <div
                                class="flex items-start gap-2.5 px-3 py-3 rounded-xl border border-[rgba(75,62,39,0.35)] bg-[rgba(20,14,6,0.6)]"
                            >
                                <span
                                    class="shrink-0 text-[0.65rem] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none mt-0.5 font-body {labelColors}"
                                    >{fmt.label}</span
                                >
                                <div class="flex-1 min-w-0">
                                    <div
                                        class="flex items-baseline justify-between gap-2"
                                    >
                                        <span
                                            class="text-[0.9rem] font-semibold leading-snug font-body {fmt.label === 'WIN' ? 'text-gold-light' : fmt.label === 'JOIN' || fmt.label === 'LEFT' ? 'text-muted' : 'text-[#e8e0d0]'}"
                                            >{fmt.text}</span
                                        >
                                        {#if fmt.amount}
                                            <span
                                                class="shrink-0 text-[0.95rem] font-extrabold font-mono {fmt.label === 'WIN' ? 'text-gold' : 'text-[#e8c96a]'}"
                                                >${fmt.amount}</span
                                            >
                                        {/if}
                                    </div>
                                    <span
                                        class="text-[0.7rem] text-muted/55 font-mono mt-0.5 block"
                                        >{ts}</span
                                    >
                                </div>
                            </div>
                        {/if}
                    {/each}
                {/if}
            </div>
        </div>
    {/if}

    <!-- ── Mobile: Hand Rankings overlay ─────────────────────────── -->
    {#if showMobileRankings}
        <div
            class="fixed inset-0 z-[60] flex flex-col bg-[rgba(8,5,2,0.98)] lg:hidden"
        >
            <div
                class="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0"
            >
                <span
                    class="font-title text-lg font-bold text-gold-light"
                    style="text-shadow: 0 0 16px rgba(232,184,64,0.3);"
                    >Hand Rankings</span
                >
                <button
                    onclick={() => (showMobileRankings = false)}
                    class="text-3xl text-muted hover:text-[#e4d8c4] bg-transparent border-none cursor-pointer leading-none px-2"
                    >×</button
                >
            </div>
            <div class="overflow-y-auto p-4 grid grid-cols-2 gap-3">
                {#each HANDS_REF as hand, i}
                    {@const tier = i < 2 ? 3 : i < 5 ? 2 : i < 7 ? 1 : 0}
                    {@const cardBorder = [
                        "border-border/35",
                        "border-[rgba(251,146,60,0.3)]",
                        "border-[rgba(74,222,128,0.28)]",
                        "border-gold/45",
                    ][tier]}
                    {@const cardBg = [
                        "bg-[rgba(20,14,6,0.7)]",
                        "bg-[rgba(251,146,60,0.06)]",
                        "bg-[rgba(74,222,128,0.05)]",
                        "bg-gold/7",
                    ][tier]}
                    {@const nameClr = [
                        "text-[#c8c0b0]",
                        "text-[#fdba74]",
                        "text-[#86efac]",
                        "text-gold-light",
                    ][tier]}
                    {@const badgeBg = [
                        "bg-[rgba(160,154,140,0.18)] text-[#908880]",
                        "bg-[rgba(251,146,60,0.18)] text-[#fdba74]",
                        "bg-[rgba(74,222,128,0.15)] text-[#86efac]",
                        "bg-gold/18 text-gold-light",
                    ][tier]}
                    <div
                        class="relative flex flex-col gap-2 p-3 rounded-xl border {cardBorder} {cardBg}"
                    >
                        <span
                            class="absolute top-2 right-2 text-[0.6rem] font-extrabold font-mono px-1.5 py-0.5 rounded-full leading-none {badgeBg}"
                            >#{i + 1}</span
                        >
                        <span
                            class="text-[0.9rem] font-extrabold font-body pr-7 leading-tight {nameClr}"
                            >{hand.name}</span
                        >
                        <div class="flex flex-wrap gap-1">
                            {#each hand.example.split(" ") as token}
                                {@const red =
                                    token.includes("♥") ||
                                    token.includes("♦")}
                                <span
                                    class="text-[0.75rem] font-mono px-1.5 py-0.5 rounded leading-none font-bold bg-[#f5f3ec] border border-black/10 {red ? 'text-[#c0392b]' : 'text-[#1a1a1a]'}"
                                    >{token}</span
                                >
                            {/each}
                        </div>
                        <span class="text-[0.72rem] text-muted font-body leading-snug"
                            >{hand.desc}</span
                        >
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .felt-oval {
        position: absolute;
        top: 6%;
        left: 12%;
        right: 12%;
        bottom: 34%;
        border-radius: 50%;
        background: radial-gradient(
            ellipse at 45% 42%,
            #1f5c38 0%,
            #174a2c 30%,
            #0f3320 60%,
            #09201a 100%
        );
        box-shadow:
            inset 0 0 90px rgba(0, 0, 0, 0.6),
            inset 0 0 30px rgba(0, 0, 0, 0.35),
            0 0 0 9px #16120a,
            0 0 0 14px #221a0d,
            0 0 0 17px #160f07,
            0 24px 90px rgba(0, 0, 0, 0.75);
    }
</style>
