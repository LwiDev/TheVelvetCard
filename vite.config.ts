import tailwindcss from '@tailwindcss/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'child_process';

// Standalone WS server runs as a separate Bun process (src/ws-server.ts).
// Running it inside the esbuild-bundled Vite config context caused the ws npm
// package to fail completing the HTTP 101 handshake under Bun.
function pokerWs(): Plugin {
	return {
		name: 'poker-ws',
		apply: 'serve',
		configureServer(server) {
			const child = spawn('bun', ['--watch', 'src/ws-server.ts'], { stdio: 'inherit' });
			child.on('error', (err) => console.error('[poker-ws] spawn error:', err.message));
			// Kill child when Vite dev server closes (not via return value — that's a post-hook)
			server.httpServer?.on('close', () => child.kill());
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson(), pokerWs()]
});
