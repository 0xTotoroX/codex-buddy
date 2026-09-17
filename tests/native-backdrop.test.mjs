/*
 * [INPUT]: 实际窗口 boot 脚本与暂停动画帧的合成浏览器环境。
 * [OUTPUT]: 不依赖动画帧的原生外观通知、正文变更不测量背景、同批几何合并及重叠尺寸请求不丢失的回归。
 * [POS]: 原生 IPC 时序契约，不截图或连接真实宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('native backdrop updates even while animation frames are suspended', () => {
  const messages = [],
    frames = [],
    microtasks = [];
  let measurements = 0;
  let changed;
  const state = {
    runtimeActive: true,
    open: true,
    material: 'native-glass',
    liquidVariant: 'regular',
    theme: 'light',
    glass: {
      getBoundingClientRect: () => {
        measurements += 1;
        return { x: 12, y: 12, width: 404, height: 420 };
      },
      getAnimations: () => [{ playState: 'running' }],
    },
  };
  const window = {
    __companionNativeBackdrop: true,
    __companionFloatingPanel: { state },
    ipc: { postMessage: (raw) => messages.push(JSON.parse(raw)) },
    addEventListener() {},
  };
  const environment = {
    window,
    matchMedia: () => ({ matches: false }),
    URLSearchParams,
    AbortSignal,
    console,
    location: { hash: '#token=fixture&lease=fixture' },
    history: { replaceState() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: { dataset: {} }, body: {}, getElementById: () => null },
    MutationObserver: class {
      constructor(callback) {
        changed = callback;
      }
      observe() {}
    },
    getComputedStyle: () => ({ borderTopLeftRadius: '25px' }),
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    queueMicrotask: (callback) => microtasks.push(callback),
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: () => new Promise(() => {}),
  };
  runInNewContext(
    readFileSync(new URL('../ui/panel/popout/boot.js', import.meta.url), 'utf8'),
    environment,
  );
  const notify = () => {
    changed([{ type: 'attributes', target: state.glass }]);
    microtasks.shift()?.();
  };
  assert.equal(messages.at(-1)?.material, 'native-glass');
  assert.equal('theme' in messages.at(-1), false, 'backdrop must inherit system appearance');
  assert.equal(messages.at(-1)?.open, true);
  state.open = false;
  notify();
  assert.equal(messages.at(-1)?.open, false, 'collapse reaches AppKit without geometry or a frame');
  state.open = true;
  notify();
  assert.equal(messages.at(-1)?.open, true, 'expand restores Regular without a frame');
  state.liquidVariant = 'clear';
  notify();
  assert.equal(
    messages.at(-1)?.liquidVariant,
    'clear',
    'expanded Clear reaches AppKit without waiting for animation frames',
  );
  state.liquidVariant = 'regular';
  notify();
  assert.equal(messages.at(-1)?.liquidVariant, 'regular');
  state.theme = 'dark';
  notify();
  assert.equal('theme' in messages.at(-1), false);
  state.material = 'frosted';
  notify();
  assert.equal(
    messages.at(-1)?.material,
    'frosted',
    'Frosted selection reaches AppKit without a frame',
  );
  assert.equal('glassStyle' in messages.at(-1), false);
  state.material = 'matte';
  notify();
  assert.equal(messages.at(-1)?.material, 'matte');
  const count = messages.length;
  notify();
  notify();
  assert.equal(messages.length, count, 'unchanged geometry should not send repeated IPC');
  assert.equal(frames.length, 1, 'only animation geometry needs one pending frame');
  const beforeMeasurements = measurements;
  changed([{ type: 'attributes', target: {} }]);
  assert.equal(microtasks.length, 0, 'content mutations do not measure the backdrop');
  for (let i = 0; i < 5; i++) changed([{ type: 'attributes', target: state.glass }]);
  assert.equal(microtasks.length, 1, 'geometry changes in one turn are coalesced');
  microtasks.shift()();
  assert.equal(measurements, beforeMeasurements + 1);
  assert.equal(messages.length, count, 'coalescing does not resend unchanged geometry');
  window.__companionPopout.toggleTheme();
  assert.deepEqual(messages.at(-1), { kind: 'system-theme', dark: true });
  const pending = messages.length;
  window.__companionPopout.toggleTheme();
  assert.equal(messages.length, pending, 'do not launch overlapping system changes');
  window.__companionPopout.themeResult('permission denied');
  window.__companionPopout.toggleTheme();
  assert.equal(messages.length, pending + 1, 'failure releases the button for retry');
});

test('popout size stays expanded and retains the latest resize request', async () => {
  const { build } = await import('esbuild');
  const result = await build({
    stdin: {
      contents: `export { sizeNativePanel } from './ui/panel/popout/transport.js'; export { shellState } from './ui/panel/runtime/state.js';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'subject',
  });
  const requests = [];
  let acknowledge;
  const window = {
    __companionPopout: {
      size: (...size) => {
        requests.push(size);
        return new Promise((resolve) => {
          acknowledge = resolve;
        });
      },
    },
  };
  const context = { window };
  runInNewContext(result.outputFiles[0].text, context);
  const { shellState, sizeNativePanel } = context.subject;
  Object.assign(shellState, { width: 404, height: 420, activeTab: 'next' });
  const collapsed = sizeNativePanel(false);
  const expanded = sizeNativePanel(true);
  acknowledge();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [
    [428, 464],
    [428, 464],
  ]);
  assert.equal(shellState.nativeSizeChanging, true);
  acknowledge();
  await Promise.all([collapsed, expanded]);
  assert.equal(shellState.nativeSizeChanging, false);
});

test('material migration preserves the old glass choice and new choices remain authoritative', async () => {
  const { build } = await import('esbuild');
  const result = await build({
    stdin: {
      contents: `export { readMaterial } from './ui/panel/core/panel-appearance.js';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'subject',
  });
  for (const [style, expected] of [
    ['regular', 'frosted'],
    ['clear', 'native-glass'],
  ]) {
    const values = new Map([
      ['companion-stepwise-material-v3', 'native-glass'],
      ['companion-glass-style', style],
    ]);
    const context = {
      window: {},
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
    };
    runInNewContext(result.outputFiles[0].text, context);
    assert.equal(context.subject.readMaterial(), expected);
    assert.equal(values.has('companion-glass-style'), false);
    values.set('companion-stepwise-material-v4', 'matte');
    assert.equal(context.subject.readMaterial(), 'matte');
  }
});
