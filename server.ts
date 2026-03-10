/**
 * Production server entry point.
 *
 * Runs SvelteKit + the poker WebSocket server on the same HTTP server.
 * Usage: bun server.ts
 *
 * Build first: bun run build
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './src/lib/server/wsHandler';

// SvelteKit's adapter-node exports a handler from build/handler.js
// @ts-expect-error — only exists after `bun run build`
import { handler } from './build/handler.js';

const PORT = Number(process.env.PORT ?? 2000);

const httpServer = createServer(handler);

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
	const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);
	if (pathname === '/ws') {
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	}
});

wss.on('connection', handleConnection);

httpServer.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log(`WebSocket ready at ws://localhost:${PORT}/ws`);
});
