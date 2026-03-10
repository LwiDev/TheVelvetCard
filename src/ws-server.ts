/**
 * Standalone WebSocket server — run as a separate Bun process.
 *
 * Dev:  spawned automatically by the Vite plugin (vite.config.ts)
 * Prod: imported and attached to the HTTP server in server.ts
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './lib/server/wsHandler';

const PORT = 2002;

const http = createServer((_, res) => {
	res.writeHead(426, { 'Content-Type': 'text/plain' });
	res.end('WebSocket server — HTTP upgrade required');
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', handleConnection);

wss.on('error', (err) => console.error('[ws-server]', err.message));

http.listen(PORT, () => {
	console.log(`\n  ♠  poker-ws  →  ws://localhost:${PORT}\n`);
});
