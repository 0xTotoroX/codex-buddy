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
  const layouts = {};
  let pinned = false;
  let surfaceTheme = 'matte';
  let rejectHandoff = true;
  let handoffs = 0;
  let pendingPlacement = null;
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
      if (p.op === 'main-window') value = { valid: true, alwaysOnTop: pinned };
      else if (p.op === 'main-pin') value = { alwaysOnTop: (pinned = p.value) };
      else if (p.op === 'layout') {
        layouts[p.placement] = p.layout;
        value = { layouts };
      } else if (p.op === 'main-anchor') value = { anchor: null };
      else if (p.op === 'read')
        value = {
          ...(p.id === 'board' ? tasks : model),
          appearance: {
            theme: 'light',
            colors: { text: 'rgb(30, 35, 40)', 'surface-opaque': 'rgb(245, 239, 230)' },
            surface: { theme: surfaceTheme, liquidVariant: 'regular' },
          },
        };
      else if (p.op === 'action') {
        if (p.id === 'board') {
          assert.equal(p.data.op, 'update');
          Object.assign(task.fields, p.data.fields);
          tasks.store.revision++;
          return route.fulfill({ json: tasks });
        }
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
        if (p.op === 'main-placement') {
          pendingPlacement = p.placement;
          for (const item of entries)
            if (item.placement === 'desktop')
              item.pending = { owner: item.id + '-next', placement: p.placement, ready: false };
        }
        if (p.op === 'move')
          e.pending = { owner: 'next-owner', placement: p.placement, ready: false };
        if (p.op === 'cancel-move') {
          for (const item of entries) item.pending = null;
          pendingPlacement = null;
        }
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
          layouts,
          features: entries,
          mainPlacement: 'desktop',
          returnPlacement: 'sidebar',
          pendingPlacement,
          activeFeature: 'model',
          mainWindow: { lease: 'main-owner', size: [840, 620] },
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
  surfaceTheme = 'native-glass';
  await board.evaluate(async (node) => {
    const deadline = performance.now() + 5000;
    while (!getComputedStyle(node).getPropertyValue('--surface').includes('color-mix')) {
      if (performance.now() > deadline)
        throw Error('Liquid content did not receive translucent color');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  assert.equal(
    await board
      .locator('.board-toolbar')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await page.screenshot({ path: join(output, 'board-liquid.png') });
  const stageTabs = board.getByRole('navigation', { name: '任务阶段' });
  await board
    .getByRole('button', { name: '隔离任务', exact: true })
    .dragTo(stageTabs.getByRole('button', { name: '进行中', exact: true }));
  await board
    .getByRole('region', { name: '进行中', exact: true })
    .getByRole('button', { name: '隔离任务', exact: true })
    .waitFor();
  assert.equal(task.fields.column, 'doing');
  await board
    .getByRole('button', { name: '隔离任务', exact: true })
    .dragTo(stageTabs.getByRole('button', { name: '待办', exact: true }));
  await board
    .getByRole('region', { name: '待办', exact: true })
    .getByRole('button', { name: '隔离任务', exact: true })
    .waitFor();
  assert.equal(task.fields.column, 'todo');
  record('real mouse drag moves a card across compact group tabs inside Shadow DOM');
  surfaceTheme = 'matte';
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
  await view.getByRole('button', { name: /其他模型/ }).waitFor();
  assert.equal(
    await view.locator('.model-row').count(),
    0,
    'no favorites means all models stay hidden',
  );
  assert.equal(await view.locator('.model-footer [role="status"]').count(), 0);
  await view.getByRole('button', { name: /其他模型/ }).click();
  await view.getByLabel('设为常用 Model A', { exact: true }).click();
  await view.getByLabel('隐藏 Model A', { exact: true }).waitFor();
  await view.getByRole('button', { name: /其他模型/ }).click();
  assert.equal(await view.locator('.model-row').count(), 1);
  await view.locator('[data-model="a"][data-reasoning="low"]').click();
  await view.locator('[data-reasoning="low"][aria-pressed="true"]').waitFor();
  assert.equal(await view.evaluate((node) => getComputedStyle(node).color), 'rgb(30, 35, 40)');
  assert.equal(model.snapshot.current.speed, 'fast');
  assert.equal(actions.find((action) => action.action === 'apply').data.expectedRevision, 'v1');
  await view.getByRole('button', { name: /其他模型/ }).click();
  await view.getByLabel('设为常用 Model B', { exact: true }).click();
  await view.getByLabel('隐藏 Model B', { exact: true }).waitFor();
  assert.deepEqual(model.preferences.pinned, ['a', 'b']);
  await view
    .locator('[data-model-row="b"] strong')
    .dragTo(view.locator('[data-model-row="a"]'), { targetPosition: { x: 40, y: 2 } });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.edge-view')].some(
      (node) => node.shadowRoot?.querySelector('.model-row')?.dataset.modelRow === 'b',
    ),
  );
  assert.deepEqual(model.preferences.modelOrder, ['b', 'a']);
  await view.getByLabel('隐藏 Model A', { exact: true }).click();
  await view.getByLabel('设为常用 Model A', { exact: true }).waitFor();
  await view.getByRole('button', { name: /其他模型/ }).click();
  assert.equal(
    await view.locator('[data-model-row="a"]').count(),
    0,
    'current model also hides when removed from favorites',
  );
  await view.getByRole('button', { name: /其他模型/ }).click();
  await view.getByLabel('设为常用 Model A', { exact: true }).click();
  await view.getByLabel('隐藏 Model A', { exact: true }).waitFor();
  page.once('dialog', (dialog) => dialog.accept('日常'));
  await view.getByRole('button', { name: '保存预设', exact: true }).click();
  await view.getByRole('button', { name: '日常', exact: true }).waitFor();
  await view.getByLabel('模型工具').click();
  await view.getByLabel('删除预设 日常').click();
  await view.getByRole('button', { name: '日常', exact: true }).waitFor({ state: 'detached' });
  record(
    'shared model view uses readback, preserves speed, hides/restores models, persists drag order and saves/removes presets',
  );
  assert.deepEqual(errors, []);
  await view.getByLabel('模型工具').click();
  await page.screenshot({ path: join(output, 'edge-model.png') });
  model.snapshot.models[0].reasoning = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  model.snapshot.models.push({ id: 'c', label: 'Model C', reasoning: ['high'], fast: false });
  model.preferences.modelColumnWidth = 280;
  await view.locator('[data-model="a"][data-reasoning="max"]').waitFor();
  await view.getByLabel('模型工具').click();
  await view.getByRole('button', { name: /其他模型/, expanded: true }).waitFor();
  await view.locator('.model-scroll').evaluate((node) => {
    node.scrollLeft = 160;
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.edge-view')].some(
      (node) => node.shadowRoot?.querySelector('.model-scroll')?.scrollLeft > 0,
    ),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.__buddyFeatureFlush !== undefined);
  assert.equal(await page.evaluate(() => window.__buddyFeatureFlush()), true);
  const modelReading = entries.find((e) => e.id === 'model').view;
  assert.ok(modelReading.modelLeft > 0);
  assert.equal(modelReading.modelTools, true);
  assert.equal(modelReading.modelOthers, true);
  for (const entry of entries) entry.placement = 'desktop';
  await page.goto(
    'http://127.0.0.1:47991/feature.html?feature=main&lease=main-owner#token=fixture',
  );
  await page.locator('[data-feature="model"] [data-model="a"]').first().waitFor();
  await view.getByLabel('模型名称列宽').waitFor();
  assert.equal(await view.locator('.model-row').first().getAttribute('data-model-row'), 'b');
  assert.equal(
    await view.getByRole('button', { name: /其他模型/ }).getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(
    await view.locator('.model-scroll').evaluate((node) => node.scrollLeft),
    await view
      .locator('.model-scroll')
      .evaluate(
        (node, saved) => Math.min(saved, node.scrollWidth - node.clientWidth),
        modelReading.modelLeft,
      ),
  );
  record('model tools, expanded rows and horizontal reading survive remount');
  assert.equal(await page.locator('.csw-workbench-face .csw-fab-eye').count(), 2);
  await page.getByRole('tab', { name: '看板', exact: true }).click();
  await board.getByRole('button', { name: '隔离任务', exact: true }).click();
  await board.getByLabel('标题', { exact: true }).fill('还未保存');
  await board.getByRole('button', { name: '保留草稿并返回' }).click();
  await page.getByRole('tab', { name: '模型快切', exact: true }).click();
  await page.getByRole('tab', { name: '看板', exact: true }).click();
  await board.getByRole('button', { name: '继续编辑草稿' }).click();
  assert.equal(await board.getByLabel('标题', { exact: true }).inputValue(), '还未保存');
  await board.getByRole('button', { name: '保留草稿并返回' }).click();
  await page.getByRole('tab', { name: '模型快切', exact: true }).click();
  assert.equal(await page.getByLabel('模型快切显示位置').count(), 0);
  entries.find((e) => e.id === 'model').reveal++;
  await page.waitForFunction(() => window.nativeMessages.some((m) => m.kind === 'reveal'));
  await page.screenshot({ path: join(output, 'desktop-model.png') });
  assert.deepEqual(errors, []);
  record('desktop reuses original eyes/header and shows content without a placement selector');
  const tab = page.getByRole('tab', { name: '看板', exact: true });
  const tabBox = await tab.boundingBox();
  const paneBox = await page.locator('.csw-feature-panes').boundingBox();
  await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height - 20, {
    steps: 12,
  });
  await page.mouse.up();
  await page.getByRole('separator', { name: '调整分栏比例' }).waitFor();
  assert.equal(await page.locator('.csw-feature-panes > section:visible').count(), 2);
  const separator = page.getByRole('separator', { name: '调整分栏比例' });
  await separator.focus();
  await separator.press('ArrowDown');
  await page.waitForFunction(
    () => Number(document.querySelector('.csw-workbench-split').getAttribute('aria-valuenow')) > 50,
  );
  await tab.dblclick();
  assert.equal(await page.locator('.csw-feature-panes > section:visible').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.csw-feature-panes > section:visible').count(), 2);
  await page.reload();
  await page.getByRole('separator', { name: '调整分栏比例' }).waitFor();
  assert.equal(layouts.desktop.groups.length, 2);
  const from = await page.getByRole('tab', { name: '看板', exact: true }).boundingBox();
  const to = await page.locator('[data-pane="model"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelectorAll('.csw-feature-panes > section').length === 1,
  );
  await page.setViewportSize({ width: 1200, height: 700 });
  await board.getByRole('button', { name: '搜索任务' }).waitFor();
  assert.equal(await board.getByRole('button', { name: '新增分组' }).count(), 0);
  assert.equal(
    await page
      .getByRole('tab', { name: '看板', exact: true })
      .evaluate((node) => getComputedStyle(node).textDecorationLine),
    'none',
  );
  await board.locator('.board-grid:not(.narrow)').waitFor();
  const tools = await board.locator('.board-tools').boundingBox();
  const area = await board.locator('.board-app').boundingBox();
  assert.ok(area.y + area.height - tools.y - tools.height <= 16, 'search stays at the bottom');
  assert.ok(area.x + area.width - tools.x - tools.width <= 16, 'search stays at the right');
  await board.getByRole('button', { name: '搜索任务', exact: true }).click();
  const searchBox = await board.getByRole('searchbox', { name: '搜索任务' }).boundingBox();
  assert.ok(Math.abs(searchBox.y + searchBox.height / 2 - tools.y - tools.height / 2) < 6);
  await board.getByRole('searchbox', { name: '搜索任务' }).fill('没有匹配任务');
  assert.equal(await board.getByRole('button', { name: '隔离任务', exact: true }).count(), 0);
  await board.getByRole('button', { name: '搜索任务', exact: true }).click();
  await board.getByRole('button', { name: '隔离任务', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'desktop-board-aligned.png') });
  await page.getByRole('tab', { name: '模型快切', exact: true }).click();
  await page.getByLabel('窗口置顶', { exact: true }).click();
  await page.getByLabel('取消窗口置顶', { exact: true }).waitFor();
  assert.equal(pinned, true);
  record('shared layout restores drag split/merge, ratio, focus, persistence and bottom search');
  surfaceTheme = 'black';
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.csw-workbench')).color === 'rgb(238, 238, 238)',
  );
  await page.waitForFunction(() => {
    const host = document.querySelector('.csw-feature-content > div:not([hidden])').shadowRoot;
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
      !document
        .querySelector('.csw-feature-content > div:not([hidden])')
        .shadowRoot.querySelector('[data-model="a"]').disabled,
  );
  const failedHandoffs = handoffs;
  assert.ok(failedHandoffs >= 1);
  rejectHandoff = false;
  await page.locator('.csw-workbench-face').dblclick();
  await page.waitForFunction(
    () => window.nativeMessages.filter((m) => m.kind === 'return').length === 2,
  );
  await page.waitForTimeout(500);
  assert.equal(handoffs, failedHandoffs + 2);
  assert.equal(entries.find((e) => e.id === 'model').pending.ready, true);
  record(
    'desktop black theme restores host colors; failed return cancels motion and permits retry',
  );
  report.passed = true;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
