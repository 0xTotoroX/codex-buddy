/*
 * [INPUT]: 实际 boot 脚本与可控制位置/置顶请求顺序的合成 API。
 * [OUTPUT]: 浮窗自身的写入串行、修订号推进及真正外部冲突仍被报告的回归。
 * [POS]: 偏好同步时序测试，不操作真实宿主。
 * [PROTOCOL]: 变更时更新 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('popout serializes position pin and appearance without hiding external conflicts', async () => {
  const timers = new Map();
  let sequence = 0,
    revision = 1,
    releasePosition;
  const writes = [],
    messages = [];
  const ui = { material: 'solid', width: 600 };
  const notice = { textContent: '' };
  const window = {
    __companionFloatingPanel: {
      state: { runtimeActive: true },
      panelPreferences: () => ui,
      receivePanelState: async () => {},
    },
    ipc: { postMessage: (value) => messages.push(JSON.parse(value)) },
  };
  const tick = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const fire = async (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `timer ${delay}`);
    timers.delete(entry[0]);
    const result = entry[1].fn();
    await tick();
    return result;
  };
  runInNewContext(readFileSync('ui/panel/popout/boot.js', 'utf8'), {
    window,
    URLSearchParams,
    AbortSignal,
    console,
    location: { hash: '#token=fixture&lease=fixture' },
    sessionStorage: { getItem() {}, setItem() {} },
    history: { replaceState() {} },
    document: { documentElement: { dataset: {} }, getElementById: () => notice },
    setTimeout: (fn, delay) => {
      const id = ++sequence;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith('/state'))
        return {
          ok: true,
          json: async () => ({ preferences: { revision, webRevision: 0, ui }, ready: true }),
        };
      if (!url.endsWith('/preferences')) return { ok: true, json: async () => ({}) };
      writes.push(body);
      if (body.position)
        await new Promise((resolve) => {
          releasePosition = resolve;
        });
      const conflict = body.expectedRevision !== undefined && body.expectedRevision !== revision;
      if (!conflict) revision++;
      return {
        ok: !conflict,
        json: async () => (conflict ? { message: '外观已在其他窗口更新，请重试' } : { revision }),
      };
    },
  });
  await fire(0);
  const api = window.__companionPopout;
  api.moved({ x: 10, y: 20 });
  await fire(350);
  const pin = api.pin(true);
  api.save({ ...ui, material: 'frosted' });
  await fire(250);
  assert.equal(writes.length, 1, 'pin and appearance must wait for the position response');
  releasePosition();
  await pin;
  await tick();
  assert.equal(writes.length, 3);
  assert.equal(writes[2].expectedRevision, 3);
  assert.equal(revision, 4);
  assert.equal(notice.textContent, '');
  assert.equal(messages.filter((m) => m.kind === 'pin' && m.value).length, 1);
  revision++; // A genuine concurrent external edit remains protected.
  api.save({ ...ui, material: 'native-glass' });
  await fire(250);
  await tick();
  assert.match(notice.textContent, /其他窗口更新/);
  assert.equal(revision, 5);
});
