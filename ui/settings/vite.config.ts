/*
 * [INPUT]: Vite、React 插件与 CODEX_BUDDY_DEV_API 本机地址。
 * [OUTPUT]: 支持冷启动后正常退出的开发服务器配置及 target/web 构建输出。
 * [POS]: 设置页构建配置，产物由 Rust 内嵌。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const target = process.env.CODEX_BUDDY_DEV_API || 'http://127.0.0.1:47831';
const backend = new URL(target);
if (
  backend.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(backend.hostname) ||
  backend.username ||
  backend.password ||
  backend.pathname !== '/' ||
  backend.search ||
  backend.hash
) {
  throw new Error('CODEX_BUDDY_DEV_API 必须是本机 HTTP 服务地址');
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  // Resolve optimized imports before shutdown; speculative transforms otherwise
  // wait for crawl completion while the dependency optimizer is being cancelled.
  optimizeDeps: { holdUntilCrawlEnd: false },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    proxy: {
      '^/api(?:/|$)': {
        target,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            // Translate only a same-origin request to this Vite listener.
            // Foreign origins remain intact and are rejected by the API.
            const port = incoming.socket.localPort;
            if (
              [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
                incoming.headers.origin || '',
              )
            ) {
              outgoing.setHeader('Origin', backend.origin);
            }
          });
        },
      },
    },
  },
  build: { outDir: fileURLToPath(new URL('../../target/web', import.meta.url)), emptyOutDir: true },
});
