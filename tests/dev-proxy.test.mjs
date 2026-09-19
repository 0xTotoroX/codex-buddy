/*
 * [INPUT]: 实际 Vite 配置与临时 loopback API。
 * [OUTPUT]: 开发保存、来源隔离和令牌保留的回归检查。
 * [POS]: 开发代理的 HTTP 行为契约。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test(
  'Vite translates its own origin and closes after a cold module request',
  { timeout: 20000 },
  async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'buddy-vite-proxy-'));
    const api = createHttpServer((req, res) => {
      const origin = `http://127.0.0.1:${api.address().port}`;
      res.statusCode =
        req.headers.origin !== origin
          ? 403
          : req.headers.authorization !== 'Bearer fixture-token'
            ? 401
            : 200;
      res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin }));
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const target = `http://127.0.0.1:${api.address().port}`;
    const previous = process.env.CODEX_BUDDY_DEV_API;
    process.env.CODEX_BUDDY_DEV_API = target;
    let vite;
    try {
      vite = await createServer({
        configFile: new URL('../ui/settings/vite.config.ts', import.meta.url).pathname,
        server: { port: 0 },
        cacheDir,
        logLevel: 'silent',
      });
      await vite.listen();
      const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
      const moduleResponse = await fetch(`${origin}/api.ts`);
      assert.equal(moduleResponse.status, 200, 'frontend api.ts must not enter the backend proxy');
      assert.match(moduleResponse.headers.get('content-type'), /javascript/);
      await moduleResponse.text();
      const send = (source, token = 'fixture-token') =>
        fetch(`${origin}/api/settings`, {
          method: 'POST',
          headers: {
            Origin: source,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
      const saved = await send(origin);
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { host: new URL(target).host, origin: target });
      assert.equal((await send('https://example.com')).status, 403);
      assert.equal((await send('http://127.0.0.1:1')).status, 403);
      assert.equal((await send(origin, 'invalid-token')).status, 401);
    } finally {
      if (previous === undefined) delete process.env.CODEX_BUDDY_DEV_API;
      else process.env.CODEX_BUDDY_DEV_API = previous;
      await vite?.close();
      api.closeAllConnections();
      await new Promise((resolve) => api.close(resolve));
      rmSync(cacheDir, { recursive: true, force: true });
    }
  },
);

test('development gateway retains its session token across backend restarts', async () => {
  const { startGateway } = await import('../scripts/dev-runtime.mjs');
  let expected = 'backend-one';
  const api = createHttpServer((req, res) => {
    const origin = `http://127.0.0.1:${api.address().port}`;
    res.writeHead(
      req.headers.authorization === `Bearer ${expected}` && req.headers.origin === origin
        ? 200
        : 403,
      { 'Content-Type': 'application/json' },
    );
    res.end(JSON.stringify({ generation: expected }));
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  let runtime = { port: api.address().port, token: expected };
  const gateway = await startGateway('dev-session', () => runtime);
  try {
    const send = (token = 'dev-session', origin = gateway.origin) =>
      fetch(gateway.origin + '/api/settings', {
        headers: { Authorization: `Bearer ${token}`, Origin: origin },
      });
    assert.equal((await fetch(gateway.origin + '/fixture')).status, 404);
    assert.equal((await fetch(gateway.origin + '/v1/responses', { method: 'POST' })).status, 404);
    assert.equal((await send()).status, 200);
    assert.equal((await send('invalid')).status, 401);
    assert.equal((await send('dev-session', 'https://example.com')).status, 403);
    runtime = undefined;
    assert.equal((await send()).status, 503);
    expected = 'backend-two';
    runtime = { port: api.address().port, token: expected };
    assert.deepEqual(await (await send()).json(), { generation: 'backend-two' });
  } finally {
    await gateway.close();
    await new Promise((resolve) => api.close(resolve));
  }
});

test(
  'gateway permits slow model operations and cancels upstream when the client leaves',
  { timeout: 25000 },
  async () => {
    const { startGateway } = await import('../scripts/dev-runtime.mjs');
    let received, cancelled;
    const arrived = new Promise((resolve) => {
      received = resolve;
    });
    const left = new Promise((resolve) => {
      cancelled = resolve;
    });
    const api = createHttpServer((req, res) => {
      if (req.url === '/api/settings/models') {
        received();
        res.on('close', cancelled);
        return;
      }
      const timer = setTimeout(() => res.end('{"ok":true}'), 16000);
      res.on('close', () => clearTimeout(timer));
    });
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const gateway = await startGateway('fixture', () => ({
      port: api.address().port,
      token: 'upstream',
    }));
    try {
      const headers = { Authorization: 'Bearer fixture' };
      const result = await fetch(gateway.origin + '/api/settings/test', {
        method: 'POST',
        headers,
      });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { ok: true });
      const controller = new AbortController();
      const pending = fetch(gateway.origin + '/api/settings/models', {
        headers,
        signal: controller.signal,
      }).catch((error) => error.name);
      await arrived;
      controller.abort();
      assert.equal(await pending, 'AbortError');
      await left;
    } finally {
      await gateway.close();
      api.closeAllConnections();
      await new Promise((resolve) => api.close(resolve));
    }
  },
);

test('captured development commands return endpoints and preserve cancellation errors', async () => {
  const { command } = await import('../scripts/dev-runtime.mjs');
  const children = new Set();
  assert.equal(
    await command(
      process.execPath,
      ['-e', 'console.log("http://127.0.0.1:12345")'],
      {},
      children,
      true,
    ),
    'http://127.0.0.1:12345\n',
  );
  await assert.rejects(
    command(
      process.execPath,
      ['-e', 'console.error("已取消重开，ChatGPT 保持运行。"); process.exit(1)'],
      {},
      children,
      true,
    ),
    /已取消重开/,
  );
  assert.equal(children.size, 0);
});
