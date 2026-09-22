/*
 * [INPUT]: Playwright Chromium、仅合成的 model-control API 与原生事件。
 * [OUTPUT]: 独立视图行为验收、JSON 结果与 target/reports/model-control 截图。
 * [POS]: 不启动宿主、不调用 CDP 或模型；静态路由与父服务约定相同。
 * [PROTOCOL]: 由父任务接入统一验证及地图；独立运行 node tests/model-control-view.mjs。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'target/reports/model-control');
mkdirSync(output, { recursive: true });
const origin = 'http://127.0.0.1:47991';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
  headless: true,
});
const results = [];
const cases = [];
const test = (name, run) => cases.push({ name, run });
const copy = (value) => structuredClone(value);
const selection = (model = 'alpha', reasoning = 'high', speed = 'standard') => ({
  model,
  reasoning,
  speed,
});
function fixture() {
  return {
    snapshot: {
      target: { id: 'task-a', title: '合成任务 · 模型控制界面验收' },
      revision: 'source-1',
      status: 'ready',
      message: '',
      current: selection(),
      models: [
        { id: 'alpha', label: 'Alpha', reasoning: ['low', 'medium', 'high'], fast: true },
        { id: 'beta', label: 'Beta', reasoning: ['medium', 'high'], fast: false },
        { id: 'gamma', label: 'Gamma', reasoning: ['low', 'high'], fast: true },
        { id: 'delta', label: 'Delta', reasoning: ['high'], fast: true },
      ],
      generating: false,
    },
    preferences: {
      edge: 'right',
      position: 0.5,
      screen: '',
      keepOpen: false,
      modelColumnWidth: 144,
      pinned: ['alpha', 'beta'],
      presets: [
        { id: 'p1', name: '日常', selection: selection() },
        { id: 'p2', name: '快速', selection: selection('gamma', 'low', 'fast') },
        { id: 'bad', name: '不可用 Fast', selection: selection('beta', 'high', 'fast') },
      ],
    },
    revision: 1,
  };
}
async function setup({
  initial = fixture(),
  native = true,
  viewport = { width: 480, height: 640 },
  expand = true,
  auth = true,
  controlledClock = false,
} = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(6000);
  if (controlledClock) await page.clock.install({ time: new Date(2030, 0, 1) });
  const f = {
    data: copy(initial),
    requests: [],
    unexpected: [],
    errors: [],
    preferenceConflict: false,
    applyResult: 'success',
    delayApply: null,
    delayState: null,
    stateError: false,
  };
  page.on('pageerror', (error) => f.errors.push(error.message));
  await page.addInitScript(
    ({ native }) => {
      window.nativeMessages = [];
      if (native)
        window.ipc = {
          postMessage(raw) {
            const message = JSON.parse(raw);
            window.nativeMessages.push(message);
            if (
              message.action === 'expand' ||
              message.action === 'collapse' ||
              message.action === 'edge'
            )
              window.dispatchEvent(
                new CustomEvent('model-control-native', {
                  detail: {
                    ...(message.action === 'edge' ? {} : { expanded: message.action === 'expand' }),
                    edge: message.edge || document.body.dataset.edge,
                    ...(message.action === 'expand' ? { keyboard: message.keyboard } : {}),
                  },
                }),
              );
          },
        };
    },
    { native },
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (url.origin !== origin) {
      f.unexpected.push(request.url());
      return route.abort();
    }
    if (path.startsWith('/api/model-control/')) {
      const operation = path.split('/').at(-1),
        payload = request.postDataJSON();
      f.requests.push({ operation, method: request.method(), payload, headers: request.headers() });
      if (
        request.headers().authorization !== 'Bearer synthetic-token' ||
        request.headers()['x-model-control-lease'] !== 'synthetic-lease'
      )
        return route.fulfill({ status: 401, json: { message: '未授权' } });
      if (operation === 'displays')
        return route.fulfill({
          json: {
            screens: [{ id: 'fixture-screen', label: 'Fixture display' }],
            nativeGlassAvailable: true,
          },
        });
      if (operation === 'state') {
        const data = copy(f.data);
        const barrier = f.delayState;
        if (barrier) {
          f.delayState = null;
          await barrier;
        }
        if (f.stateError) return route.fulfill({ status: 503, json: { message: '合成断连' } });
        return route.fulfill({ json: data });
      }
      if (operation === 'refresh') {
        if (f.onRefresh) f.onRefresh();
        return route.fulfill({ json: f.data });
      }
      if (operation === 'preferences') {
        if (f.preferenceConflict || payload.revision !== f.data.revision) {
          f.preferenceConflict = false;
          return route.fulfill({ status: 409, json: { message: 'stale preference revision' } });
        }
        Object.assign(f.data.preferences, payload.patch);
        f.data.revision++;
        return route.fulfill({ json: f.data });
      }
      if (operation === 'apply') {
        if (f.delayApply) await f.delayApply;
        if (f.failApply) return route.fulfill({ status: 409, json: { message: '目标已变化' } });
        const previous = copy(f.data.snapshot.current);
        if (f.applyResult === 'success') f.data.snapshot.current = copy(payload.selection);
        if (f.applyResult === 'partial')
          f.data.snapshot.current = { ...payload.selection, speed: 'standard' };
        f.data.snapshot.revision = `${f.data.snapshot.revision}-applied`;
        return route.fulfill({
          json: {
            ...f.data,
            result: {
              status: f.applyResult,
              message: '合成回读',
              previous,
              snapshot: copy(f.data.snapshot),
            },
          },
        });
      }
      if (operation === 'close') return route.fulfill({ json: { ok: true } });
      f.unexpected.push(path);
      return route.abort();
    }
    const file =
      path === '/model-control'
        ? 'ui/model-control/index.html'
        : path === '/model-control/tokens.css'
          ? 'ui/tokens.css'
          : path === '/model-control/icons.js'
            ? 'ui/panel/icons/index.js'
            : ['app.js', 'view.js', 'styles.css'].some((name) => path === `/model-control/${name}`)
              ? `ui${path}`
              : null;
    if (!file) {
      f.unexpected.push(path);
      return route.abort();
    }
    await route.fulfill({
      contentType: path.endsWith('.css')
        ? 'text/css'
        : path.endsWith('.js')
          ? 'text/javascript'
          : 'text/html',
      body: readFileSync(resolve(root, file), 'utf8'),
    });
  });
  await page.goto(
    `${origin}/model-control${auth ? '#token=synthetic-token&lease=synthetic-lease' : ''}`,
  );
  if (auth)
    await page.waitForFunction(
      (status) => document.body.dataset.status === status,
      initial.snapshot.status,
    );
  if (expand) await nativeEvent(page, { expanded: true, edge: 'right', keyboard: false });
  await page.mouse.move(470, 20);
  if (expand)
    await page
      .locator('#panel')
      .evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
  if (controlledClock) await page.clock.pauseAt(new Date(2030, 0, 1, 1));
  return { page, f };
}
async function nativeEvent(page, detail) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('model-control-native', { detail })),
    detail,
  );
}
const applies = (f) => f.requests.filter((item) => item.operation === 'apply');
const writes = (f) => f.requests.filter((item) => item.method === 'POST');
const modelButton = (page, model, reasoning) =>
  page.locator(`.choices button[data-model="${model}"][data-reasoning="${reasoning}"]`);
async function poll(page, condition) {
  await page.waitForFunction(condition, null, { timeout: 6000 });
}
async function cleanup({ page, f }) {
  assert.deepEqual(f.unexpected, [], 'No host/network requests outside the synthetic API');
  assert.deepEqual(f.errors, [], 'No browser errors');
  await page.close();
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(output, `${name}.png`) });
}
async function menu(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
}

test('one shell reaches compact geometry without padded contour swap or size feedback', async () => {
  const ctx = await setup();
  const { page } = ctx;
  await page.evaluate(() => {
    window.savedSurface = document.getElementById('surface');
  });
  await nativeEvent(page, {
    expanded: true,
    animating: true,
    unfold: 0.8,
    layoutWidth: 480,
    width: 400,
    height: 200,
  });
  const before = await page.evaluate(
    () => window.nativeMessages.filter((m) => m.action === 'content-size').length,
  );
  for (const width of [100, 32, 16, 11, 10]) {
    await page.setViewportSize({ width, height: 80 });
    await nativeEvent(page, {
      expanded: false,
      animating: true,
      unfold: 0.01,
      layoutWidth: 480,
      width,
      height: 80,
    });
    assert.equal(await page.locator('#surface').evaluate((n) => n.clientWidth), width);
    assert.equal(await page.locator('#panel').evaluate((n) => n.clientWidth), 480);
  }
  const lastClip = await page.locator('#surface').evaluate((n) => n.style.clipPath);
  assert.equal(
    await page.evaluate(
      () => window.nativeMessages.filter((m) => m.action === 'content-size').length,
    ),
    before,
  );
  await nativeEvent(page, { expanded: false, animating: false, unfold: 0, width: 10, height: 80 });
  assert.equal(await page.locator('#surface').evaluate((n) => n.style.clipPath), lastClip);
  assert.equal(
    await page.evaluate(() => window.savedSurface === document.getElementById('surface')),
    true,
  );
  await cleanup(ctx);
});

test('first model cell uses one apply transaction with speed-preservation intent', async () => {
  const initial = fixture();
  initial.snapshot.status = 'waiting';
  initial.snapshot.current = null;
  const ctx = await setup({ initial });
  const { page, f } = ctx;
  await modelButton(page, 'alpha', 'high').click();
  await poll(page, () => document.getElementById('notice').textContent.includes('配置已应用'));
  assert.equal(f.requests.filter((r) => r.operation === 'refresh').length, 0);
  assert.equal(applies(f).length, 1);
  assert.equal(applies(f)[0].payload.preserveSpeed, true);
  assert.equal(applies(f)[0].payload.target.id, initial.snapshot.target.id);
  await cleanup(ctx);
});
test('first-click backend failure stays failure without automatic retry', async () => {
  const initial = fixture();
  initial.snapshot.status = 'waiting';
  initial.snapshot.current = null;
  const ctx = await setup({ initial });
  const { page, f } = ctx;
  f.applyResult = 'failed';
  await modelButton(page, 'alpha', 'high').click();
  await poll(page, () => document.getElementById('notice').textContent.includes('未成功'));
  assert.equal(applies(f).length, 1);
  assert.equal(f.requests.filter((r) => r.operation === 'refresh').length, 0);
  await cleanup(ctx);
});
test('answer generation does not disable a ready official selector', async () => {
  const initial = fixture();
  initial.snapshot.generating = true;
  const ctx = await setup({ initial });
  const { page, f } = ctx;
  assert.equal(await modelButton(page, 'alpha', 'high').isDisabled(), false);
  assert.match(await page.locator('#status').innerText(), /可调整后续配置/);
  await modelButton(page, 'alpha', 'high').click();
  await poll(page, () => document.getElementById('notice').textContent.includes('配置已应用'));
  assert.equal(applies(f).length, 1);
  await cleanup(ctx);
});

// Contract and rendering checks use actual DOM, not implementation-shaped unit assertions.
test('authenticated passive polling preserves focus, search, hover, scroll and menus', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  await page.keyboard.press('Meta+f');
  await page.locator('#search').fill('a');
  await page
    .locator('#search')
    .evaluate((node) => node.setSelectionRange?.(1, 1))
    .catch(() => {});
  await page.evaluate(() => {
    window.savedInput = document.querySelector('#search');
    window.savedCell = document.querySelector('.choices button');
  });
  await page.waitForTimeout(1450);
  assert.equal(await page.locator('#search').inputValue(), 'a');
  assert.equal(await page.evaluate(() => document.activeElement === window.savedInput), true);
  assert.equal(
    await page.evaluate(() => document.querySelector('.choices button') === window.savedCell),
    true,
  );
  assert.equal(await page.locator('#menu').isHidden(), true);
  assert.equal(writes(f).length, 0);
  assert.ok(f.requests.filter((item) => item.operation === 'state').length >= 2);
  assert.equal(new URL(page.url()).hash, '');
  await page.keyboard.press('Meta+f');
  await page.locator('#search').fill('');
  await menu(page, '设置菜单');
  await page.waitForTimeout(1350);
  assert.equal(await page.locator('#menu').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-key="p1"]').hover();
  await page.waitForTimeout(1350);
  assert.match(await page.locator('#preview').innerText(), /Alpha.*high.*Standard/);
  assert.equal(
    await page.locator('[data-key="p1"]').evaluate((node) => node.matches(':hover')),
    true,
  );
  await shot(page, 'expanded-matrix');
  await menu(page, '刷新可用模型');
  await poll(page, () => document.querySelector('#notice').textContent.includes('已刷新'));
  assert.deepEqual(f.requests.find((item) => item.operation === 'refresh').payload, {});
  await cleanup(ctx);
});

test('frozen apply, double-click guard, actual-only result and explicit same-target restore', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  let release;
  f.delayApply = new Promise((resolve) => {
    release = resolve;
  });
  await modelButton(page, 'alpha', 'low').click();
  await page.waitForTimeout(100);
  assert.match(await page.locator('#actual').innerText(), /high/);
  assert.equal(await modelButton(page, 'alpha', 'high').isDisabled(), true);
  assert.equal(await page.locator('#save').isDisabled(), true);
  assert.equal(applies(f).length, 1);
  assert.deepEqual(applies(f)[0].payload, {
    target: { id: 'task-a', title: '合成任务 · 模型控制界面验收' },
    expectedRevision: 'source-1',
    selection: selection('alpha', 'low'),
    preserveSpeed: true,
  });
  release();
  f.delayApply = null;
  await poll(page, () => document.querySelector('#actual').textContent.includes('low'));
  assert.equal(await page.locator('#undo').isVisible(), true);
  assert.equal(applies(f).length, 1, 'No automatic rollback');
  await page.locator('#undo').click();
  await poll(page, () => document.querySelector('#actual').textContent.includes('high'));
  assert.equal(applies(f).length, 2);
  assert.equal(applies(f)[1].payload.expectedRevision, 'source-1-applied');
  await modelButton(page, 'alpha', 'low').click();
  await poll(page, () => document.querySelector('#undo').hidden === false);
  f.data.snapshot.target = { id: 'task-b', title: '另一合成任务' };
  f.data.snapshot.revision = 'other-target';
  await poll(page, () => document.querySelector('#target').textContent === '另一合成任务');
  assert.equal(await page.locator('#undo').isHidden(), true);
  await cleanup(ctx);
});

test('partial and failed applies show service actual state without optimistic or automatic writes', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  f.applyResult = 'partial';
  await menu(page, '应用预设 快速');
  await poll(page, () => document.querySelector('#notice').textContent.includes('部分'));
  assert.match(await page.locator('#actual').innerText(), /Gamma.*low.*Standard/);
  assert.equal(applies(f).length, 1);
  await shot(page, 'partial-result');
  f.applyResult = 'failed';
  await modelButton(page, 'alpha', 'high').click();
  await poll(page, () => document.querySelector('#notice').textContent.includes('未成功'));
  assert.match(await page.locator('#actual').innerText(), /Gamma.*low.*Standard/);
  assert.equal(applies(f).length, 2);
  f.failApply = true;
  await modelButton(page, 'alpha', 'high').click();
  await poll(page, () => document.querySelector('#notice').textContent.includes('未确认'));
  assert.equal(applies(f).length, 3);
  await cleanup(ctx);
});

test('unavailable, busy and conflicting sources disable writes', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  for (const status of ['unavailable', 'busy', 'conflict']) {
    f.data.snapshot.status = status;
    await page.waitForFunction((status) => document.body.dataset.status === status, status);
    assert.equal(await modelButton(page, 'alpha', 'low').isDisabled(), true, status);
    assert.equal(
      await page.getByRole('button', { name: '应用预设 日常', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.locator('#save').isDisabled(), true);
  }
  f.data.snapshot.status = 'ready';
  f.data.snapshot.generating = true;
  await poll(page, () => document.querySelector('#status').textContent.includes('正在回答'));
  assert.equal(await page.locator('#fast').isDisabled(), false);
  await shot(page, 'generation-next-config');
  f.data.snapshot.generating = false;
  await poll(page, () => !document.querySelector('#save').disabled);
  assert.equal(
    await page.getByRole('button', { name: '应用预设 不可用 Fast', exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press('Meta+f');
  await page.locator('#search').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('3');
  assert.equal(applies(f).length, 0);
  assert.equal(writes(f).length, 0);
  await cleanup(ctx);
});

test('unsupported manual Fast explicitly previews Standard before selection; unpinned actual remains visible', async () => {
  const initial = fixture();
  initial.snapshot.current = selection('alpha', 'high', 'fast');
  initial.preferences.pinned = ['beta'];
  const ctx = await setup({ initial });
  const { page, f } = ctx;
  assert.equal(await modelButton(page, 'alpha', 'high').isVisible(), true);
  assert.equal(await modelButton(page, 'alpha', 'high').getAttribute('aria-pressed'), 'true');
  const target = modelButton(page, 'beta', 'medium');
  assert.match(await target.getAttribute('title'), /不支持 Fast.*Standard/);
  assert.match(await target.getAttribute('aria-label'), /Standard/);
  await target.click();
  await poll(page, () => document.querySelector('#actual').textContent.includes('Beta'));
  assert.equal(applies(f)[0].payload.selection.speed, 'standard');
  assert.equal(await page.locator('#fast').isDisabled(), true);
  await cleanup(ctx);
});

test('preferences conflict refreshes once without overwrite; save only frozen confirmed state', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  await page.locator('#save').click();
  await page.locator('#preset-name').fill('确认配置');
  f.data.snapshot.current = selection('alpha', 'low');
  f.data.snapshot.revision = 'source-new';
  await poll(page, () => document.querySelector('#actual').textContent.includes('low'));
  assert.equal(await page.locator('#editor-submit').isDisabled(), true);
  assert.equal(await page.locator('#preset-name').inputValue(), '确认配置');
  assert.equal(
    await page.locator('#preset-name').evaluate((node) => node === document.activeElement),
    true,
  );
  await page.locator('#editor-cancel').click();
  await page.locator('#save').click();
  await page.locator('#preset-name').fill('确认配置');
  await page.locator('#editor-submit').click();
  await poll(page, () => document.querySelector('#editor').hidden);
  assert.deepEqual(f.data.preferences.presets.at(-1).selection, selection('alpha', 'low'));
  const before = copy(f.data.preferences.presets);
  await menu(page, '预设 日常 菜单');
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.locator('#preset-name').fill('不应覆盖');
  f.data.preferences.presets[0].name = '其他窗口已改名';
  f.data.revision++;
  await page.locator('#editor-submit').click();
  await poll(page, () => document.querySelector('#notice').textContent.includes('未覆盖'));
  assert.equal(f.data.preferences.presets[0].name, '其他窗口已改名');
  assert.equal(f.data.preferences.presets.length, before.length);
  assert.equal(f.requests.filter((item) => item.operation === 'preferences').length, 2);
  const patches = f.requests
    .filter((item) => item.operation === 'preferences')
    .map((item) => Object.keys(item.payload.patch));
  assert.deepEqual(patches, [['presets'], ['presets']]);
  await cleanup(ctx);
});

test('keyboard preset shortcuts only during keyboard operation; Escape closes menu then panel and rearms on leave', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  await page.keyboard.press('2');
  assert.equal(applies(f).length, 0);
  await menu(page, '设置菜单');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu').isHidden(), true);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('2');
  await poll(page, () => document.querySelector('#actual').textContent.includes('Gamma'));
  assert.equal(applies(f).length, 1);
  await page.keyboard.press('Meta+f');
  await page.locator('#search').fill('1');
  await page.keyboard.press('2');
  assert.equal(applies(f).length, 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#panel').isHidden(), true);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#panel').isHidden(), true);
  await cleanup(ctx);
});

test('hover timing, no activation, keep-open/edit/drag/busy guards and native errors', async () => {
  const ctx = await setup({
    expand: false,
    controlledClock: true,
    viewport: { width: 480, height: 640 },
  });
  const { page, f } = ctx;
  await page.mouse.move(300, 300);
  await page.mouse.move(5, 30);
  await page.clock.runFor(80);
  assert.equal(await page.locator('#panel').isVisible(), true);
  const messages = await page.evaluate(() => window.nativeMessages);
  assert.ok(messages.some((item) => item.action === 'expand' && item.keyboard === false));
  assert.equal(
    messages.some((item) => item.action === 'focus'),
    false,
  );
  await page.mouse.move(490, 660);
  await page.clock.runFor(220);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await page.clock.runFor(300);
  assert.equal(await page.locator('#panel').isHidden(), true);
  await nativeEvent(page, { expanded: true });
  await page.locator('#keep-open').click();
  await page.mouse.move(490, 660);
  await page.clock.runFor(500);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await page.locator('#keep-open').click();
  await page.keyboard.press('Meta+f');
  await page.locator('#search').focus();
  await page.mouse.move(490, 660);
  await page.clock.runFor(500);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await nativeEvent(page, { error: '快捷键注册失败：合成冲突' });
  assert.match(await page.locator('#notice').innerText(), /快捷键注册失败/);
  await cleanup(ctx);
});

test('unlimited presets/model rows support keyboard reorder, drag reorder, rename and delete', async () => {
  const initial = fixture();
  initial.preferences.presets.push(
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `extra-${index}`,
      name: `预设 ${index}`,
      selection: selection(),
    })),
  );
  initial.snapshot.models.push(
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `extra-model-${index}`,
      label: `Extra model ${index}`,
      reasoning: ['low', 'high'],
      fast: true,
    })),
  );
  const ctx = await setup({ initial });
  const { page, f } = ctx;
  assert.equal(await page.locator('.preset-chip').count(), 21);
  await page.locator('.preset-chip[data-key="p1"]').click({ button: 'right' });
  assert.equal(await page.locator('#menu').isVisible(), true);
  await page.getByRole('menuitem', { name: '向后移动', exact: true }).focus();
  await page.keyboard.press('Enter');
  await poll(page, () => document.querySelector('.preset-chip').dataset.key === 'p2');
  assert.equal(f.data.preferences.presets[0].id, 'p2');
  await page
    .locator('.preset-chip[data-key="p1"]')
    .dragTo(page.locator('.preset-chip[data-key="p2"]'));
  await poll(page, () => document.querySelector('.preset-chip').dataset.key === 'p1');
  await menu(page, '模型 Alpha 菜单');
  await page.getByRole('menuitem', { name: '向后移动', exact: true }).click();
  await poll(page, () => document.querySelector('#pinned > div').dataset.key === 'beta');
  await page
    .locator('#pinned [data-key="alpha"] .model-name')
    .dragTo(page.locator('#pinned [data-key="beta"] .model-name'));
  await poll(page, () => document.querySelector('#pinned > div').dataset.key === 'alpha');
  await menu(page, '预设 日常 菜单');
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.locator('#preset-name').fill('改名成功');
  await page.locator('#preset-name').press('Enter');
  await poll(page, () => document.querySelector('.preset-chip button').textContent === '改名成功');
  await menu(page, '预设 改名成功 菜单');
  await page.getByRole('menuitem', { name: '删除预设', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.preset-chip').length === 20);
  await page.locator('#others-toggle').click();
  await page.locator('#model-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const scroll = await page.locator('#model-scroll').evaluate((node) => node.scrollTop);
  await page.waitForTimeout(1350);
  assert.equal(await page.locator('#model-scroll').evaluate((node) => node.scrollTop), scroll);
  await cleanup(ctx);
});

test('column resizing captures pointer, bounds 100–280, resets and adapts to font/width without footer overflow', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  const box = await page.locator('#resize').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(900, box.y + 10);
  await page.mouse.up();
  await poll(page, () => document.querySelector('#resize').getAttribute('aria-valuenow') === '280');
  await page.locator('#resize').dblclick();
  await poll(page, () => document.querySelector('#resize').getAttribute('aria-valuenow') === '144');
  await page.locator('#resize').focus();
  await page.keyboard.press('ArrowLeft');
  await poll(page, () => document.querySelector('#resize').getAttribute('aria-valuenow') === '136');
  await nativeEvent(page, {
    appearance: { material: 'matte', liquidVariant: 'regular', fontOffset: 8 },
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await poll(page, () => document.body.dataset.layout === 'matrix');
  const geometry = await page.evaluate(() => ({
    footer: document.querySelector('footer').getBoundingClientRect().bottom,
    panel: document.querySelector('#panel').getBoundingClientRect().bottom,
    width: document.querySelector('#panel').scrollWidth,
    screen: innerWidth,
  }));
  assert.ok(geometry.footer <= geometry.panel, JSON.stringify(geometry));
  assert.ok(geometry.width <= geometry.screen, JSON.stringify(geometry));
  assert.equal(f.data.preferences.modelColumnWidth, 136);
  await shot(page, 'large-font-matrix');
  await cleanup(ctx);
});

test('initial compact pane, fallback events, native geometry/position and exit are isolated', async () => {
  const ctx = await setup({ expand: false, viewport: { width: 10, height: 80 } });
  const { page, f } = ctx;
  const box = await page.locator('#handle').boundingBox();
  assert.equal(box.width, 10);
  assert.equal(box.height, 80);
  assert.equal(await page.locator('#panel').isHidden(), true);
  assert.equal(await page.locator('#handle svg').count(), 0, 'Resting handle has no icon');
  await shot(page, 'compact-right');
  for (const edge of ['left', 'top']) {
    const width = edge === 'top' ? 80 : 10,
      height = edge === 'top' ? 10 : 80;
    await page.setViewportSize({ width, height });
    await nativeEvent(page, { edge, compactWidth: width, compactHeight: height });
    const rect = await page.locator('#handle').boundingBox();
    assert.deepEqual([rect.width, rect.height], [width, height]);
    assert.equal(
      await page.evaluate(
        ({ width, height }) => document.elementFromPoint(width / 2, height / 2)?.id,
        { width, height },
      ),
      'handle',
      'Thin center remains interactive',
    );
    await shot(page, `compact-${edge}-plain`);
  }
  await nativeEvent(page, {
    edge: 'top',
    notchWidth: 180,
    notchHeight: 32,
    compactWidth: 200,
    compactHeight: 32,
    notchX: 10,
  });
  await page.setViewportSize({ width: 200, height: 32 });
  const handleRect = await page.locator('#handle').boundingBox();
  assert.ok(handleRect.x + handleRect.width <= 10, 'Thin handle stays in the safe left flank');
  assert.equal(
    await page.evaluate(() => document.elementFromPoint(100, 16)?.closest('button') !== null),
    false,
    'No clickable UI under physical notch',
  );
  assert.equal((await page.locator('#handle').boundingBox()).height, 32);
  await shot(page, 'compact-top');
  await page.keyboard.down('Alt');
  await page.mouse.move(5, 10);
  await page.mouse.down();
  await page.mouse.move(40, 10);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const position = await page.evaluate(() =>
    window.nativeMessages.find((item) => item.action === 'position'),
  );
  assert.ok(Number.isFinite(position.delta) && position.delta > 0);
  assert.equal(await page.locator('#panel').isHidden(), true, 'Drag does not expand');
  await page.setViewportSize({ width: 480, height: 640 });
  await nativeEvent(page, { expanded: true, keyboard: true });
  await page.waitForFunction(() => document.activeElement.id === 'fast');
  await menu(page, '设置菜单');
  await page.getByRole('menuitemradio', { name: '左侧', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.edge === 'left');
  await nativeEvent(page, { edge: 'left', compactWidth: 10, compactHeight: 80 });
  assert.equal(f.data.preferences.edge, 'left');
  await menu(page, '设置菜单');
  await page.getByRole('menuitem', { name: '退出模型控制', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#panel').hidden && document.querySelector('#handle').hidden,
  );
  assert.deepEqual(f.requests.find((item) => item.operation === 'close').payload, {});
  assert.equal(await page.evaluate(() => window.nativeMessages.at(-1).action), 'hide');
  await cleanup(ctx);
  const fallback = await setup({ native: false, expand: false });
  await fallback.page.locator('#handle').focus();
  await fallback.page.keyboard.press('Enter');
  assert.equal(await fallback.page.locator('#panel').isVisible(), true);
  await cleanup(fallback);
});

test('theme and placement menus save independent preferences without applying a model', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  await menu(page, '设置菜单');
  await page.getByRole('menuitem', { name: '材质…', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '磨砂', exact: true }).click();
  assert.equal(f.data.preferences.theme, 'frosted');
  await menu(page, '设置菜单');
  await page.getByRole('menuitem', { name: '屏幕与位置…', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Fixture display', exact: true }).click();
  assert.equal(f.data.preferences.screen, 'fixture-screen');
  await menu(page, '设置菜单');
  await page.getByRole('menuitem', { name: '屏幕与位置…', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '靠前 · 20%', exact: true }).click();
  assert.equal(f.data.preferences.position, 0.2);
  assert.equal(applies(f).length, 0);
  await nativeEvent(page, { effectiveMaterial: 'frosted', nativeBackdrop: true });
  assert.equal(await page.locator('body').getAttribute('data-material'), 'frosted');
  assert.equal(
    await page.locator('#surface').evaluate((n) => getComputedStyle(n).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await cleanup(ctx);
});

test('compact handle and notch flanks retain each selected material', async () => {
  const ctx = await setup();
  const { page } = ctx;
  for (const material of ['black', 'matte', 'frosted', 'native-glass']) {
    const detail = {
      effectiveMaterial: material,
      nativeBackdrop: ['frosted', 'native-glass'].includes(material),
    };
    await nativeEvent(page, { ...detail, expanded: true });
    const expanded = await page
      .locator('#surface')
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    await nativeEvent(page, { ...detail, expanded: false });
    assert.equal(
      await page.locator('#surface').evaluate((n) => getComputedStyle(n).backgroundColor),
      expanded,
    );
    assert.equal(
      await page
        .locator('#notch-mask')
        .evaluate((n) => getComputedStyle(n, '::before').backgroundColor),
      expanded,
    );
  }
  await cleanup(ctx);
});

test('missing credentials fail closed; delayed state cannot overwrite an apply result', async () => {
  const missing = await setup({ auth: false });
  await poll(missing.page, () =>
    document.querySelector('#notice').textContent.includes('缺少窗口凭据'),
  );
  assert.equal(missing.f.requests.length, 0);
  assert.equal(await missing.page.locator('#save').isDisabled(), true);
  await cleanup(missing);
  const ctx = await setup();
  const { page, f } = ctx;
  let release;
  f.delayState = new Promise((resolve) => {
    release = resolve;
  });
  const count = f.requests.length;
  await page.waitForTimeout(1350);
  assert.ok(f.requests.length > count);
  await modelButton(page, 'alpha', 'low').click();
  await poll(page, () => document.querySelector('#actual').textContent.includes('low'));
  release();
  await page.waitForTimeout(150);
  assert.match(await page.locator('#actual').innerText(), /low/);
  assert.equal(applies(f).length, 1);
  await cleanup(ctx);
});

test('physical notch reserves expanded header, never steals editor focus, and supports dark mode', async () => {
  const ctx = await setup();
  const { page } = ctx;
  await page.setViewportSize({ width: 480, height: 640 });
  await nativeEvent(page, {
    expanded: true,
    edge: 'top',
    notchWidth: 180,
    notchHeight: 32,
    notchX: 150,
    compactWidth: 200,
    compactHeight: 32,
    keyboard: true,
  });
  await page.waitForFunction(() => document.activeElement.id === 'fast');
  const panel = await page.locator('#panel').boundingBox();
  assert.equal(panel.y, 32);
  assert.ok(panel.height < 320 && panel.height >= 144);
  await shot(page, 'top-notch-expanded');
  assert.equal(
    await page.evaluate(() => document.elementFromPoint(240, 16)?.closest('button') !== null),
    false,
  );
  await page.locator('#save').click();
  await page.locator('#preset-name').fill('编辑时不抢焦点');
  await nativeEvent(page, { expanded: true, keyboard: true, position: 0.6 });
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('#preset-name').evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('#panel').evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await shot(page, 'top-notch-expanded-dark');
  await cleanup(ctx);
});

test('busy and pointer capture block leave collapse; pointer cancellation discards width changes', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  let release;
  f.delayApply = new Promise((resolve) => {
    release = resolve;
  });
  await modelButton(page, 'alpha', 'low').click();
  await page.mouse.move(490, 660);
  await page.waitForTimeout(550);
  assert.equal(await page.locator('#panel').isVisible(), true);
  release();
  f.delayApply = null;
  await page.waitForFunction(() => document.querySelector('#panel').hidden);
  await nativeEvent(page, { expanded: true });
  await page
    .locator('#panel')
    .evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
  const rect = await page.locator('#resize').boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(-100, 660);
  await page.waitForTimeout(550);
  assert.equal(await page.locator('#panel').isVisible(), true);
  assert.equal(await page.locator('#resize').getAttribute('aria-valuenow'), '100');
  await page.locator('#resize').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  assert.equal(f.data.preferences.modelColumnWidth, 144);
  assert.equal(
    f.requests.some((request) => request.operation === 'preferences'),
    false,
  );
  await cleanup(ctx);
});

test('search matches preset names and full configurations as well as model labels', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  await page.keyboard.press('Meta+f');
  const search = page.getByRole('searchbox', { name: '搜索模型或预设' });
  await search.fill('快速');
  assert.equal(await page.locator('.preset-chip').count(), 1);
  assert.equal(await page.locator('.preset-chip').getAttribute('data-key'), 'p2');
  assert.equal(await page.locator('.model-row').count(), 0);
  await search.fill('gamma');
  assert.equal(await page.locator('.preset-chip').count(), 1);
  assert.equal(await page.locator('.model-row').count(), 1);
  await search.fill('standard');
  assert.equal(await page.locator('.preset-chip').count(), 1);
  assert.equal(await page.locator('.preset-chip').getAttribute('data-key'), 'p1');
  await search.fill('not-present');
  assert.equal(await page.locator('.preset-chip').count(), 0);
  await search.fill('');
  assert.equal(await page.locator('.preset-chip').count(), 3);
  assert.equal(writes(f).length, 0);
  await cleanup(ctx);
});

test('three materials follow Codex colors while pure black stays fixed in every state', async () => {
  const ctx = await setup();
  const { page, f } = ctx;
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({
      colorScheme: theme === 'dark' ? 'light' : 'dark',
      reducedMotion: 'reduce',
    });
    const colors = {
      'surface-opaque': theme === 'light' ? 'rgb(245, 239, 230)' : 'rgb(29, 32, 36)',
      text: theme === 'light' ? 'rgb(30, 35, 40)' : 'rgb(232, 238, 244)',
      muted: 'rgb(120, 125, 130)',
      accent: 'rgb(172, 73, 201)',
      hover: 'rgba(172, 73, 201, 0.1)',
      divider: 'rgba(172, 73, 201, 0.2)',
    };
    for (const material of ['black', 'matte', 'frosted', 'native-glass']) {
      for (const expanded of [true, false]) {
        await nativeEvent(page, {
          expanded,
          effectiveMaterial: material,
          appearance: { material: 'matte', fontOffset: 4, hostTheme: { theme, colors } },
          nativeBackdrop: false,
        });
        assert.equal(
          await page.locator('#surface').evaluate((n) => getComputedStyle(n).backgroundColor),
          material === 'black' ? 'rgb(0, 0, 0)' : colors['surface-opaque'],
        );
        assert.equal(
          await page.locator('body').evaluate((n) => getComputedStyle(n).color),
          material === 'black' ? 'rgb(238, 238, 238)' : colors.text,
        );
        assert.equal(
          await page.locator('body').getAttribute('data-theme'),
          material === 'black' ? 'dark' : theme,
        );
      }
    }
    await nativeEvent(page, { expanded: true });
    const selected = page.locator('.choices button[aria-pressed="true"]').first();
    assert.equal(await selected.evaluate((n) => getComputedStyle(n).color), colors.accent);
    await selected.hover();
    assert.equal(await selected.evaluate((n) => getComputedStyle(n).color), colors.accent);
    await selected.focus();
    assert.equal(await selected.evaluate((n) => getComputedStyle(n).outlineColor), colors.accent);
    assert.equal(
      await page
        .locator('.model-label strong')
        .first()
        .evaluate((n) => getComputedStyle(n).fontSize),
      '17px',
    );
    const mutations = await page.evaluate(() => {
      const repeated = {
        expanded: true,
        effectiveMaterial: 'native-glass',
        nativeBackdrop: false,
        appearance: { material: 'matte', fontOffset: 4, hostTheme: null },
      };
      window.dispatchEvent(new CustomEvent('model-control-native', { detail: repeated }));
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
      for (let i = 0; i < 30; i++)
        window.dispatchEvent(
          new CustomEvent('model-control-native', {
            detail: { ...repeated, animating: true, unfold: i / 30, width: 200 + i },
          }),
        );
      const count = observer.takeRecords().length;
      observer.disconnect();
      return count;
    });
    assert.equal(mutations, 0, 'Geometry frames must not rewrite unchanged palette variables');
    await nativeEvent(page, { appearance: { hostTheme: null } });
    assert.equal(
      await page.locator('body').getAttribute('data-theme'),
      theme,
      'Missing host retains the last theme',
    );
    assert.equal(
      await page.locator('#surface').evaluate((n) => getComputedStyle(n).backgroundColor),
      colors['surface-opaque'],
    );
    await shot(page, `codex-theme-${theme}`);
    await nativeEvent(page, { effectiveMaterial: 'black', expanded: true });
    assert.equal(await selected.evaluate((n) => getComputedStyle(n).color), 'rgb(117, 167, 255)');
    await selected.hover();
    await selected.focus();
    assert.equal(
      await selected.evaluate((n) => getComputedStyle(n).outlineColor),
      'rgb(117, 167, 255)',
    );
    await shot(page, `pure-black-${theme}`);
    await nativeEvent(page, { effectiveMaterial: 'matte' });
    assert.equal(await page.locator('body').getAttribute('data-theme'), theme);
  }
  assert.equal(writes(f).length, 0);
  await cleanup(ctx);
});

test('native pointer entry is immediate, overrides DOM leave and respects suppression until real exit', async () => {
  const ctx = await setup({ expand: false, controlledClock: true });
  const { page, f } = ctx;
  const pointer = (detail) =>
    page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('model-control-pointer', { detail })),
      detail,
    );
  await pointer({ inside: true, buttons: 0, hoverSuppressed: false });
  assert.equal(await page.locator('#panel').isVisible(), true);
  await page.locator('#panel').dispatchEvent('pointerleave');
  await page.clock.runFor(500);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await pointer({ inside: false, buttons: 0, hoverSuppressed: false });
  await page.clock.runFor(250);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await pointer({ inside: true, buttons: 0, hoverSuppressed: false });
  await page.clock.runFor(250);
  assert.equal(await page.locator('#panel').isVisible(), true);
  for (let i = 0; i < 8; i++) {
    await pointer({ inside: false, buttons: 0, hoverSuppressed: false });
    await page.clock.runFor(180);
    await pointer({ inside: true, buttons: 0, hoverSuppressed: false });
    await page.clock.runFor(50);
    assert.equal(await page.locator('#panel').isVisible(), true);
  }
  assert.deepEqual(
    await page.evaluate(() =>
      window.nativeMessages
        .filter((m) => m.action === 'expand' || m.action === 'collapse')
        .map((m) => m.action),
    ),
    ['expand'],
    'Repeated short boundary exits must not restart the animation',
  );
  await page.keyboard.press('Escape');
  await pointer({ inside: true, buttons: 0, hoverSuppressed: true });
  assert.equal(await page.locator('#panel').isHidden(), true);
  await pointer({ inside: false, buttons: 0, hoverSuppressed: false });
  await pointer({ inside: true, buttons: 0, hoverSuppressed: false });
  assert.equal(await page.locator('#panel').isVisible(), true);
  await pointer({ inside: false, buttons: 1, hoverSuppressed: false });
  await page.clock.runFor(520);
  assert.equal(await page.locator('#panel').isVisible(), true);
  await pointer({ inside: false, buttons: 0, hoverSuppressed: false });
  await page.clock.runFor(520);
  assert.equal(await page.locator('#panel').isHidden(), true);
  assert.equal(writes(f).length, 0);
  await cleanup(ctx);
});

test('no pins shows all models directly; compact content sizes and wide matrices never turn into cards', async () => {
  const initial = fixture();
  initial.preferences.pinned = [];
  const ctx = await setup({ initial });
  const { page } = ctx;
  assert.equal(await page.locator('#pinned .model-row').count(), 4);
  assert.equal(await page.locator('#others-toggle').isHidden(), true);
  assert.ok((await page.locator('#panel').boundingBox()).height < 320);
  await page.setViewportSize({ width: 320, height: 640 });
  await nativeEvent(page, { appearance: { fontOffset: 11 } });
  assert.equal(await page.locator('body').getAttribute('data-layout'), 'matrix');
  assert.ok(await page.locator('#model-scroll').evaluate((n) => n.scrollWidth > n.clientWidth));
  assert.equal(await page.locator('#matrix-head').isVisible(), true);
  await cleanup(ctx);
});

test('native contour uses a prepared fixed viewport and acknowledges only current scenes', async () => {
  const ctx = await setup({
    expand: false,
    viewport: { width: 480, height: 300 },
    controlledClock: true,
  });
  const { page } = ctx;
  const scene = {
    nativeShell: true,
    sceneRevision: 1,
    expanded: false,
    unfold: 0,
    width: 480,
    height: 300,
    layoutWidth: 480,
    layoutHeight: 300,
    layoutX: 0,
    layoutY: 0,
    compactX: 470,
    compactY: 110,
    compactWidth: 10,
    compactHeight: 80,
    edge: 'right',
  };
  await nativeEvent(page, scene);
  await nativeEvent(page, { sceneRevision: 2 });
  await page.clock.runFor(80);
  const acks = await page.evaluate(() =>
    window.nativeMessages.filter((m) => m.action === 'scene-ready'),
  );
  assert.deepEqual(
    acks.map((m) => m.revision),
    [2],
  );
  const surface = () =>
    page.locator('#surface').evaluate((n) => ({
      clip: getComputedStyle(n).clipPath,
      width: n.clientWidth,
      height: n.clientHeight,
      left: n.getBoundingClientRect().left,
      top: n.getBoundingClientRect().top,
    }));
  const expected = { clip: 'none', width: 480, height: 300, left: 0, top: 0 };
  assert.deepEqual(await surface(), expected);
  assert.equal(await page.locator('#panel').evaluate((n) => n.clientWidth), 480);
  assert.equal(await page.locator('#panel').evaluate((n) => n.inert), true);
  assert.equal((await page.locator('#handle').boundingBox()).x, 470);
  assert.ok(
    await page.evaluate(() =>
      window.nativeMessages.some((m) => m.action === 'content-size' && m.height > 144),
    ),
  );
  for (const edge of ['right', 'left', 'top']) {
    for (const unfold of [0.08, 0.3, 0.7, 1, 0.6, 0]) {
      await nativeEvent(page, {
        edge,
        expanded: unfold > 0,
        animating: unfold > 0 && unfold < 1,
        unfold,
      });
      assert.deepEqual(await surface(), expected);
      if (unfold > 0)
        assert.ok(await page.locator('#panel').evaluate((n) => +getComputedStyle(n).opacity > 0));
      // No geometry messages during these frames: a delayed WebView retains full background coverage.
      await page.clock.runFor(100);
      assert.deepEqual(await surface(), expected);
    }
  }
  await cleanup(ctx);
});

try {
  for (const { name, run } of cases) {
    if (process.env.MODEL_CONTROL_CASE && !name.includes(process.env.MODEL_CONTROL_CASE)) continue;
    const started = Date.now();
    try {
      await run();
      results.push({ name, status: 'passed', durationMs: Date.now() - started });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({
        name,
        status: 'failed',
        message: error.stack,
        durationMs: Date.now() - started,
      });
      console.error(`FAIL ${name}\n${error.stack}`);
    }
  }
} finally {
  await browser.close();
  writeFileSync(
    resolve(
      output,
      process.env.MODEL_CONTROL_CASE ? 'selected-view-results.json' : 'view-results.json',
    ),
    JSON.stringify(
      {
        results,
        passed: results.filter((item) => item.status === 'passed').length,
        total: results.length,
      },
      null,
      2,
    ),
  );
}
if (results.some((item) => item.status === 'failed')) process.exitCode = 1;
