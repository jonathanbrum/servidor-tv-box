import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['**/server/**', '**/public/**', '**/*.json'],
    },
    proxy: {
      '/api/stream': {
        target: 'ws://127.0.0.1:3333',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as any).code;
            if (['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ECONNREFUSED'].includes(code)) return;
            console.warn('[Vite WS Proxy Error]', err.message);
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', (err) => {
              const code = (err as any).code;
              if (['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ECONNREFUSED'].includes(code)) return;
            });
          });
          proxy.on('open', (proxySocket) => {
            proxySocket.on('error', (err) => {
              const code = (err as any).code;
              if (['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ECONNREFUSED'].includes(code)) return;
            });
          });
        },
      },
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            const code = (err as any).code;
            if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
              if (res && 'writeHead' in res && !(res as any).headersSent) {
                (res as any).writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend offline ou reiniciando' }));
              }
            }
          });
        },
      },
      '/samples': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
