/* [INPUT]: Actual settings connection hook, synthetic authenticated SSE service and multiple tabs.
 * [OUTPUT]: Credential sharing/recovery without draft loss, cross-origin sharing or repeated writes.
 * [POS]: Isolated browser/storage and loopback server; no real keys or host changes.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('settings tabs recover shared credentials and token rotation without replaying writes', async () => {
  const js = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {useCompanion,request} from './ui/settings/api';
    window.testRequest=request;
    function App(){const {live,error}=useCompanion();return <><output data-live={String(live)}>{error}</output><textarea aria-label="未保存草稿" /></>}
    createRoot(document.getElementById('root')).render(<App/>);
  `,
      },
      bundle: true,
      write: false,
      format: 'iife',
      jsx: 'automatic',
    })
  ).outputFiles[0].text;
  let expected = 'fixture-one',
    writes = 0;
  const streams = new Set();
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      if (req.method === 'POST') writes++;
      if (req.headers.authorization !== `Bearer ${expected}` || req.url === '/api/reject') {
        res
          .writeHead(401, { 'Content-Type': 'application/json' })
          .end('{"ok":false,"message":"fixture unauthorized"}');
        return;
      }
      if (req.url === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"version":"fixture","connection":{"status":"connected"}}\n\n');
        streams.add(res);
        res.on('close', () => streams.delete(res));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<div id="root"></div><script>' + js.replaceAll('</script', '<\\/script') + '</script>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const connected = (page) =>
    page.locator('output[data-live="true"]').waitFor({ state: 'attached' });
  try {
    const a = await context.newPage();
    await a.goto(origin + '/#settings-surfaces');
    await a.getByText(/尚未连接 Buddy/).waitFor();
    const b = await context.newPage();
    await b.goto(origin + '/#token=fixture-one');
    await connected(b);
    await connected(a);
    assert.ok(!b.url().includes('token='));
    const c = await context.newPage();
    await c.goto(origin + '/#settings-overview');
    await connected(c);
    await c.getByLabel('未保存草稿').fill('不要丢弃这段编辑');
    expected = 'fixture-two';
    for (const stream of streams) stream.end();
    await c.getByText(/连接已过期/).waitFor();
    await b.goto(origin + '/#token=fixture-two');
    await connected(a);
    await connected(c);
    assert.equal(await c.getByLabel('未保存草稿').inputValue(), '不要丢弃这段编辑');
    assert.equal(await c.evaluate(() => sessionStorage.getItem('companion-token')), 'fixture-two');
    assert.equal(writes, 0);
    await c.evaluate(() => window.testRequest('reject', {}).catch(() => {}));
    assert.equal(writes, 1);
    await Promise.all([a.close(), b.close(), c.close()]);
    const restored = await context.newPage();
    await restored.goto(origin + '/#settings-surfaces');
    await connected(restored);
    const other = await browser.newContext();
    const isolated = await other.newPage();
    await isolated.goto(origin);
    await isolated.getByText(/尚未连接 Buddy/).waitFor();
    await other.close();
    const legacy = await browser.newContext();
    await legacy.addInitScript(() => sessionStorage.setItem('companion-token', 'fixture-two'));
    const old = await legacy.newPage();
    await old.goto(origin);
    await connected(old);
    assert.equal(await old.evaluate(() => localStorage.getItem('companion-token')), 'fixture-two');
    await legacy.close();
  } finally {
    await browser.close();
    for (const stream of streams) stream.end();
    await new Promise((r) => server.close(r));
  }
});
