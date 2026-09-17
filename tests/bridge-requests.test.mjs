/*
 * [INPUT]: 实际请求桥与合成 CDP binding、可控时钟。
 * [OUTPUT]: 失联时弹出请求及时释放、可重试，模型生成仍保留长超时。
 * [POS]: 请求桥生命周期行为回归，不连接真实宿主。
 * [PROTOCOL]: 变更时核对 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('unanswered popout expires independently from generation and can be retried', async () => {
  const sent = [];
  const timers = new Map();
  let sequence = 0;
  let now = 0;
  const window = { __companionHostRequest: (raw) => sent.push(JSON.parse(raw)) };
  runInNewContext(readFileSync(new URL('../ui/bridge/requests.js', import.meta.url), 'utf8'), {
    window,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const bridge = window.__companionDesktop;
  const generation = window.__companionDesktopRequest('/stepwise/generate');
  const detach = window.__companionDesktopRequest('/panel/detach');
  now = 10000;
  for (const timer of [...timers.values()]) if (timer.at <= now) timer.callback();
  assert.match((await detach).error, /后台连接/);
  assert.equal(bridge.pending(), 1, 'generation remains pending');
  const retry = window.__companionDesktopRequest('/panel/detach');
  bridge.complete(sent[1].id, { ok: true });
  assert.equal(bridge.pending(), 2, 'late response cannot complete the retry');
  bridge.complete(sent[2].id, { ok: true });
  assert.equal((await retry).ok, true);
  bridge.complete(sent[0].id, { ok: true });
  assert.equal((await generation).ok, true);
  assert.equal(bridge.pending(), 0);
  assert.equal(timers.size, 0, 'all request timers cleaned up');
});
