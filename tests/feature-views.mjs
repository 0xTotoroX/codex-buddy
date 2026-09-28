/* [INPUT]: Built shared feature page and synthetic owner/model/task transport.
 * [OUTPUT]: Edge tab/collapse draft retention and shared model controls.
 * [POS]: Browser behavior acceptance; no real chat or reminder changes. [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { prepareTestBinary } from '../scripts/verify.mjs';
const root = resolve(import.meta.dirname, '..');
prepareTestBinary();
const output = join(root, 'target/reports/feature-views');
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: existsSync(chrome) ? chrome : undefined,
  headless: true,
});
const report = { passed: false, checks: [] };
const record = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 700 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const entries = ['board', 'model'].map((id) => ({
    id,
    owner: id + '-owner',
    placement: 'edge',
    open: true,
    view: {},
    size: [840, 620],
    reveal: 1,
    pending: null,
  }));
  const model = {
    revision: 1,
    preferences: { enabled: true, pinned: [], presets: [] },
    snapshot: {
      target: { id: 'synthetic' },
      revision: 'v1',
      status: 'ready',
      message: '',
      current: { model: 'a', reasoning: 'high', speed: 'fast' },
      models: [
        { id: 'a', label: 'Model A', reasoning: ['low', 'high'], fast: true },
        { id: 'b', label: 'Model B', reasoning: ['high'], fast: false },
      ],
    },
  };
  const task = {
    id: 't',
    fields: {
      title: '隔离任务',
      notes: '',
      due: null,
      priority: 0,
      column: 'todo',
      completed: false,
    },
    archived: false,
    remote: null,
    conflict: null,
  };
  const tasks = {
    store: {
      revision: 1,
      boardEnabled: true,
      syncEnabled: false,
      bindings: { calendarId: '' },
      tasks: [task],
      inflight: null,
    },
    status: '本地看板',
  };
  const actions = [];
  let surfaceTheme = 'matte';
  let rejectHandoff = true;
  let handoffs = 0;
  await page.addInitScript(() => {
    window.nativeMessages = [];
    window.ipc = {
      postMessage(raw) {
        const m = JSON.parse(raw);
        window.nativeMessages.push(m);
        if (m.kind === 'return') queueMicrotask(() => window.__companionPopout.returned(true));
        if (m.kind === 'show')
          queueMicrotask(() => {
            window.__companionPopout.presented();
            window.__companionPopout.motionFinished();
          });
        if (['ready', 'expand', 'collapse', 'focus'].includes(m.action)) {
          const expanded = m.action !== 'collapse';
          window.dispatchEvent(
            new CustomEvent('edge-native', {
              detail: {
                expanded,
                unfold: expanded ? 1 : 0,
                layoutWidth: 480,
                layoutHeight: 650,
                layoutX: 0,
                layoutY: 0,
                compactWidth: 10,
                compactHeight: 80,
                sceneRevision: 1,
                theme: 'matte',
                liquidVariant: 'regular',
                appearance: { hostTheme: { theme: 'light' } },
              },
            }),
          );
        }
      },
    };
  });
  await page.route('http://127.0.0.1:47991/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/features') {
      const p = route.request().postDataJSON();
      let value;
      if (p.op === 'read')
        value = {
          ...(p.id === 'board' ? tasks : model),
          appearance: {
            theme: 'light',
            colors: { text: 'rgb(30, 35, 40)', 'surface-opaque': 'rgb(245, 239, 230)' },
            surface: { theme: surfaceTheme, liquidVariant: 'regular' },
          },
        };
      else if (p.op === 'action') {
        assert.equal(p.id, 'model');
        actions.push(p);
        if (p.action === 'apply') {
          model.snapshot.current = {
            ...p.data.selection,
            speed: p.data.preserveSpeed ? model.snapshot.current.speed : p.data.selection.speed,
          };
          model.snapshot.revision = 'v2';
        }
        if (p.action === 'preferences') {
          Object.assign(model.preferences, p.data.patch);
          model.revision++;
        }
        value = structuredClone(model);
      } else {
        const e = entries.find((e) => e.id === p.id);
        if (p.op === 'save') e.view = p.view;
        if (p.op === 'move')
          e.pending = { owner: 'next-owner', placement: p.placement, ready: false };
        if (p.op === 'cancel-move') e.pending = null;
        if (p.op === 'handoff') {
          handoffs++;
          if (rejectHandoff)
            return route.fulfill({
              status: 409,
              json: { ok: false, code: 'handoff_failed', message: '模拟交接失败' },
            });
          e.pending.ready = true;
        }
        value = {
          features: entries,
          appearance: {
            theme: 'light',
            colors: { text: 'rgb(30, 35, 40)', 'surface-opaque': 'rgb(245, 239, 230)' },
            themes: { desktop: { theme: surfaceTheme, liquidVariant: 'regular' } },
          },
        };
      }
      return route.fulfill({ json: value });
    }
    const path = join(root, 'target/web', url.pathname);
    await route.fulfill({
      body: readFileSync(path),
      contentType: path.endsWith('.html')
        ? 'text/html'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
    });
  });
  await page.goto('http://127.0.0.1:47991/feature.html#token=fixture&surface=edge');
  const board = page.locator('[data-feature="board"]');
  await board.getByRole('button', { name: '隔离任务', exact: true }).click();
  await board.getByLabel('标题', { exact: true }).fill('还未保存');
  await page.evaluate(() => window.ipc.postMessage(JSON.stringify({ action: 'collapse' })));
  await page.evaluate(() => window.ipc.postMessage(JSON.stringify({ action: 'expand' })));
  assert.equal(await board.getByLabel('标题', { exact: true }).inputValue(), '还未保存');
  await board.getByRole('button', { name: '保留草稿并返回' }).click();
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '模型快切' })
    .click();
  await page.getByLabel('收起面板').click();
  await page.getByLabel('展开功能面板').click();
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '看板', exact: true })
    .click();
  await board.getByRole('button', { name: '继续编辑草稿' }).click();
  assert.equal(await board.getByLabel('标题', { exact: true }).inputValue(), '还未保存');
  await board.getByRole('button', { name: '保留草稿并返回' }).click();
  assert.equal(task.fields.title, '隔离任务');
  record('edge tab switch and collapse preserve live unsaved editor without task writes');
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '模型快切' })
    .click();
  const view = page.locator('[data-feature="model"]');
  await view.locator('[data-model="a"][data-reasoning="low"]').click();
  await view.locator('[data-reasoning="low"][aria-pressed="true"]').waitFor();
  assert.equal(await view.evaluate((node) => getComputedStyle(node).color), 'rgb(30, 35, 40)');
  assert.equal(model.snapshot.current.speed, 'fast');
  assert.equal(actions[0].data.expectedRevision, 'v1');
  await view.getByLabel('模型 Model B 菜单').click();
  await view.getByLabel('置顶 Model B').click();
  await view.locator('[aria-label="置顶 Model B"][aria-pressed="true"]').waitFor();
  assert.deepEqual(model.preferences.pinned, ['b']);
  page.once('dialog', (dialog) => dialog.accept('日常'));
  await view.getByRole('button', { name: '保存预设', exact: true }).click();
  await view.getByRole('button', { name: '日常', exact: true }).waitFor();
  await view.getByLabel('模型工具').click();
  await view.getByLabel('删除预设 日常').click();
  await view.getByRole('button', { name: '日常', exact: true }).waitFor({ state: 'detached' });
  record('shared model view uses readback, preserves speed, pins models and saves/removes presets');
  assert.deepEqual(errors, []);
  await view.getByLabel('模型工具').click();
  await view.getByLabel('模型 Model B 菜单').click();
  await page.screenshot({ path: join(output, 'edge-model.png') });
  entries.find((entry) => entry.id === 'model').placement = 'desktop';
  await page.goto(
    'http://127.0.0.1:47991/feature.html?feature=model&lease=model-owner#token=fixture',
  );
  await page.locator('[data-feature="model"] [data-model="a"]').first().waitFor();
  assert.equal(await page.locator('.csw-workbench-face .csw-fab-eye').count(), 2);
  assert.equal(await page.getByLabel('模型快切显示位置').count(), 0);
  await page.screenshot({ path: join(output, 'desktop-model.png') });
  assert.deepEqual(errors, []);
  record('desktop reuses original eyes/header and shows content without a placement selector');
  surfaceTheme = 'black';
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.csw-workbench')).color === 'rgb(238, 238, 238)',
  );
  await page.waitForFunction(() => {
    const host = document.querySelector('.csw-feature-content').shadowRoot;
    return (
      getComputedStyle(host.querySelector('[data-feature="model"]')).color === 'rgb(238, 238, 238)'
    );
  });
  assert.equal(
    await page
      .locator('#root')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('--csw-surface-opaque').trim()),
    '#000',
  );
  surfaceTheme = 'matte';
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#root')).getPropertyValue('--csw-text').trim() ===
      'rgb(30, 35, 40)',
  );
  await page.locator('.csw-workbench-face').dblclick();
  await page.waitForFunction(() => window.nativeMessages.some((m) => m.kind === 'cancel-return'));
  await page.waitForFunction(
    () =>
      !document.querySelector('.csw-feature-content').shadowRoot.querySelector('[data-model="a"]')
        .disabled,
  );
  assert.equal(handoffs, 1);
  rejectHandoff = false;
  await page.locator('.csw-workbench-face').dblclick();
  await page.waitForFunction(
    () => window.nativeMessages.filter((m) => m.kind === 'return').length === 2,
  );
  await page.waitForTimeout(500);
  assert.equal(handoffs, 2);
  assert.equal(entries.find((e) => e.id === 'model').pending.ready, true);
  record(
    'desktop black theme restores host colors; failed return cancels motion and permits retry',
  );
  report.passed = true;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
