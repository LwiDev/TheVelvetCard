// Poker table is fully client-side: WebSocket + dynamic state, nothing to pre-render.
// Disabling SSR also avoids hydration mismatches (e.g. random guest name).
export const ssr = false;
