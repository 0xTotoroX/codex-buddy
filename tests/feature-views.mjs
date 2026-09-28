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
  const projection = {
    settings: {
      enabled: true,
      answerOutlineEnabled: true,
      generationMode: 'manual',
      quickPrompts: [],
    },
    outlineItems: [{ id: 'outline-fixture', text: '用于验证顶部按钮的大纲', displayLevel: 0 }],
    outlineStatus: 'ok',
    prompts: [{ label: '用于验证顶部按钮的建议', prompt: 'SYNTHETIC' }],
    scanBusy: false,
    bridgeStatus: 'ready',
  };
  const actions = [];
  const settingsRequests = [];
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
      else if (p.op === 'settings') {
        settingsRequests.push(p);
        value = { ok: true };
      } else if (p.op === 'main-pin') value = { alwaysOnTop: (pinned = p.value) };
      else if (p.op === 'layout') {
        layouts[p.placement] = p.layout;
        value = { layouts };
      } else if (p.op === 'main-anchor') value = { anchor: null };
      else if (p.op === 'read')
        value = {
          ...(p.id === 'board' ? tasks : p.id === 'model' ? model : { snapshot: projection }),
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
        if (['outline', 'next'].includes(p.id)) {
          actions.push(p);
          return route.fulfill({ json: { ok: true } });
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
    .getByText('隔离任务', { exact: true })
    .dragTo(stageTabs.getByRole('button', { name: '进行中', exact: true }));
  await board
    .getByRole('region', { name: '进行中', exact: true })
    .getByText('隔离任务', { exact: true })
    .waitFor();
  assert.equal(task.fields.column, 'doing');
  await board
    .getByText('隔离任务', { exact: true })
    .dragTo(stageTabs.getByRole('button', { name: '待办', exact: true }));
  await board
    .getByRole('region', { name: '待办', exact: true })
    .getByText('隔离任务', { exact: true })
    .waitFor();
  assert.equal(task.fields.column, 'todo');
  record('real mouse drag moves a card across compact group tabs inside Shadow DOM');
  surfaceTheme = 'matte';
  if (!(await board.getByLabel('新任务标题', { exact: true }).isVisible()))
    await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await board.getByLabel('新任务标题', { exact: true }).fill('还未保存');
  await page.evaluate(() => window.ipc.postMessage(JSON.stringify({ action: 'collapse' })));
  await page.evaluate(() => window.ipc.postMessage(JSON.stringify({ action: 'expand' })));
  assert.equal(await board.getByLabel('新任务标题', { exact: true }).inputValue(), '还未保存');

  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '模型快切' })
    .click();
  assert.equal(await page.getByLabel('收起面板').count(), 0);
  assert.equal(await page.getByLabel('展开功能面板').textContent(), '');
  assert.equal(await page.getByRole('button', { name: '设置', exact: true }).count(), 0);
  assert.deepEqual(settingsRequests, []);
  await page.keyboard.press('Escape');
  await page.getByLabel('展开功能面板').click();
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '看板', exact: true })
    .click();

  assert.equal(await board.getByLabel('新任务标题', { exact: true }).inputValue(), '还未保存');

  assert.equal(task.fields.title, '隔离任务');
  record('edge omits settings; blank handle and Escape preserve tab drafts');
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '模型快切' })
    .click();
  const view = page.locator('[data-feature="model"]');
  const waitModelRefresh = (opacity) =>
    page.waitForFunction((opacity) => {
      const hosts = [...document.querySelectorAll('.edge-view, .csw-feature-content > div')];
      const button =
        document.querySelector('#edge-panel [data-refresh="model"]') ||
        hosts.map((host) => host.shadowRoot?.querySelector('[data-refresh="model"]')).find(Boolean);
      return button && getComputedStyle(button).opacity === opacity;
    }, opacity);
  await page.mouse.move(499, 699);
  await waitModelRefresh('0');
  await page.locator('#edge-panel > header').hover();
  await waitModelRefresh('1');
  await page.mouse.move(499, 699);
  await waitModelRefresh('0');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: '刷新可用模型' }).focus();
  await waitModelRefresh('1');
  await page.getByRole('button', { name: '刷新可用模型' }).evaluate((node) => node.blur());
  await waitModelRefresh('0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .getByRole('button', { name: '刷新可用模型' })
      .evaluate((node) => getComputedStyle(node).transitionDuration),
    '0s',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
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
  const modelNameBox = await view.locator('.model-name strong').first().boundingBox();
  const disclosureBox = await view.locator('.model-disclosure').boundingBox();
  assert.ok(Math.abs(disclosureBox.x - modelNameBox.x) < 1);
  assert.equal(
    await view.locator('.model-disclosure').evaluate((node) => getComputedStyle(node).paddingLeft),
    '0px',
  );
  const visibility = view.getByLabel('隐藏 Model A', { exact: true });
  const headerRefresh = page.getByRole('button', { name: '刷新可用模型', exact: true });
  const waitOpacity = async (locator, opacity) => {
    await locator.evaluate(async (node, opacity) => {
      const deadline = performance.now() + 5000;
      while (getComputedStyle(node).opacity !== opacity) {
        if (performance.now() > deadline) throw Error(`Expected opacity ${opacity}`);
        await new Promise(requestAnimationFrame);
      }
    }, opacity);
  };
  await page.mouse.move(499, 699);
  await Promise.all([
    waitModelRefresh('0'),
    waitOpacity(visibility, '0'),
    waitOpacity(headerRefresh, '0'),
  ]);
  await page.locator('#edge-panel > header').hover();
  await Promise.all([
    waitModelRefresh('1'),
    waitOpacity(visibility, '1'),
    waitOpacity(headerRefresh, '1'),
  ]);
  await page.mouse.move(499, 699);
  await page.keyboard.press('Tab');
  await visibility.focus();
  await waitOpacity(visibility, '1');
  await headerRefresh.focus();
  await waitOpacity(headerRefresh, '1');
  await headerRefresh.evaluate((node) => node.blur());
  await waitOpacity(headerRefresh, '0');
  record('model arrows and header actions follow hover visibility and remain keyboard accessible');
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
  const refreshBox = await page.getByRole('button', { name: '刷新可用模型' }).boundingBox();
  assert.equal(await page.getByRole('button', { name: '设置', exact: true }).count(), 0);
  const settingsBox = await page.locator('#edge-panel > header nav').boundingBox();
  const plusBox = await view.getByRole('button', { name: '保存预设', exact: true }).boundingBox();
  const toolbarBox = await view.locator('.model-toolbar').boundingBox();
  assert.ok(
    Math.abs(refreshBox.y + refreshBox.height / 2 - settingsBox.y - settingsBox.height / 2) < 2,
  );
  assert.ok(refreshBox.x >= settingsBox.x + settingsBox.width);
  assert.ok(Math.abs(plusBox.x + plusBox.width - toolbarBox.x - toolbarBox.width) < 1);
  await page.getByRole('button', { name: '刷新可用模型' }).click();
  await page.getByRole('button', { name: '刷新可用模型' }).evaluate(async (node) => {
    const deadline = performance.now() + 5000;
    while (node.disabled) {
      if (performance.now() > deadline) throw Error('Refresh remained disabled');
      await new Promise(requestAnimationFrame);
    }
  });
  assert.equal(actions.at(-1).action, 'refresh');
  assert.equal(actions.at(-1).id, 'model');
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '看板', exact: true })
    .click();
  await page.getByRole('button', { name: '刷新可用模型' }).waitFor({ state: 'hidden' });
  await page
    .getByRole('navigation', { name: '功能' })
    .getByRole('button', { name: '模型快切' })
    .click();
  await page.getByRole('button', { name: '刷新可用模型' }).waitFor();
  record(
    'edge model refresh sits beside tabs, follows the active tab and dispatches model refresh; plus and disclosure align',
  );
  page.once('dialog', (dialog) => dialog.accept('日常'));
  await view.getByRole('button', { name: '保存预设', exact: true }).click();
  await view.getByRole('button', { name: '日常', exact: true }).waitFor();
  await view.getByLabel('模型工具').click();
  assert.equal(await view.getByRole('searchbox').count(), 0);
  assert.equal(await view.getByRole('slider').count(), 0);
  const columnHandle = view.getByRole('separator', { name: '模型名称列宽' });
  const handleBox = await columnHandle.boundingBox();
  const preferenceCount = () => actions.filter((item) => item.action === 'preferences').length;
  const beforeResize = preferenceCount();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 50, handleBox.y + 10, { steps: 5 });
  assert.equal(await columnHandle.getAttribute('aria-valuenow'), '190');
  assert.equal(preferenceCount(), beforeResize, 'drag previews without writing preferences');
  await page.mouse.up();
  await page.waitForFunction(() => {
    const host = document.querySelector('.edge-view:not([hidden])');
    return (
      host?.shadowRoot?.querySelector('[role="separator"]')?.getAttribute('aria-disabled') ===
      'false'
    );
  });
  assert.equal(model.preferences.modelColumnWidth, 190);
  assert.equal(preferenceCount(), beforeResize + 1);
  const cancelBox = await columnHandle.boundingBox();
  await page.mouse.move(cancelBox.x + 4, cancelBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + 40, cancelBox.y + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await columnHandle.getAttribute('aria-valuenow'), '190');
  assert.equal(preferenceCount(), beforeResize + 1, 'Escape cancels without saving');
  await columnHandle.press('ArrowLeft');
  await page.waitForFunction(() => {
    const host = document.querySelector('.edge-view:not([hidden])');
    return (
      host?.shadowRoot?.querySelector('[role="separator"]')?.getAttribute('aria-disabled') ===
      'false'
    );
  });
  assert.equal(model.preferences.modelColumnWidth, 174);
  record(
    'model search and width slider removed; divider previews, saves on release and supports Escape/keyboard',
  );
  await view.getByLabel('删除预设 日常').click();
  await view.getByRole('button', { name: '日常', exact: true }).waitFor({ state: 'detached' });
  record(
    'shared model view uses readback, preserves speed, hides/restores models, persists drag order and saves/removes presets',
  );
  assert.deepEqual(errors, []);
  assert.equal(await view.getByLabel('模型工具').count(), 0, 'no empty preset tools');
  await page.screenshot({ path: join(output, 'edge-model.png') });
  model.snapshot.models[0].reasoning = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  model.snapshot.models.push({ id: 'c', label: 'Model C', reasoning: ['high'], fast: false });
  model.preferences.modelColumnWidth = 280;
  await view.locator('[data-model="a"][data-reasoning="max"]').waitFor();
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
  await view.getByRole('separator', { name: '模型名称列宽' }).waitFor();
  await page.mouse.move(1, 1);
  await waitModelRefresh('0');
  await page.locator('.csw-workbench-head').hover();
  await waitModelRefresh('1');
  await page.mouse.move(1, 1);
  await waitModelRefresh('0');
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
  if (!(await board.getByLabel('新任务标题', { exact: true }).isVisible()))
    await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await board.getByLabel('新任务标题', { exact: true }).fill('还未保存');

  await page.getByRole('tab', { name: '模型快切', exact: true }).click();
  await page.getByRole('tab', { name: '看板', exact: true }).click();

  assert.equal(await board.getByLabel('新任务标题', { exact: true }).inputValue(), '还未保存');

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
  await page.getByRole('button', { name: '搜索任务' }).waitFor();
  assert.equal(await board.getByRole('button', { name: '新增分组' }).count(), 0);
  assert.equal(
    await page
      .getByRole('tab', { name: '看板', exact: true })
      .evaluate((node) => getComputedStyle(node).textDecorationLine),
    'none',
  );
  await board.locator('.board-grid:not(.narrow)').waitFor();
  const tools = await page.getByRole('button', { name: '搜索任务', exact: true }).boundingBox();
  const boardTab = await page.getByRole('tab', { name: '看板', exact: true }).boundingBox();
  assert.ok(
    Math.abs(tools.y + tools.height / 2 - boardTab.y - boardTab.height / 2) < 2,
    'search shares the feature tab row',
  );
  assert.equal(await board.locator('.board-footer').count(), 0, 'closed search reserves no footer');
  await page.getByRole('button', { name: '搜索任务', exact: true }).click();
  const searchBox = await board.getByRole('searchbox', { name: '搜索任务' }).boundingBox();
  const area = await board.locator('.board-app').boundingBox();
  assert.ok(
    area.y + area.height - searchBox.y - searchBox.height <= 16,
    'search field stays at the bottom',
  );
  await board.getByRole('searchbox', { name: '搜索任务' }).fill('没有匹配任务');
  assert.equal(await board.getByText('隔离任务', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '搜索任务', exact: true }).click();
  await board.getByText('隔离任务', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'desktop-board-aligned.png') });
  await page.getByRole('tab', { name: '模型快切', exact: true }).click();
  await page.getByLabel('窗口置顶', { exact: true }).click();
  await page.getByLabel('取消窗口置顶', { exact: true }).waitFor();
  assert.equal(pinned, true);
  record('shared layout restores drag split/merge, ratio, focus, persistence and header search');
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
  entries.splice(
    0,
    entries.length,
    ...['outline', 'next'].map((id) => ({
      id,
      owner: id + '-owner',
      placement: 'desktop',
      open: true,
      view: {},
      size: [840, 620],
      reveal: 1,
      pending: null,
    })),
  );
  pendingPlacement = null;
  layouts.desktop = {
    axis: 'horizontal',
    groups: entries.map((e) => ({ ids: [e.id], active: e.id, weight: 1 })),
  };
  await page.goto(
    'http://127.0.0.1:47991/feature.html#token=fixture&feature=main&lease=main-owner',
  );
  for (const [id, name, label, kind] of [
    ['outline', '大纲', '刷新大纲', 'outline-refresh'],
    ['next', '下一步', '重新生成建议', 'generate'],
  ]) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.waitFor();
    const box = await button.boundingBox();
    const tab = await page.getByRole('tab', { name, exact: true }).boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - tab.y - tab.height / 2) < 2);
    assert.equal(await page.locator(`[data-feature="${id}"] .feature-pane-head`).count(), 0);
    await button.click();
    assert.equal(actions.at(-1).id, id);
    assert.equal(actions.at(-1).data.kind, kind);
  }
  record('desktop split refresh buttons share their own tab row and dispatch the matching action');
  // Build the user's T-shaped layout through the same pointer gestures as the UI.
  entries.push({
    id: 'board',
    owner: 'board-owner',
    placement: 'desktop',
    open: true,
    view: {},
    size: [840, 620],
    reveal: 1,
    pending: null,
  });
  projection.outlineItems = Array.from({ length: 50 }, (_, i) => ({
    id: `long-${i}`,
    text: `有实际内容的长大纲条目 ${i + 1}，用于检查分栏后的阅读区域`,
    displayLevel: i % 3,
  }));
  layouts.desktop = {
    axis: 'auto',
    groups: [{ ids: ['outline', 'next', 'board'], active: 'board', weight: 1 }],
  };
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.reload();
  await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await board.getByLabel('新任务标题', { exact: true }).fill('嵌套分栏中保留的草稿');
  const dragTab = async (name, destination, edge) => {
    const source = await page.getByRole('tab', { name, exact: true }).boundingBox();
    const target = await page.locator(destination).boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + (edge === 'right' ? target.width - 15 : target.width / 2),
      target.y + (edge === 'bottom' ? target.height - 15 : target.height / 2),
      { steps: 12 },
    );
    await page.locator('.csw-drop-preview:not([hidden])').waitFor();
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-layout-saving="true"]'));
  };
  await dragTab('看板', '.csw-feature-panes > section', 'bottom');
  const topBefore = await page.locator('.csw-feature-panes > section').first().boundingBox();
  await dragTab('下一步', '[data-pane="board"]', 'right');
  assert.equal(await page.locator('.csw-feature-panes .csw-workbench-pane:visible').count(), 3);
  assert.equal(await page.locator('.csw-feature-split').count(), 1);
  const upper = await page.locator('[data-pane="outline"]').boundingBox();
  const lowerLeft = await page.locator('[data-pane="board"]').boundingBox();
  const lowerRight = await page.locator('[data-pane="next"]').boundingBox();
  assert.ok(
    Math.abs(upper.height - topBefore.height) < 2,
    'splitting the bottom keeps the top allocation',
  );
  assert.ok(Math.abs(upper.height - lowerLeft.height) < 2, 'top and bottom start at half');
  assert.ok(Math.abs(lowerLeft.width - lowerRight.width) < 2, 'bottom children start at half');
  assert.ok(Math.abs(lowerLeft.y - lowerRight.y) < 2 && lowerLeft.y > upper.y + upper.height);
  assert.ok(Math.abs(upper.width - lowerLeft.width - lowerRight.width - 8) < 2);
  const outer = page.locator('.csw-feature-panes > [role="separator"]');
  const inner = page.locator('.csw-feature-split > [role="separator"]');
  assert.equal(await outer.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(await inner.getAttribute('aria-orientation'), 'vertical');
  await inner.focus();
  await inner.press('ArrowRight');
  assert.ok(Number(await inner.getAttribute('aria-valuenow')) > 50);
  assert.equal(await outer.getAttribute('aria-valuenow'), '50');
  await outer.focus();
  await outer.press('ArrowDown');
  assert.ok(Number(await outer.getAttribute('aria-valuenow')) > 50);
  await page.getByRole('tab', { name: '下一步', exact: true }).dblclick();
  assert.equal(await page.locator('.csw-feature-panes .csw-workbench-pane:visible').count(), 1);
  assert.equal(await page.getByRole('separator', { name: '调整分栏比例' }).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.csw-feature-panes .csw-workbench-pane:visible').count(), 3);
  assert.equal(
    await board.getByLabel('新任务标题', { exact: true }).inputValue(),
    '嵌套分栏中保留的草稿',
  );
  await page.screenshot({ path: join(output, 'nested-split-wide.png') });
  const savedNested = structuredClone(layouts.desktop);
  await page.reload();
  await inner.waitFor();
  assert.deepEqual(layouts.desktop, savedNested);
  assert.ok(Number(await inner.getAttribute('aria-valuenow')) > 50);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.waitForFunction(
    () => document.querySelector('.csw-feature-split')?.dataset.axis === 'vertical',
  );
  assert.deepEqual(
    layouts.desktop,
    savedNested,
    'narrow fallback does not rewrite saved directions',
  );
  await page.screenshot({ path: join(output, 'nested-split-narrow.png') });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForFunction(
    () => document.querySelector('.csw-feature-split')?.dataset.axis === 'horizontal',
  );
  await dragTab('下一步', '[data-pane="board"]', 'merge');
  assert.equal(
    await page.locator('.csw-feature-split').count(),
    0,
    'merging removes the empty nested branch',
  );
  assert.equal(await page.locator('.csw-feature-panes > section:visible').count(), 2);
  record(
    'nested half splits preserve parent geometry, independent ratios, draft, focus, reload and narrow fallback',
  );
  entries.pop();
  for (const entry of entries) entry.placement = 'edge';
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto('http://127.0.0.1:47991/feature.html?surface=edge#token=fixture');
  for (const [id, name, label] of [
    ['outline', '大纲', '刷新大纲'],
    ['next', '下一步', '重新生成建议'],
  ]) {
    await page
      .locator('#edge-panel > header nav')
      .getByRole('button', { name, exact: true })
      .click();
    const button = page.getByRole('button', { name: label, exact: true });
    await button.waitFor();
    const box = await button.boundingBox();
    assert.equal(await page.getByRole('button', { name: '设置', exact: true }).count(), 0);
    const settingsBox = await page.locator('#edge-panel > header nav').boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - settingsBox.y - settingsBox.height / 2) < 2);
    assert.equal(await page.locator('#edge-panel > header [data-refresh]:visible').count(), 1);
    assert.equal(await page.locator(`[data-feature="${id}"] .feature-pane-head`).count(), 0);
  }
  record('edge outline/next refresh follows the active tab in the top row');
  assert.deepEqual(errors, []);
  report.passed = true;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
