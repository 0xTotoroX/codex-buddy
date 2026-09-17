/*
 * [INPUT]: Playwright Chromium、buildPanel、合成宿主与设置 fixture。
 * [OUTPUT]: 工作台真实布局、键盘操作、设置隔离与宿主生命周期行为回归。
 * [POS]: 独立浏览器验收；只模拟后台桥，不请求模型、不读取真实聊天。
 * [PROTOCOL]: 变更时核对 tests/AGENTS.md；入口与地图由主任务维护。
 */
import assert from 'node:assert/strict';
import { chatBindingCases } from './workbench-binding.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { buildPanel } from '../scripts/build-panel.mjs';
import { fixtureSettings } from './fixtures.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'target/reports/workbench');
const fixture = readFileSync(resolve(root, 'tests/host-fixture.html'), 'utf8');
const bundle = await buildPanel(root);
const hostUrl = 'http://127.0.0.1:47839/workbench-fixture';
const slotSelector = '[data-codex-buddy-dock]';
const panelSelector = '[data-companion-stepwise-root] .csw-panel';
const wide = { width: 1440, height: 960 };
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
  headless: true,
});
const results = [];
mkdirSync(output, { recursive: true });

const settle = (page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) <= 1, `${message}: ${actual} vs ${expected}`);

async function setup(page) {
  await page.goto(hostUrl);
  await page.evaluate((settings) => {
    const workspace = document.querySelector('.workspace');
    workspace.classList.add('app-shell-main-content-frame');
    const row = document.createElement('div');
    row.id = 'fixture-dock-row';
    row.style.cssText = 'display:flex;flex-direction:row;height:100%;min-width:0';
    const content = document.createElement('div');
    content.id = 'fixture-host-content';
    content.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;height:100%';
    content.append(...workspace.childNodes);
    content.append(content.querySelector('.composer'));
    row.append(content);
    workspace.append(row);
    const style = document.createElement('style');
    style.textContent = `#fixture-host-content > .app-bar{flex:0 0 61px}
      #fixture-host-content > .thread-scroll-container{flex:1;min-height:0;height:auto}
      #fixture-host-content > .composer{position:relative;flex:none;width:calc(100% - 64px)}`;
    document.head.append(style);

    window.workbenchFixture = {
      settings: structuredClone(settings),
      requests: [],
      unexpected: [],
      hostNodes: [
        workspace,
        row,
        content,
        content.querySelector('main'),
        content.querySelector('form'),
      ],
      styleMutations: [],
    };
    const fixture = window.workbenchFixture;
    fixture.styles = fixture.hostNodes.map((node) => node.getAttribute('style'));
    fixture.parents = fixture.hostNodes.map((node) => node.parentNode);
    fixture.observer = new MutationObserver((records) => {
      fixture.styleMutations.push(
        ...records.map((record) => record.target.id || record.target.className),
      );
    });
    for (const node of fixture.hostNodes) {
      fixture.observer.observe(node, { attributes: true, attributeFilter: ['style'] });
    }
    window.__companionHostRequest = (raw) => {
      const { id, path, payload } = JSON.parse(raw);
      fixture.requests.push({ path, payload });
      let reply;
      if (path === '/stepwise/settings') reply = { settings: fixture.settings };
      else if (path === '/stepwise/generate' && fixture.deferred) {
        fixture.deferred.push({ id, payload });
        return;
      } else if (path === '/settings/set') {
        Object.assign(fixture.settings, payload);
        fixture.settings.configurationRevision += 1;
        reply = { settings: fixture.settings };
      } else {
        fixture.unexpected.push(path);
        reply = { error: `Unexpected fixture request: ${path}` };
      }
      queueMicrotask(() => window.__companionDesktop.complete(id, structuredClone(reply)));
    };
  }, fixtureSettings);
  await page.evaluate(bundle);
  await page.waitForFunction(() => {
    const state = window.__companionFloatingPanel?.state;
    return state?.settingsLoaded && state.runtimeActive && state.outlineItems.length > 0;
  });
  return page.locator('#fixture-host-content').boundingBox();
}

async function openChatSurface(page, width = 1000) {
  await page.evaluate((width) => {
    const dialog = document.createElement('section');
    dialog.id = 'foreground-chat';
    dialog.className = '_floatingSurface_fixture';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'false');
    dialog.style.cssText = `position:fixed;left:280px;top:62px;width:${width}px;height:820px;display:flex;flex-direction:column;z-index:50;overflow:hidden;background:white`;
    const column = document.createElement('div');
    column.style.cssText =
      'display:flex;flex-direction:column;flex:1;min-height:0;position:relative';
    const header = document.createElement('header');
    header.style.cssText = 'height:46px;flex:none';
    header.textContent = '合成独立聊天';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;position:relative';
    const content = row.cloneNode();
    const thread = document.querySelector('.thread-scroll-container').cloneNode(true);
    thread.querySelector('form')?.remove();
    thread.dataset.sessionId = 'foreground-fixture';
    thread.style.cssText = 'flex:1;min-height:0;height:auto;overflow:auto';
    const composer = document.querySelector('#composer-form').cloneNode(true);
    composer.id = 'foreground-composer';
    composer.style.cssText = 'position:relative;flex:none;width:100%;inset:auto;transform:none';
    composer.querySelector('.ProseMirror').textContent = '';
    content.append(thread, composer);
    row.append(content);
    column.append(header, row);
    dialog.append(column);
    document.body.append(dialog);
    window.__companionFloatingPanel.scan();
    window.__companionFloatingPanel.renderFloat();
  }, width);
  await page.waitForFunction(() =>
    document.querySelector('#foreground-chat [data-codex-buddy-dock]'),
  );
  await settle(page);
}

async function mode(page, enabled) {
  await page.evaluate((enabled) => window.__companionFloatingPanel.setWorkbench(enabled), enabled);
  await page.waitForFunction((enabled) => {
    const state = window.__companionFloatingPanel.state;
    return enabled
      ? state.dockStatus === 'open' && document.querySelector('[data-codex-buddy-dock]')
      : state.layoutMode === 'capsule' && !document.querySelector('[data-codex-buddy-dock]');
  }, enabled);
  await settle(page);
}

async function box(page, selector) {
  const target = page.locator(selector);
  assert.equal(await target.count(), 1, `one ${selector}`);
  assert.equal(await target.isVisible(), true, `visible ${selector}`);
  const value = await target.boundingBox();
  assert.ok(value?.width > 0 && value.height > 0, `nonempty ${selector}`);
  return value;
}

async function layout(page) {
  // Read every rectangle in one browser task: ResizeObserver can change grid rows between calls.
  const selectors = [
    '#fixture-host-content',
    slotSelector,
    panelSelector,
    '[data-pane="outline"]',
    '[data-pane="next"]',
    '.thread-scroll-container',
    '#composer-form',
  ];
  const rectangles = await page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const nodes = document.querySelectorAll(selector);
        const node = nodes[0];
        if (nodes.length !== 1 || !node)
          throw new Error(`Expected one ${selector}, got ${nodes.length}`);
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(node).visibility !== 'visible')
          throw new Error(`Not visible: ${selector}`);
        return rect.toJSON();
      }),
    selectors,
  );
  const [content, slot, panel, outline, next] = rectangles;
  for (const selector of ['.thread-scroll-container', '#composer-form']) {
    const rect = rectangles[selectors.indexOf(selector)];
    assert.ok(rect.x + rect.width <= slot.x + 1, `${selector} must not overlap dock`);
  }
  assert.ok(content.width >= 560, 'chat retains usable width');
  assert.ok(content.x + content.width <= panel.x + 1, 'panel must not cover chat');
  assert.ok(
    panel.x >= slot.x - 1 && panel.x + panel.width <= slot.x + slot.width + 1,
    `panel inside reserved slot: ${JSON.stringify({ slot, panel })}`,
  );
  assert.ok(
    panel.y >= slot.y - 1 && panel.y + panel.height <= slot.y + slot.height + 1,
    'panel fits host vertically',
  );
  assert.ok(slot.x + slot.width <= page.viewportSize().width + 1, 'dock inside viewport');
  assert.ok(outline.y + outline.height <= next.y + 1, 'panes do not overlap');
  for (const pane of [outline, next]) {
    assert.ok(pane.height >= 180, 'pane has usable height');
    assert.ok(
      pane.x >= panel.x && pane.x + pane.width <= panel.x + panel.width + 1,
      'pane fits panel width',
    );
    assert.ok(
      pane.y >= panel.y && pane.y + pane.height <= panel.y + panel.height + 1,
      'pane fits panel height',
    );
  }
  for (const kind of ['outline', 'next']) {
    assert.equal(await page.locator(`[data-view-body="${kind}"]`).isVisible(), true);
    assert.equal(
      await page.locator(`[data-pane="${kind}"] > header`).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.left + 20, rect.top + rect.height / 2));
      }),
      true,
      `${kind} header is not occluded`,
    );
  }
  return { content, slot, panel, outline, next };
}

async function hostUnchanged(page, baseline = null) {
  const state = await page.evaluate(() => {
    const f = window.workbenchFixture;
    return {
      styles: f.hostNodes.map((node) => node.getAttribute('style')),
      original: f.styles,
      intact: f.hostNodes.every((node, i) => node.isConnected && node.parentNode === f.parents[i]),
      mutations: f.styleMutations,
    };
  });
  assert.deepEqual(state.styles, state.original, 'host inline styles preserved');
  assert.deepEqual(state.mutations, [], 'no transient host style writes');
  assert.equal(state.intact, true, 'host nodes keep identity and parent');
  if (baseline) {
    const current = await box(page, '#fixture-host-content');
    for (const key of ['x', 'y', 'width', 'height'])
      near(current[key], baseline[key], `restored host ${key}`);
  }
}

async function syncSettings(page, patch) {
  await page.evaluate(async (patch) => {
    Object.assign(window.workbenchFixture.settings, patch);
    await window.__companionFloatingPanel.syncSettings(patch);
  }, patch);
  await settle(page);
}

async function createPopout(host, preserveSnapshot = false) {
  const projection = await host.evaluate(() => ({
    snapshot: window.__companionFloatingPanel.exportPanelState(),
    preferences: {
      ui: {
        ...window.__companionFloatingPanel.panelPreferences(),
        layoutMode: 'workbench',
        width: 476,
        height: 720,
      },
      webRevision: 0,
      alwaysOnTop: false,
    },
  }));
  if (!preserveSnapshot) {
    projection.snapshot.outlineItems = Array.from({ length: 24 }, (_, i) => ({
      id: `fixture-heading-${i}`,
      text: `合成大纲章节 ${i + 1}`,
      labelText: `合成大纲章节 ${i + 1}`,
      displayLevel: 0,
      numberPrefix: '',
    }));
    projection.snapshot.prompts = Array.from({ length: 4 }, (_, i) => ({
      label: `合成建议 ${i + 1}`,
      summary: '检查工作台中的独立阅读与滚动位置。',
      prompt: `建议 ${i + 1}\n${'这是合成建议的完整内容，用于验证阅读位置。\n'.repeat(80)}`.trim(),
    }));
    projection.snapshot.outlineStatus = 'ready';
    projection.snapshot.bridgeStatus = 'ok';
    projection.snapshot.readingState = null;
  }
  const page = await host.context().newPage();
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 500, height: 744 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${hostUrl}/popout`);
  await page.evaluate((settings) => {
    window.popoutFixture = { saves: [], unexpected: [] };
    window.__companionHostRequest = (raw) => {
      const { id, path } = JSON.parse(raw);
      if (path !== '/stepwise/settings') window.popoutFixture.unexpected.push(path);
      queueMicrotask(() => window.__companionDesktop.complete(id, { settings }));
    };
    window.__companionPopout = {
      save: (ui) => window.popoutFixture.saves.push(structuredClone(ui)),
      size: async () => {},
      native: () => {},
      request: async (path) => {
        window.popoutFixture.unexpected.push(path);
        return { ok: false };
      },
      notice: (message) => window.popoutFixture.unexpected.push(message),
    };
  }, fixtureSettings);
  await page.evaluate(bundle);
  await page.addStyleTag({
    content: readFileSync(resolve(root, 'ui/panel/popout/native.css'), 'utf8'),
  });
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.runtimeActive);
  await project(page, projection, true);
  assert.equal(await page.locator(slotSelector).count(), 0, 'popout never installs a host slot');
  for (const kind of ['outline', 'next'])
    await page.locator(`[data-pane="${kind}"]`).waitFor({ state: 'attached' });
  return { page, projection, errors };
}

async function project(page, projection, initial) {
  await page.evaluate(
    ({ projection, initial }) =>
      window.__companionFloatingPanel.receivePanelState(projection, initial),
    { projection, initial },
  );
  await settle(page);
}

async function scrollPanes(page, outline, next, preview = 0) {
  return page.evaluate(
    ({ outline, next, preview }) => {
      const values = {};
      for (const [key, selector, top] of [
        ['outline', '[data-view-body="outline"]', outline],
        ['next', '[data-view-body="next"]', next],
        ['preview', '.csw-prompt-preview-scroll', preview],
      ]) {
        const node = document.querySelector(selector);
        node.scrollTop = top;
        values[key] = node.scrollTop;
      }
      return values;
    },
    { outline, next, preview },
  );
}

async function reading(page) {
  return page.evaluate(() => window.__companionFloatingPanel.panelReadingState());
}

async function splitGeometry(page) {
  return page.locator('.csw-workbench-panes').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      clientHeight: node.clientHeight,
      height: node.getBoundingClientRect().height,
      rows: style.gridTemplateRows,
      inlineRows: node.style.gridTemplateRows,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      splitRatio: window.__companionFloatingPanel.panelPreferences().splitRatio,
    };
  });
}

async function chooseLayout(page, action) {
  const menu = page.locator('.csw-layout-menu');
  if (!(await menu.getAttribute('open'))) {
    // Empty-string open attribute is present on a native details element.
    if (!(await menu.evaluate((node) => node.open))) await menu.locator('summary').click();
  }
  await menu.locator(`[data-layout-mode="${action}"], [data-layout-action="${action}"]`).click();
  await menu.locator('summary').press('Escape');
  await settle(page);
}

const cases = [
  ...chatBindingCases({ mode, settle, chooseLayout, createPopout, project, bundle, output }),
  [
    'arrangement menus tabs focus and hidden reading retain the same business nodes',
    async (host) => {
      await mode(host, true);
      const { page, projection, errors } = await createPopout(host);
      await page.setViewportSize({ width: 924, height: 824 });
      await settle(page);
      await page.evaluate(() => {
        window.originalPanes = [...document.querySelectorAll('[data-pane]')];
      });
      const before = await scrollPanes(page, 100, 30, 80);
      const arrange = (pane, action) =>
        page.locator(`[data-pane-arrange="${pane}"]`).selectOption(action);
      await arrange('outline', 'merge');
      assert.equal(await page.locator('[data-pane="next"]').isVisible(), false);
      assert.equal((await reading(page)).promptScrollTop, before.preview);
      await page.getByRole('tab', { name: '下一步', exact: true }).click();
      assert.equal(await page.locator('[data-pane="next"]').isVisible(), true);
      await page.getByRole('tab', { name: '大纲', exact: true }).click();
      assert.equal(await page.locator('[data-pane="outline"]').isVisible(), true);
      await page.setViewportSize({ width: 1200, height: 824 });
      await settle(page);
      assert.equal(await page.locator('.csw-workbench-tabs').isVisible(), true);
      const outlineTab = page.getByRole('tab', { name: '大纲', exact: true });
      await outlineTab.focus();
      await outlineTab.press('ArrowRight');
      assert.equal(
        await page
          .getByRole('tab', { name: '下一步', exact: true })
          .evaluate((n) => n === document.activeElement),
        true,
      );
      assert.equal(
        await outlineTab.getAttribute('aria-selected'),
        'true',
        'arrow only moves focus',
      );
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-pane="outline"]').isVisible(), false);
      assert.equal(await page.locator('[data-pane="outline"]').evaluate((n) => n.inert), true);
      near(
        await page.locator('.csw-prompt-preview-scroll').evaluate((n) => n.scrollTop),
        before.preview,
        'preview survives hidden tab',
      );
      await arrange('next', 'reorder');
      assert.equal(
        await page.locator('[role="tab"]').first().getAttribute('data-pane-tab'),
        'next',
      );
      const prefs = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      await page.locator('[data-pane-focus="next"]').click();
      assert.equal(await page.locator('.csw-workbench').getAttribute('data-composition'), 'focus');
      assert.deepEqual(
        await page.evaluate(() => window.__companionFloatingPanel.panelPreferences()),
        prefs,
      );
      assert.equal(await page.locator('[data-pane-arrange="next"]').isDisabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.csw-workbench').getAttribute('data-composition'), 'tabs');
      await arrange('next', 'left');
      assert.equal(
        await page.locator('.csw-workbench-panes').getAttribute('data-axis'),
        'horizontal',
      );
      assert.equal(await page.locator('[data-pane="outline"]').isVisible(), true);
      const restoredOutline = await page
        .locator('[data-view-body="outline"]')
        .evaluate((n) => ({ top: n.scrollTop, max: n.scrollHeight - n.clientHeight }));
      near(
        restoredOutline.top,
        Math.min(before.outline, restoredOutline.max),
        'outline restores as far as current viewport allows',
      );
      near(
        (await reading(page)).panes.outline.scrollTop,
        before.outline,
        'requested reading survives a larger viewport',
      );
      assert.equal(
        await page.evaluate(() => window.originalPanes.every((n) => n.isConnected)),
        true,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.popoutFixture.unexpected), []);
      await page.screenshot({ path: resolve(output, 'arrangement-split.png') });
      await arrange('outline', 'merge');
      await page.screenshot({ path: resolve(output, 'arrangement-tabs.png') });
      await page.getByRole('tab', { name: '下一步', exact: true }).click();
      const away = structuredClone(projection);
      away.snapshot.viewToken = 'fixture-other-chat';
      away.snapshot.context.sessionId = 'fixture-other-chat';
      await project(page, away, false);
      near((await reading(page)).panes.outline.scrollTop, 0, 'new chat has its own reading');
      await project(page, projection, false);
      near(
        (await reading(page)).panes.outline.scrollTop,
        before.outline,
        'hidden reading returns with original chat',
      );
      await page.getByRole('tab', { name: '大纲', exact: true }).click();
      const savedTabs = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      await host.evaluate(
        (ui) => window.__companionFloatingPanel.syncPanelPreferences(ui, 8, false),
        savedTabs,
      );
      await page.close();
      const reopened = await createPopout(host);
      assert.equal(
        await reopened.page.locator('.csw-workbench').getAttribute('data-composition'),
        'tabs',
      );
      assert.equal(
        await reopened.page
          .getByRole('tab', { name: '大纲', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      assert.deepEqual(
        await reopened.page.evaluate(
          () => window.__companionFloatingPanel.panelPreferences().popoutLayout,
        ),
        savedTabs.popoutLayout,
      );
      await reopened.page.close();
    },
  ],
  [
    'arrangement drag previews commits only on drop and cancels without reverting new content',
    async (host) => {
      await mode(host, true);
      const { page, projection, errors } = await createPopout(host);
      await page.setViewportSize({ width: 924, height: 824 });
      await settle(page);
      const pref = () =>
        page.evaluate(() => window.__companionFloatingPanel.panelPreferences().popoutLayout);
      const original = await pref();
      async function dragOver() {
        const header = await box(page, '[data-pane="outline"] > header strong');
        const target = await box(page, '[data-pane="next"]');
        await page.mouse.move(header.x + 20, header.y + header.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
          steps: 8,
        });
        assert.equal(await page.locator('.csw-drop-preview').isVisible(), true);
      }
      await dragOver();
      assert.deepEqual(await pref(), original);
      projection.snapshot.outlineItems[0].text = '拖动期间完成的新内容';
      projection.snapshot.outlineItems[0].labelText = '拖动期间完成的新内容';
      await project(page, projection, false);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.deepEqual(await pref(), original);
      assert.equal(await page.locator('.csw-drop-preview').isVisible(), false);
      assert.match(
        await page.locator('[data-view-body="outline"]').innerText(),
        /拖动期间完成的新内容/,
      );
      await dragOver();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.mouse.up();
      assert.deepEqual(await pref(), original);
      await dragOver();
      await page.setViewportSize({ width: 880, height: 780 });
      await settle(page);
      await page.mouse.up();
      assert.deepEqual(await pref(), original);
      await dragOver();
      await page.mouse.up();
      assert.equal((await pref()).group, 'tabs');
      assert.equal((await pref()).active, 'outline');
      const tab = await box(page, '[data-pane-tab="outline"]');
      const panes = await box(page, '.csw-workbench-panes');
      await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
      await page.mouse.down();
      await page.mouse.move(panes.x + panes.width - 12, panes.y + panes.height / 2, { steps: 8 });
      assert.equal((await pref()).group, 'tabs', 'tab drag only previews before drop');
      await page.mouse.up();
      assert.equal((await pref()).group, 'split');
      assert.equal((await pref()).mode, 'horizontal');
      assert.equal((await pref()).first, 'next', 'outline dropped on the right');
      const split = await pref();
      await dragOver();
      await page.mouse.move(1, 1);
      await page.mouse.up();
      assert.deepEqual(await pref(), split, 'outside drop retains layout');
      assert.equal(await page.locator('.csw-drop-preview').isVisible(), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.popoutFixture.unexpected), []);
      await page.close();
    },
  ],

  [
    'layout enhancement keeps panes alive, remembers each surface and adapts without overwriting intent',
    async (host) => {
      await mode(host, true);
      await chooseLayout(host, 'horizontal');
      assert.equal(
        await host.locator('.csw-workbench-panes').getAttribute('data-axis'),
        'vertical',
      );
      const dockPrefs = await host.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      assert.equal(dockPrefs.dockLayout.mode, 'horizontal');
      await layout(host);
      const { page, projection, errors } = await createPopout(host);
      await page.setViewportSize({ width: 664, height: 564 });
      await page.waitForFunction(
        () => document.querySelector('.csw-workbench-panes').dataset.axis === 'horizontal',
      );
      const before = await scrollPanes(page, 43, 37, 31);
      await page.evaluate(() => {
        window.layoutBodies = [...document.querySelectorAll('.csw-workbench-pane')].map((node) => [
          node,
          node.querySelector('.csw-body').firstElementChild,
        ]);
      });
      const pref = () => page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      const horizontal = (await pref()).popoutLayout.horizontalRatio;
      // 布局入口在设置覆盖页打开时也应立即显示选中状态。
      await page.locator('[data-workbench-settings]').click();
      await chooseLayout(page, 'vertical');
      assert.equal(
        await page.locator('[data-layout-mode="vertical"]').getAttribute('aria-pressed'),
        'true',
      );
      await page.locator('[data-workbench-settings]').click();

      await chooseLayout(page, 'vertical');
      await page.getByRole('separator', { name: '调整大纲与下一步比例' }).press('ArrowDown');
      const vertical = (await pref()).popoutLayout.verticalRatio;
      await chooseLayout(page, 'horizontal');
      const handle = page.getByRole('separator', { name: '调整大纲与下一步比例' });
      assert.equal(await handle.getAttribute('aria-orientation'), 'vertical');
      await handle.press('ArrowRight');
      assert.ok((await pref()).popoutLayout.horizontalRatio > horizontal);
      const startRatio = (await pref()).popoutLayout.horizontalRatio;
      const rect = await handle.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width / 2 + 12, rect.y + rect.height / 2, { steps: 4 });
      await page.mouse.up();
      assert.ok(
        (await pref()).popoutLayout.horizontalRatio > startRatio,
        'pointer follows the horizontal divider',
      );

      assert.equal((await pref()).popoutLayout.verticalRatio, vertical);
      await chooseLayout(page, 'swap');
      assert.equal(
        await page.locator('.csw-workbench-panes > [data-pane]').first().getAttribute('data-pane'),
        'next',
      );
      assert.equal(
        await page.evaluate(() =>
          window.layoutBodies.every(
            ([node, child]) =>
              node.isConnected && node.querySelector('.csw-body').firstElementChild === child,
          ),
        ),
        true,
      );
      const now = await reading(page);
      near(now.panes.outline.scrollTop, before.outline, 'layout keeps outline reading');
      near(now.panes.next.scrollTop, before.next, 'layout keeps next reading');
      near(now.promptScrollTop, before.preview, 'layout keeps preview reading');
      assert.deepEqual((await pref()).dockLayout, dockPrefs.dockLayout);
      await page.setViewportSize({ width: 424, height: 564 });
      await page.waitForFunction(
        () => document.querySelector('.csw-workbench-panes').dataset.axis === 'vertical',
      );
      assert.equal((await pref()).popoutLayout.mode, 'horizontal');
      await page.setViewportSize({ width: 664, height: 564 });
      await page.waitForFunction(
        () => document.querySelector('.csw-workbench-panes').dataset.axis === 'horizontal',
      );
      await chooseLayout(page, 'auto');
      // 16px pane padding + 24px native inset: exit below 528, enter at 560.
      for (const [width, axis] of [
        [527, 'vertical'],
        [540, 'vertical'],
        [561, 'horizontal'],
        [540, 'horizontal'],
      ]) {
        await page.setViewportSize({ width, height: 564 });
        await settle(page);
        assert.equal(await page.locator('.csw-workbench-panes').getAttribute('data-axis'), axis);
      }
      await page.setViewportSize({ width: 664, height: 564 });
      await settle(page);
      await page.screenshot({ path: resolve(output, 'layout-horizontal.png') });
      projection.preferences.ui = await pref();
      const saved = projection.preferences.ui;
      await host.evaluate(
        (ui) => window.__companionFloatingPanel.syncPanelPreferences(ui, 4, false),
        saved,
      );
      await settle(host);
      assert.deepEqual(
        await host.evaluate(() => window.__companionFloatingPanel.panelPreferences().popoutLayout),
        saved.popoutLayout,
      );
      assert.equal(
        await host.locator('.csw-workbench-panes').getAttribute('data-axis'),
        'vertical',
      );
      await page.close();
      const reopened = await createPopout(host);
      assert.deepEqual(
        await reopened.page.evaluate(
          () => window.__companionFloatingPanel.panelPreferences().popoutLayout,
        ),
        saved.popoutLayout,
      );
      await chooseLayout(reopened.page, 'reset');
      const reset = await reopened.page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      assert.deepEqual(reset.popoutLayout, {
        group: 'split',
        active: 'outline',
        mode: 'auto',
        first: 'outline',
        verticalRatio: 0.45,
        horizontalRatio: 0.4,
      });
      assert.deepEqual(reset.dockLayout, saved.dockLayout);
      await chooseLayout(host, 'vertical');
      await host.locator('.csw-layout-menu summary').click();
      await host.screenshot({ path: resolve(output, 'layout-docked-menu.png') });
      assert.deepEqual(errors, []);
      assert.deepEqual(await reopened.page.evaluate(() => window.popoutFixture.unexpected), []);
    },
  ],
  [
    '回答生成期间大纲静态等待，完成后恢复，弹出使用同一状态',
    async (page) => {
      await mode(page, true);
      await page.evaluate(() => {
        const stop = document.createElement('button');
        stop.id = 'fixture-stop';
        stop.setAttribute('aria-label', '停止');
        stop.textContent = '停止';
        document.querySelector('#answer').prepend(stop);
        document.querySelector('#answer h2').textContent = '新的回答正在生成';
        window.__companionFloatingPanel.scan();
      });
      const body = page.locator('[data-view-body="outline"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-view-body="outline"]')?.textContent.includes('等待回答完成'),
      );
      assert.equal(await body.locator('.csw-progress-ring').count(), 0);
      assert.equal(
        await body.locator('[data-outline-id]').count(),
        0,
        'new answer clears old outline',
      );
      const popout = await createPopout(page, true);
      try {
        assert.match(
          await popout.page.locator('[data-view-body="outline"]').innerText(),
          /等待回答完成/,
        );
        assert.equal(
          await popout.page.locator('[data-view-body="outline"] .csw-progress-ring').count(),
          0,
        );
        await page.screenshot({ path: resolve(output, 'outline-waiting.png') });
        await page.evaluate(() => {
          document.querySelector('#fixture-stop').remove();
          window.__companionFloatingPanel.scan();
        });
        await page.waitForFunction(() =>
          document.querySelector('[data-view-body="outline"] [data-outline-id]'),
        );
        popout.projection.snapshot = await page.evaluate(() =>
          window.__companionFloatingPanel.exportPanelState(),
        );
        await project(popout.page, popout.projection, false);
        assert.ok(
          await popout.page.locator('[data-view-body="outline"] [data-outline-id]').count(),
        );
        assert.deepEqual(popout.errors, []);
      } finally {
        await popout.page.close();
      }
    },
  ],
  [
    'complete workbench flow isolates late results and preserves layout and reading',
    async (page, baseline) => {
      await page.evaluate(() => {
        window.workbenchFixture.deferred = [];
        const answer = document.querySelector('#answer');
        for (let i = 0; i < 30; i++) {
          const heading = document.createElement('h2');
          heading.textContent = `流程章节 ${i + 1}`;
          answer.append(heading);
        }
        window.__companionFloatingPanel.scan();
      });
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.outlineItems.length === 24,
      );
      await mode(page, true);
      await layout(page);
      await page.locator('[data-view-body="outline"]').evaluate((node) => {
        node.scrollTop = 120;
        window.workbenchFixture.outlineBody = node;
      });
      await page.locator('[data-refresh="next"]').click();
      await page.waitForFunction(() => window.workbenchFixture.deferred.length === 1);
      for (const action of ['horizontal', 'swap', 'vertical', 'auto', 'swap', 'merge', 'split'])
        await chooseLayout(page, action);
      assert.equal(
        await page.evaluate(
          () =>
            window.workbenchFixture.requests.filter(({ path }) => path === '/stepwise/generate')
              .length,
        ),
        1,
        'layout during generation does not request again',
      );

      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector('[data-view-body="outline"]') ===
            window.workbenchFixture.outlineBody,
        ),
        true,
        'generating next does not rebuild outline',
      );
      near(
        (await reading(page)).panes.outline.scrollTop,
        120,
        'generation preserves outline reading',
      );
      const original = await page.evaluate(() =>
        window.__companionFloatingPanel.exportPanelState(),
      );
      const jump = await page.evaluate(
        (source) =>
          window.__companionFloatingPanel.panelCommand({
            ...source,
            kind: 'outline-jump',
            id: source.outlineItems[10].id,
          }),
        original,
      );
      assert.equal(jump.ok, true, 'outline remains operable during generation');

      await page.evaluate(() => {
        document.body.dataset.companionThreadId = 'fixture-thread-b';
        for (const attribute of ['data-thread-id', 'data-response-annotation-conversation'])
          for (const node of document.querySelectorAll(`[${attribute}]`))
            node.setAttribute(attribute, 'fixture-thread-b');
        document.querySelector('#answer h2').textContent = '聊天 B 新章节';
        window.__companionFloatingPanel.scan();
      });
      await page.waitForFunction(
        () =>
          window.__companionFloatingPanel.exportPanelState().context.sessionId ===
            'fixture-thread-b' && window.__companionFloatingPanel.state.scanStatus === 'ready',
      );
      await page.locator('[data-refresh="next"]').click();
      await page.waitForFunction(() => window.workbenchFixture.deferred.length === 2);
      await page.evaluate(() =>
        window.__companionDesktop.complete(window.workbenchFixture.deferred[0].id, {
          items: [{ label: '过期 A', prompt: '过期 A 不得出现在 B' }],
        }),
      );
      await settle(page);
      assert.equal(
        await page.evaluate(() => window.__companionFloatingPanel.state.bridgeStatus),
        'pending',
        'late A does not complete B request',
      );
      assert.equal(
        await page.evaluate(() => window.__companionFloatingPanel.state.prompts.length),
        0,
        'late A is discarded',
      );
      const staleFill = await page.evaluate(
        (source) =>
          window.__companionFloatingPanel.panelCommand({
            ...source,
            kind: 'fill',
            index: 0,
            submit: false,
          }),
        original,
      );
      assert.equal(staleFill.ok, false, 'old A command cannot write into B');
      assert.equal(await page.locator('#composer-form .ProseMirror').innerText(), '');
      await page.evaluate(() =>
        window.__companionDesktop.complete(window.workbenchFixture.deferred[1].id, {
          items: Array.from({ length: 4 }, (_, i) => ({
            label: `B 建议 ${i + 1}`,
            summary: '连续流程验证',
            prompt: `B 建议 ${i + 1}\n${'这是合成预览内容，用于确认阅读位置。\n'.repeat(80)}`,
          })),
        }),
      );
      await page.waitForFunction(() => window.__companionFloatingPanel.state.prompts.length === 4);
      assert.equal(
        await page
          .locator('[data-view-body="next"]')
          .innerText()
          .then((t) => t.includes('过期 A')),
        false,
      );
      await page.getByRole('separator', { name: '调整工作台宽度' }).press('ArrowLeft');
      await page.getByRole('separator', { name: '调整大纲与下一步比例' }).press('ArrowDown');
      const preferences = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      await page.setViewportSize({ width: 880, height: 960 });
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.dockStatus === 'space',
      );
      near((await box(page, slotSelector)).width, 44, 'space collapse only leaves rail');
      await page.setViewportSize(wide);
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.dockStatus === 'closed',
      );
      const collapsed = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      for (const key of ['dockOpen', 'dockWidth', 'splitRatio'])
        assert.equal(collapsed[key], preferences[key], `${key} retains user intent`);
      await page.getByRole('button', { name: '打开停靠工作台' }).click();
      await page.waitForFunction(() => window.__companionFloatingPanel.state.dockStatus === 'open');
      await settle(page);
      await layout(page);
      const before = await scrollPanes(page, 90, 20, 25);
      assert.equal(before.outline, 90);
      const hostReading = await reading(page);
      const { page: popout, projection, errors } = await createPopout(page, true);
      const arrived = await reading(popout);
      near(
        arrived.panes.outline.scrollTop,
        hostReading.panes.outline.scrollTop,
        'outbound outline reading',
      );
      near(arrived.promptScrollTop, hostReading.promptScrollTop, 'outbound preview reading');
      await page.evaluate(() => window.__companionFloatingPanel.setDetached(true));
      assert.equal(
        await page.locator('.csw-workbench').isVisible(),
        false,
        'source relinquishes interaction after target ready',
      );
      await popout.locator('.csw-list [data-index="2"]').hover();
      await popout.waitForFunction(
        () => window.__companionFloatingPanel.panelReadingState().promptPreviewIndex === 2,
      );
      await scrollPanes(popout, 65, 30, 40);
      const returned = await reading(popout);
      await page.evaluate(
        (reading) => window.__companionFloatingPanel.setDetached(false, null, reading),
        returned,
      );
      await popout.close();
      await settle(page);
      const restored = await reading(page);
      near(
        restored.panes.outline.scrollTop,
        returned.panes.outline.scrollTop,
        'return outline reading',
      );
      near(restored.promptScrollTop, returned.promptScrollTop, 'return preview reading');
      assert.equal(restored.promptPreviewIndex, 2, 'return selected preview');
      assert.equal(
        restored.viewToken,
        projection.snapshot.viewToken,
        'same B context through handoff',
      );
      assert.deepEqual(errors, []);
      await page.locator('[data-workbench-close]').click();
      const closed = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      assert.equal(closed.dockOpen, false, 'explicit close updates intent');
      await page.setViewportSize({ width: 1500, height: 960 });
      await settle(page);
      assert.equal(
        await page.locator('.csw-workbench').isVisible(),
        false,
        'explicit close stays closed',
      );
      await page.setViewportSize(wide);
      await mode(page, false);
      await hostUnchanged(page, baseline);
      assert.equal(
        await page.evaluate(
          () =>
            window.workbenchFixture.requests.filter((r) => r.path === '/stepwise/generate').length,
        ),
        2,
        'only the two explicit clicks generate',
      );
    },
  ],
  [
    'chat content replacement keeps the workbench on the right and rebinds its layout',
    async (page) => {
      await mode(page, true);
      await openChatSurface(page);
      for (let i = 0; i < 3; i++) {
        const immediate = await page.evaluate(() => {
          const old = document.querySelector('[data-codex-buddy-chat-content]');
          const row = old.parentElement;
          const next = old.cloneNode(true);
          next.removeAttribute('data-codex-buddy-chat-content');
          window.workbenchFixture.replacedContent = old;
          old.remove();
          // 宿主切换空聊天/已有对话时，会把新内容追加到仍存在的占位后面。
          row.append(next);
          const slot = row.querySelector('[data-codex-buddy-dock]');
          return next.getBoundingClientRect().right <= slot.getBoundingClientRect().left + 1;
        });
        assert.equal(immediate, true, 'replacement must not produce a left-docked frame');
        await page.waitForFunction(() => {
          const content = document.querySelector(
            '#foreground-chat [data-codex-buddy-chat-content]',
          );
          return content && window.__companionFloatingPanel.state.dockStatus === 'open';
        });
        await settle(page);
        const content = await box(page, '#foreground-chat [data-codex-buddy-chat-content]');
        const slot = await box(page, '#foreground-chat [data-codex-buddy-dock]');
        const composer = await box(page, '#foreground-composer');
        const panel = await box(page, panelSelector);
        assert.ok(content.x + content.width <= slot.x + 1, 'chat stays left');
        assert.ok(composer.x + composer.width <= slot.x + 1, 'composer stays left');
        near(panel.x, slot.x, 'panel follows the right slot');
        assert.equal(await page.locator(slotSelector).count(), 1);
        assert.equal(await page.locator('[data-companion-stepwise-root]').count(), 1);
        assert.equal(
          await page.evaluate(() =>
            window.workbenchFixture.replacedContent.hasAttribute('data-codex-buddy-chat-content'),
          ),
          false,
          'old content released',
        );
      }
      await page.evaluate(() => window.__companionFloatingPanel.setWorkbench(false));
      await settle(page);
      assert.equal(
        await page.locator('[data-codex-buddy-chat-row],[data-codex-buddy-chat-content]').count(),
        0,
      );
      assert.equal(await page.locator(slotSelector).count(), 0);
    },
  ],
  [
    'main reading position returns after foreground chat closes',
    async (page) => {
      await page.evaluate(() => {
        const answer = document.querySelector('#answer');
        for (let i = 0; i < 35; i++) {
          const h = document.createElement('h2');
          h.textContent = `章节 ${i}`;
          answer.append(h);
        }
        window.__companionFloatingPanel.scan();
      });
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.outlineItems.length >= 24,
      );
      await mode(page, true);
      await page.locator('[data-pane="outline"] .csw-body').evaluate((n) => (n.scrollTop = 120));
      const top = await page
        .locator('[data-pane="outline"] .csw-body')
        .evaluate((n) => n.scrollTop);
      assert.ok(top > 0);
      await openChatSurface(page);
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.scanStatus === 'ready',
      );
      await page.locator('#foreground-chat').evaluate((n) => n.remove());
      await page.waitForFunction(
        () =>
          window.__companionFloatingPanel.state.dockStatus === 'open' &&
          !document.querySelector('#foreground-chat'),
      );
      await page.waitForFunction(
        () =>
          !window.__companionFloatingPanel
            .exportPanelState()
            .context.paneKey.startsWith('pane:dialog:') &&
          window.__companionFloatingPanel.state.outlineItems.length >= 24,
      );
      await settle(page);
      near(
        await page.locator('[data-pane="outline"] .csw-body').evaluate((n) => n.scrollTop),
        top,
        'main reading restored',
      );
    },
  ],

  [
    'foreground chat owns the workbench and its composer; closing restores main layout',
    async (page, baseline) => {
      await mode(page, true);
      const before = await layout(page);
      await openChatSurface(page);
      await page.waitForFunction(() =>
        window.__companionFloatingPanel
          .exportPanelState()
          .context.paneKey.startsWith('pane:dialog:'),
      );
      const chat = await box(page, '[data-codex-buddy-chat-content]');
      const slot = await box(page, '#foreground-chat [data-codex-buddy-dock]');
      const composer = await box(page, '#foreground-composer');
      const panel = await box(page, panelSelector);
      assert.ok(chat.x + chat.width <= slot.x + 1);
      assert.ok(composer.x + composer.width <= slot.x + 1);
      near(panel.x, slot.x, 'actual panel inside slot');
      assert.equal(await page.locator(slotSelector).count(), 1);
      near(
        (await box(page, '#fixture-host-content')).width,
        baseline.width,
        'background workspace fully released',
      );
      await page.waitForFunction(() => {
        const p = window.__companionFloatingPanel;
        return p.state.scanStatus === 'ready' && !!p.state.lastAssistantHash;
      });
      const result = await page.evaluate(() => {
        const p = window.__companionFloatingPanel;
        p.scan();
        p.state.prompts.push({ label: '合成填入', summary: '验证目标', prompt: 'FOREGROUND_ONLY' });
        p.renderFloat();
        const state = p.exportPanelState();
        return p.panelCommand({
          kind: 'fill',
          instanceId: state.instanceId,
          context: state.context,
          viewToken: state.viewToken,
          promptToken: state.promptToken,
          index: 0,
          submit: false,
        });
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(
        await page.locator('#foreground-composer .ProseMirror').innerText(),
        'FOREGROUND_ONLY',
      );
      assert.equal(await page.locator('#fixture-host-content .ProseMirror').innerText(), '');
      await page.locator('#foreground-chat').evaluate((node) => node.remove());
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-codex-buddy-chat-row]') &&
          window.__companionFloatingPanel.state.dockStatus === 'open',
      );
      await settle(page);
      near((await layout(page)).slot.width, before.slot.width, 'main width restored');
      await hostUnchanged(page);
    },
  ],
  [
    'narrow foreground chat preserves saved open state and width',
    async (page) => {
      await mode(page, true);
      const preferences = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      await openChatSurface(page, 720);
      assert.equal(await page.locator('.csw-workbench').isVisible(), false);
      near((await box(page, '#foreground-chat [data-codex-buddy-dock]')).width, 44, 'narrow rail');
      const current = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      assert.equal(current.dockOpen, preferences.dockOpen);
      assert.equal(current.dockWidth, preferences.dockWidth);
      await page.locator('#foreground-chat').evaluate((node) => node.remove());
      await page.waitForFunction(() => window.__companionFloatingPanel.state.dockStatus === 'open');
      await settle(page);
      await layout(page);
    },
  ],
  [
    'modal suspends docking and restores foreground chat without changing preferences',
    async (page) => {
      await mode(page, true);
      await openChatSurface(page);
      await page.waitForFunction(
        () =>
          window.__companionFloatingPanel.state.scanStatus === 'ready' &&
          window.__companionFloatingPanel.state.outlineItems.length > 0,
      );
      const readingBefore = await page
        .locator('[data-pane="outline"] .csw-body')
        .evaluate((node) => {
          const filler = document.createElement('div');
          filler.style.minHeight = '1000px';
          node.append(filler);
          node.scrollTop = 60;
          return node.scrollTop;
        });
      assert.ok(readingBefore > 0);
      const prefs = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      await page.evaluate(() => {
        const modal = document.createElement('div');
        modal.id = 'settings-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.style.cssText = 'position:fixed;inset:100px;z-index:100;background:white';
        document.body.append(modal);
      });
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.dockStatus === 'suspended',
      );
      assert.equal(await page.locator(slotSelector).count(), 0);
      assert.equal(await page.locator('.csw-workbench').isVisible(), false);
      assert.equal(await page.locator('[data-codex-buddy-chat-row]').count(), 0);
      await page.locator('#settings-dialog').evaluate((node) => node.remove());
      await page.waitForFunction(() => window.__companionFloatingPanel.state.dockStatus === 'open');
      await settle(page);
      assert.equal(
        await page.locator('#foreground-chat [data-companion-stepwise-root]').count(),
        1,
      );
      near(
        await page.locator('[data-pane="outline"] .csw-body').evaluate((node) => node.scrollTop),
        readingBefore,
        'modal preserves reading',
      );
      const after = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      assert.equal(after.dockWidth, prefs.dockWidth);
      assert.equal(after.dockOpen, prefs.dockOpen);
      await page.evaluate(() => window.__companionFloatingPanel.destroy());
      assert.equal(
        await page.locator('[data-codex-buddy-chat-row],[data-codex-buddy-chat-content]').count(),
        0,
      );
    },
  ],

  [
    'popout restores independent pane reading and ordinary projections preserve it',
    async (host) => {
      await mode(host, true);
      const { page, projection, errors } = await createPopout(host);
      const tops = await scrollPanes(page, 43, 67, 31);
      assert.deepEqual(
        tops,
        { outline: 43, next: 67, preview: 31 },
        'fixture really scrolls all reading surfaces',
      );
      projection.snapshot.readingState = { ...(await reading(page)), promptPreviewIndex: 2 };
      await scrollPanes(page, 0, 0);
      await project(page, projection, true);
      const restored = await reading(page);
      near(restored.panes.outline.scrollTop, 43, 'outline scroll restored');
      near(restored.panes.next.scrollTop, 67, 'Stepwise scroll restored');
      near(restored.promptScrollTop, 31, 'preview scroll restored');
      assert.equal(
        await page.locator('.csw-prompt-preview').getAttribute('data-preview-index'),
        '2',
        `DOM preview must follow restored selection; runtime index=${restored.promptPreviewIndex}`,
      );
      await scrollPanes(page, 89, 103, 47);
      const before = await reading(page);
      projection.snapshot.accentColor = 'rgb(48, 164, 108)';
      await project(page, projection, false);
      assert.deepEqual(
        await reading(page),
        before,
        'ordinary projection does not overwrite local reading',
      );
      const separator = page.getByRole('separator', { name: '调整大纲与下一步比例' });
      await separator.press('ArrowDown');
      const saved = await page.evaluate(() => window.popoutFixture.saves.at(-1));
      assert.equal(saved.layoutMode, 'workbench');
      assert.equal(
        saved.splitRatio,
        await page.evaluate(() => window.__companionFloatingPanel.panelPreferences().splitRatio),
      );
      assert.deepEqual(await page.evaluate(() => window.popoutFixture.unexpected), []);
      assert.deepEqual(errors, []);
    },
  ],
  [
    'popout rejects stale reading per pane and for a different task',
    async (host) => {
      await mode(host, true);
      const { page, projection, errors } = await createPopout(host);
      const valid = await reading(page);
      for (const stalePane of ['outline', 'next']) {
        await scrollPanes(page, 0, 0);
        const incoming = structuredClone(valid);
        incoming.panes.outline.scrollTop = 53;
        incoming.panes.next.scrollTop = 71;
        incoming.panes[stalePane].contentToken = 'stale-content';
        incoming.promptPreviewIndex = 2;
        incoming.promptScrollTop = 29;
        projection.snapshot.readingState = incoming;
        await project(page, projection, true);
        const actual = await reading(page);
        near(actual.panes[stalePane].scrollTop, 0, `${stalePane} stale scroll ignored`);
        const other = stalePane === 'outline' ? 'next' : 'outline';
        near(
          actual.panes[other].scrollTop,
          incoming.panes[other].scrollTop,
          `${other} valid scroll restored independently`,
        );
        assert.equal(
          await page.locator('.csw-prompt-preview').getAttribute('data-preview-index'),
          stalePane === 'next' ? '0' : '2',
          `${stalePane} stale token; runtime preview index=${actual.promptPreviewIndex}`,
        );
        if (stalePane === 'next') near(actual.promptScrollTop, 0, 'stale preview scroll ignored');
      }
      await scrollPanes(page, 0, 0);
      projection.snapshot.readingState = structuredClone(valid);
      projection.snapshot.readingState.viewToken = 'different-task';
      projection.snapshot.readingState.panes.outline.scrollTop = 53;
      projection.snapshot.readingState.panes.next.scrollTop = 71;
      await project(page, projection, true);
      const rejected = await reading(page);
      near(rejected.panes.outline.scrollTop, 0, 'different task outline scroll ignored');
      near(rejected.panes.next.scrollTop, 0, 'different task Stepwise scroll ignored');
      assert.deepEqual(await page.evaluate(() => window.popoutFixture.unexpected), []);
      assert.deepEqual(errors, []);
    },
  ],
  [
    'collapsed rail exposes open/popout/exit and exit restores capsule',
    async (page, baseline) => {
      await mode(page, true);
      await page.getByRole('button', { name: '收起工作台', exact: true }).click();
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.dockStatus === 'closed',
      );
      const rail = page.locator(slotSelector);
      assert.equal(await rail.getByRole('button').count(), 3);
      for (const name of ['打开停靠工作台', '弹出工作台', '切回胶囊']) {
        assert.equal(await rail.getByRole('button', { name, exact: true }).isVisible(), true);
        assert.equal(await rail.getByRole('button', { name, exact: true }).isEnabled(), true);
      }
      await rail.getByRole('button', { name: '切回胶囊', exact: true }).click();
      await settle(page);
      assert.equal(await page.locator(slotSelector).count(), 0);
      assert.equal(await page.locator('.csw-workbench').count(), 0);
      await box(page, panelSelector);
      await hostUnchanged(page, baseline);
    },
  ],
  [
    'unsupported host falls back to visible capsule without a dock slot',
    async (page, baseline) => {
      await page
        .locator('.workspace')
        .evaluate((node) => node.classList.remove('app-shell-main-content-frame'));
      await page.evaluate(() => window.__companionFloatingPanel.setWorkbench(true));
      await page.waitForFunction(
        () => window.__companionFloatingPanel.state.dockStatus === 'unsupported',
      );
      await settle(page);
      assert.equal(await page.locator(slotSelector).count(), 0);
      assert.equal(await page.locator('.csw-workbench').count(), 0);
      await box(page, panelSelector);
      await hostUnchanged(page, baseline);
    },
  ],
  [
    'host that refuses to shrink releases the slot without repeated mounting',
    async (page) => {
      await page.evaluate(() => {
        const content = document.querySelector('#fixture-host-content');
        content.style.minWidth = `${content.getBoundingClientRect().width}px`;
        window.workbenchFixture.mounts = 0;
        new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node instanceof Element && node.hasAttribute('data-codex-buddy-dock'))
                window.workbenchFixture.mounts += 1;
        }).observe(document.querySelector('#fixture-dock-row'), { childList: true });
        window.__companionFloatingPanel.setWorkbench(true);
      });
      await settle(page);
      assert.equal(
        await page.evaluate(() => window.__companionFloatingPanel.state.dockStatus),
        'unsupported',
      );
      assert.equal(await page.locator(slotSelector).count(), 0);
      await box(page, panelSelector);
      const mounts = await page.evaluate(() => window.workbenchFixture.mounts);
      for (let i = 0; i < 10; i += 1) await settle(page);
      assert.equal(await page.evaluate(() => window.workbenchFixture.mounts), mounts);
    },
  ],
  [
    'large popout dimensions survive embedded rendering and preference handoff',
    async (page) => {
      const saved = await page.evaluate(() => ({
        ...window.__companionFloatingPanel.panelPreferences(),
        width: 1200,
        height: 900,
        open: true,
        layoutMode: 'capsule',
        activeTab: 'outline',
      }));
      await page.evaluate(
        (ui) => window.__companionFloatingPanel.syncPanelPreferences(ui, 1, false),
        saved,
      );
      await settle(page);
      const embedded = await box(page, '[data-companion-stepwise-root] .csw-glass');
      assert.ok(embedded.width <= 640 && embedded.height <= 720, 'embedded stays bounded');
      const retained = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      assert.equal(retained.width, 1200);
      assert.equal(retained.height, 900);
      const popout = await createPopout(page);
      await popout.page.setViewportSize({ width: 1224, height: 924 });
      await settle(popout.page);
      const enlarged = await box(popout.page, '[data-companion-stepwise-root] .csw-glass');
      near(enlarged.width, 1200, 'native content expands past old width cap');
      near(enlarged.height, 900, 'native content expands past old height cap');
      const updated = await popout.page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      await page.evaluate(
        (ui) => window.__companionFloatingPanel.syncPanelPreferences(ui, 2, false),
        updated,
      );
      const returned = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      assert.equal(returned.width, 1200);
      assert.equal(returned.height, 900);
      await popout.page.close();
    },
  ],
  [
    'initial webRevision zero restores workbench layout and exported preferences',
    async (page) => {
      const saved = await page.evaluate(() => ({
        ...window.__companionFloatingPanel.panelPreferences(),
        layoutMode: 'workbench',
        dockWidth: 380,
        splitRatio: 0.6,
        dockLayout: null,
        popoutLayout: null,
        dockOpen: true,
      }));
      await page.evaluate(
        (ui) => window.__companionFloatingPanel.syncPanelPreferences(ui, 0, false),
        saved,
      );
      await page.waitForFunction(() => window.__companionFloatingPanel.state.dockStatus === 'open');
      await settle(page);
      near((await layout(page)).slot.width, 380, 'initial saved width applied');
      const restored = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      for (const key of ['layoutMode', 'dockWidth', 'splitRatio', 'dockOpen'])
        assert.equal(restored[key], saved[key], key);
    },
  ],
  [
    'real layout reserves host space and shows both panes',
    async (page) => {
      await mode(page, true);
      await layout(page);
      assert.match(await page.locator('[data-view-body="outline"]').innerText(), /架构与边界/);
      assert.ok(
        (await page.locator('[data-view-body="next"]').innerText()).trim(),
        'Stepwise has content',
      );
      await hostUnchanged(page);
    },
  ],
  [
    '20 close/open cycles restore host geometry without host style writes',
    async (page, baseline) => {
      await mode(page, true);
      for (let cycle = 0; cycle < 20; cycle += 1) {
        await mode(page, false);
        await hostUnchanged(page, baseline);
        await mode(page, true);
        await layout(page);
        await hostUnchanged(page);
      }
      await mode(page, false);
      await hostUnchanged(page, baseline);
    },
  ],
  [
    'width keyboard resizing exports bounded preferences independently of capsule size',
    async (page) => {
      const capsule = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      await mode(page, true);
      const handle = page.getByRole('separator', { name: '调整工作台宽度' });
      const before = await layout(page);
      await handle.press('ArrowLeft');
      await settle(page);
      const larger = await layout(page);
      near(larger.slot.width, before.slot.width + 16, 'ArrowLeft widens dock');
      near(larger.content.width, before.content.width - 16, 'host yields matching space');
      await handle.press('ArrowRight');
      await settle(page);
      near((await layout(page)).slot.width, before.slot.width, 'ArrowRight restores width');
      for (let i = 0; i < 12; i += 1) await handle.press('ArrowLeft');
      await settle(page);
      near((await layout(page)).slot.width, 460, 'maximum width');
      for (let i = 0; i < 12; i += 1) await handle.press('ArrowRight');
      await settle(page);
      near((await layout(page)).slot.width, 300, 'minimum width');
      const saved = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
      assert.equal(saved.dockWidth, 300);
      assert.equal(saved.layoutMode, 'workbench');
      assert.equal(saved.width, capsule.width, 'capsule width stays independent');
      assert.equal(saved.height, capsule.height, 'capsule height stays independent');
      await mode(page, false);
      await mode(page, true);
      near((await layout(page)).slot.width, 300, 'width survives mode switch');
      await hostUnchanged(page);
    },
  ],
  [
    'ratio keyboard resizing adjusts both panes and exports bounded ratio',
    async (page) => {
      await mode(page, true);
      const handle = page.getByRole('separator', { name: '调整大纲与下一步比例' });
      const before = await layout(page);
      const geometryBefore = await splitGeometry(page);
      await handle.press('ArrowDown');
      await settle(page);
      const changed = await layout(page);
      near(
        changed.outline.height,
        before.outline.height + 16,
        `outline grows ${JSON.stringify({ before: geometryBefore, after: await splitGeometry(page) })}`,
      );
      near(changed.next.height, before.next.height - 16, 'Stepwise shrinks');
      const ratio = await page.evaluate(
        () => window.__companionFloatingPanel.panelPreferences().splitRatio,
      );
      assert.ok(ratio > 0.45 && ratio <= 0.8, 'changed ratio saved');
      await handle.press('ArrowUp');
      await settle(page);
      near(
        (await layout(page)).outline.height,
        before.outline.height,
        'opposite key restores ratio',
      );
      for (const key of ['ArrowDown', 'ArrowUp']) {
        for (let i = 0; i < 40; i += 1) await handle.press(key);
        await settle(page);
        await layout(page);
        const value = await page.evaluate(
          () => window.__companionFloatingPanel.panelPreferences().splitRatio,
        );
        assert.ok(value >= 0.2 && value <= 0.8, 'saved ratio remains bounded');
        near(
          Number(await handle.getAttribute('aria-valuenow')),
          Math.round(value * 100),
          'accessible ratio reflects layout',
        );
      }
    },
  ],
  [
    'insufficient width/height stays collapsed until explicit reopen',
    async (page) => {
      await mode(page, true);
      const preferences = await page.evaluate(() =>
        window.__companionFloatingPanel.panelPreferences(),
      );
      for (const viewport of [
        { width: 880, height: 960 },
        { width: 1440, height: 420 },
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.dockStatus === 'space',
        );
        await settle(page);
        assert.equal(await page.locator('.csw-workbench').isVisible(), false);
        near((await box(page, slotSelector)).width, 44, 'collapsed entry width');
        const entry = page.getByRole('button', { name: '打开停靠工作台' });
        assert.match(await entry.getAttribute('title'), /空间不足/);
        const anchor = await page.evaluate(() =>
          window.__companionFloatingPanel.panelWindowAnchor(),
        );
        assert.ok(anchor, 'collapsed rail has a window anchor');
        near(anchor.width, 44, 'space collapse uses rail width, not saved expanded width');
        near(anchor.height, 44, 'space collapse uses a compact entry anchor');
        await page.evaluate(() => window.__companionFloatingPanel.setDetached(true));
        const detachedAnchor = await page.evaluate(() =>
          window.__companionFloatingPanel.panelWindowAnchor(),
        );
        assert.deepEqual(
          detachedAnchor,
          anchor,
          'detached return still targets the collapsed entry',
        );
        await page.evaluate(() => window.__companionFloatingPanel.setDetached(false));
        await page.setViewportSize(wide);
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.dockStatus === 'closed',
        );
        await settle(page);
        assert.equal(
          await page.locator('.csw-workbench').isVisible(),
          false,
          'resize alone must not reopen',
        );
        assert.equal(await entry.isVisible(), true);
        const after = await page.evaluate(() => window.__companionFloatingPanel.panelPreferences());
        for (const key of ['dockOpen', 'dockWidth', 'splitRatio'])
          assert.equal(after[key], preferences[key], `${key} survives space collapse`);
        await entry.click();
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.dockStatus === 'open',
        );
        await settle(page);
        await layout(page);
      }
      await hostUnchanged(page);
    },
  ],
  [
    'disabled features stay disabled through workbench toggles',
    async (page, baseline) => {
      await mode(page, true);
      for (const disabled of ['next', 'outline']) {
        await syncSettings(page, {
          enabled: disabled !== 'next',
          answerOutlineEnabled: disabled !== 'outline',
        });
        await mode(page, false);
        await mode(page, true);
        await layout(page);
        const pane = page.locator(`[data-pane="${disabled}"]`);
        assert.equal(await pane.locator('[data-refresh]').isDisabled(), true);
        assert.match(await pane.locator('.csw-body').innerText(), /功能已关闭/);
        const other = disabled === 'next' ? 'outline' : 'next';
        assert.equal(await page.locator(`[data-refresh="${other}"]`).isDisabled(), false);
      }
      await syncSettings(page, { enabled: false, answerOutlineEnabled: false });
      assert.equal(await page.locator(slotSelector).count(), 0, 'disabled runtime releases slot');
      await page.evaluate(() => window.__companionFloatingPanel.setWorkbench(true));
      await settle(page);
      assert.equal(
        await page.locator(slotSelector).count(),
        0,
        'mode change cannot reenable features',
      );
      await hostUnchanged(page, baseline);
      await syncSettings(page, { enabled: true, answerOutlineEnabled: true });
      await mode(page, true);
      await layout(page);
    },
  ],
  [
    'host remount reattaches exactly one slot without moving chat nodes',
    async (page) => {
      await mode(page, true);
      await page.evaluate(() => {
        const oldRow = document.querySelector('#fixture-dock-row');
        const replacement = oldRow.cloneNode(true);
        replacement.querySelector('[data-codex-buddy-dock]').remove();
        window.workbenchFixture.oldSlot = oldRow.querySelector('[data-codex-buddy-dock]');
        window.workbenchFixture.remountedContent =
          replacement.querySelector('#fixture-host-content');
        oldRow.replaceWith(replacement);
      });
      await page.waitForFunction(() =>
        document.querySelector('#fixture-dock-row > [data-codex-buddy-dock]'),
      );
      await settle(page);
      await layout(page);
      assert.equal(
        await page.evaluate(() => window.workbenchFixture.oldSlot.parentNode === null),
        true,
        'detached old slot removed',
      );
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector('#fixture-host-content') ===
            window.workbenchFixture.remountedContent,
        ),
        true,
      );
      await mode(page, false);
      assert.equal(await page.locator(slotSelector).count(), 0);
      await mode(page, true);
      await layout(page);
    },
  ],
  [
    'destroy removes slot and resize/mutations cannot resurrect it',
    async (page, baseline) => {
      await mode(page, true);
      await page.evaluate(() => window.__companionFloatingPanel.destroy());
      await settle(page);
      assert.equal(await page.locator(slotSelector).count(), 0);
      assert.equal(await page.locator('[data-companion-stepwise-root]').count(), 0);
      await hostUnchanged(page, baseline);
      const requests = await page.evaluate(() => window.workbenchFixture.requests.length);
      await page.setViewportSize({ width: 1500, height: 1000 });
      await page.evaluate(() => {
        const frame = document.querySelector('.app-shell-main-content-frame');
        const marker = document.createElement('span');
        frame.append(marker);
        marker.remove();
      });
      await settle(page);
      assert.equal(await page.locator(slotSelector).count(), 0, 'no slot after observer triggers');
      assert.equal(await page.evaluate(() => window.workbenchFixture.requests.length), requests);
      await page.evaluate(bundle);
      await page.waitForFunction(() => window.__companionFloatingPanel?.state.runtimeActive);
      await mode(page, true);
      await layout(page);
    },
  ],
];

try {
  for (const [index, [name, run]] of cases.entries()) {
    if (process.env.WORKBENCH_CASE && !name.includes(process.env.WORKBENCH_CASE)) continue;
    const context = await browser.newContext({
      viewport: wide,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    const network = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => {
      if (route.request().url() === `${hostUrl}/popout`)
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>Synthetic popout</title></head><body></body></html>',
        });
      if (route.request().url() === hostUrl)
        return route.fulfill({ contentType: 'text/html', body: fixture });
      network.push(route.request().url());
      return route.abort();
    });
    try {
      const baseline = await setup(page);
      await run(page, baseline);
      assert.deepEqual(errors, [], 'no uncaught browser errors');
      assert.deepEqual(network, [], 'no external network requests');
      assert.deepEqual(
        await page.evaluate(() => window.workbenchFixture.unexpected),
        [],
        'no model or unsupported bridge calls',
      );
      assert.equal(
        await page.evaluate(() => window.__companionDesktop.pending()),
        0,
        'bridge requests completed',
      );
      results.push({ name, status: 'passed' });
      console.log(`PASS ${name}`);
    } catch (error) {
      const screenshots = [];
      for (const [pageIndex, target] of context.pages().entries()) {
        const file = `failure-${index + 1}-${pageIndex === 0 ? 'host' : 'popout'}.png`;
        await target
          .screenshot({ path: resolve(output, file) })
          .then(() => screenshots.push(file))
          .catch(() => {});
      }
      results.push({ name, status: 'failed', error: error.message, errors, network, screenshots });
      console.error(`FAIL ${name}: ${error.stack}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(
    resolve(output, process.env.WORKBENCH_CASE ? 'selected-results.json' : 'results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}
assert.ok(results.length, 'at least one case matched');
const failed = results.filter((result) => result.status === 'failed').length;
console.log(`Workbench: ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
