# The Velvet Card

**The Velvet Card** is an online **Texas Hold’em poker game** inspired by the atmosphere of **1800s Wild West saloons**.
Play poker around a classic green felt table, join other players, and experience a simple, fast, and immersive poker environment.

The project focuses on a clean real-time multiplayer experience using WebSockets and a lightweight modern stack.

---

## Features

* Real-time multiplayer Texas Hold’em
* Lobby system (join or create a table)
* Up to **6 players per table**
* Dynamic tables (games can start with fewer players)
* Players can **join or leave between hands**
* Automatic actions with decision timer
* AFK detection with automatic sit-out and removal
* Event log showing all game actions
* Responsive poker table interface

---

## Gameplay

Each table runs a standard **Texas Hold’em** round system:

1. Players receive two hole cards.
2. Betting rounds occur during:

   * Pre-flop
   * Flop
   * Turn
   * River
3. Remaining players go to **showdown**.
4. The best hand wins the pot.

### Decision timer

Each player has **25 seconds** to act.

If the timer expires:

* If checking is possible → **automatic check**
* Otherwise → **automatic fold**

### AFK handling

To keep tables active:

* **3 consecutive timeouts** → player marked as **sitting out**
* Sitting out players automatically fold every hand
* After **5 hands sitting out**, the player is **removed from the table** and returned to the lobby

---

## Tech Stack

* **Svelte** (frontend UI)
* **Tailwind CSS** (styling)
* **WebSockets** for real-time gameplay
* **Bun / Node runtime**
* Custom **Texas Hold’em game engine**

---

## Project Structure

```
/client        Frontend (Svelte UI)
/server        Game server and WebSocket handling
/game          Poker engine and game logic
```

*(structure may evolve as the project grows)*

---

## Development

Install dependencies:

```bash
bun install
```

Start the development environment:

```bash
bun run dev
```

The development server runs both:

* the **frontend**
* the **WebSocket poker server**

---

## Production

Start the production server:

```bash
bun run start
```

In production, the HTTP server and WebSocket server run on the **same port**.

---

## Vision

The goal of **The Velvet Card** is to create a lightweight and immersive poker experience with:

* simple multiplayer access
* atmospheric Wild West design
* smooth real-time gameplay

Future improvements may include:

* AI players (bots)
* improved saloon-style UI
* better animations and table interactions
* statistics and player profiles

---

## License

MIT
