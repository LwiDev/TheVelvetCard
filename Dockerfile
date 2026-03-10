# ── Build stage ────────────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Only what's needed to run
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/build ./build
COPY server.ts ./
COPY src/lib/server ./src/lib/server
COPY src/lib/poker   ./src/lib/poker

ENV PORT=2000
EXPOSE 2000

CMD ["bun", "server.ts"]
