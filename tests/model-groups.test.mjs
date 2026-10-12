/* [INPUT]: Real model classification/settings/view components and isolated synthetic model API.
 * [OUTPUT]: Conservative classification, manual precedence, persisted groups, failure/conflict retention and matrix compatibility.
 * [POS]: No real model switches, chats or preferences. [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const catalog = await build({
  entryPoints: ['ui/features/model/catalog.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const { automaticManufacturer, modelGroup, groupedModels } = await import(
  `data:text/javascript;base64,${Buffer.from(catalog.outputFiles[0].text).toString('base64')}`
);
const model = (id, label = id) => ({ id, label, reasoning: ['low', 'high'], fast: false });
test('manufacturer ignores routing prefixes, handles conflicts and manual groups without merging routes', () => {
  assert.equal(
    automaticManufacturer(model('workbuddy-plugin/claude-opus-test', 'Claude test')),
    'Anthropic',
  );
  assert.equal(automaticManufacturer(model('google-route/gpt-test', 'GPT test')), 'OpenAI');
  assert.equal(automaticManufacturer(model('group/private-name', 'custom')), '');
  assert.equal(automaticManufacturer(model('gpt-test', 'Claude test')), '');
  assert.equal(automaticManufacturer(model('foo/my-gpt-wrapper')), '');
  const prefs = {
    pinned: [],
    presets: [],
    groups: [{ id: 'coding', name: '编程' }],
    modelOverrides: { a: { manufacturer: '新厂家', groupId: 'coding' } },
  };
  assert.deepEqual(modelGroup(model('a'), prefs), { id: 'custom:coding', name: '编程' });
  delete prefs.modelOverrides.a.groupId;
  assert.equal(modelGroup(model('a'), prefs).name, '新厂家');
  delete prefs.modelOverrides.a;
  assert.equal(modelGroup(model('a'), prefs).name, '未分类');
  const routes = [
    model('route-a/claude-test', 'Claude test'),
    model('route-b/claude-test', 'Claude test'),
  ];
  assert.equal(groupedModels(routes, prefs)[0].models.length, 2);
});

test('unconnected mainstream model families are classified without creating empty groups', () => {
  const examples = [
    ['MiniMaxAI/MiniMax-M2.7-highspeed', 'MiniMax'],
    ['route/minimax-m3', 'MiniMax'],
    ['baidu/ERNIE-4.5-300B-A47B', '百度'],
    ['doubao-seed-2-0-pro', '字节跳动'],
    ['seed-oss-36b-instruct', '字节跳动'],
    ['xiaomi/mimo-v2.5', '小米'],
    ['us.amazon.nova-pro-v1:0', 'Amazon'],
    ['nova-2-lite', 'Amazon'],
    ['cohere.command-r-v1:0', 'Cohere'],
    ['command-a-03-2025', 'Cohere'],
    ['microsoft/Phi-4-mini-instruct', 'Microsoft'],
    ['mai-1-preview', 'Microsoft'],
    ['nvidia/NVIDIA-Nemotron-3-Nano-30B', 'NVIDIA'],
    ['nvidia/Llama-3.1-Nemotron-70B-Instruct', 'NVIDIA'],
    ['meta-llama/Llama-3.1-70B-Instruct', 'Meta'],
    ['route/Qwen3-Coder', '阿里云'],
    ['route/glm-5', '智谱'],
    ['route/kimi-k2', '月之暗面'],
    ['route/hunyuan-turbo', '腾讯'],
    ['route/step-3', '阶跃星辰'],
    ['mistral-large', 'Mistral'],
    ['deepseek-r1', 'DeepSeek'],
    ['gemini-pro', 'Google'],
    ['grok-4', 'xAI'],
    ['gpt-test', 'OpenAI'],
    ['claude-test', 'Anthropic'],
  ];
  for (const [id, maker] of examples) assert.equal(automaticManufacturer(model(id)), maker, id);
  assert.equal(automaticManufacturer(model('minimax-route/private-alias')), '');
  assert.equal(automaticManufacturer(model('proxy/minimax_M2.5')), 'MiniMax');
  assert.equal(automaticManufacturer(model('gpt-test', 'MiniMax M2')), '');
  assert.deepEqual(groupedModels([], { pinned: [], presets: [] }), []);
});

test(
  'settings manage groups while matrix keeps favorites, presets, identity and remembered expansion',
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ModelControlSettings} from './ui/settings/model-control-settings';
    import {ModelView} from './ui/features/model/view';
    window.render = state => {
      window.viewRoot ||= createRoot(document.getElementById('view-content'));
      window.viewRoot.render(<ModelView state={state} busy={false} reading={{}} action={async (data, action) => {
        if(action === 'apply') { window.applied = data; return; }
        const res = await fetch('/api/model-control/' + action, {method:'POST', body:JSON.stringify(data)});
        const next = await res.json(); window.render(next); return next;
      }}/>);
    };
    createRoot(document.getElementById('settings')).render(<ModelControlSettings live={true}/>);
  `,
        resolveDir: process.cwd(),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
    });
    let state = {
      revision: 1,
      preferences: {
        enabled: true,
        pinned: ['gpt-test'],
        modelOrder: ['gpt-test', 'route-a/claude-test', 'route-b/claude-test', 'custom'],
        presets: [
          {
            id: 'p',
            name: '旧预设',
            selection: { model: 'gpt-test', reasoning: 'high', speed: 'standard' },
          },
        ],
      },
      snapshot: {
        target: { id: 'fixture' },
        revision: 'host-v1',
        status: 'ready',
        message: '',
        current: { model: 'gpt-test', reasoning: 'high', speed: 'standard' },
        models: [
          model('gpt-test', 'GPT test'),
          model('route-a/claude-test', 'Claude test'),
          model('route-b/claude-test', 'Claude test'),
          model('custom', '私有别名'),
        ],
      },
    };
    const originalPresets = structuredClone(state.preferences.presets);
    let rejectNext = false,
      conflictNext = false,
      writes = 0;
    const errors = [];
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.route('http://127.0.0.1:48002/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith('/api/'))
          return route.fulfill({
            contentType: 'text/html',
            body: '<div id="settings"></div><hr><div id="view"><div id="view-content" class="feature-body"></div></div>',
          });
        if (route.request().method() === 'POST') {
          writes++;
          const body = route.request().postDataJSON();
          if (conflictNext) {
            conflictNext = false;
            state.revision++;
            return route.fulfill({ status: 409, json: { message: 'model_control_conflict' } });
          }
          if (rejectNext) {
            rejectNext = false;
            return route.fulfill({ status: 500, json: { message: '模拟保存失败' } });
          }
          if (path.endsWith('/preferences')) {
            assert.equal(body.revision, state.revision);
            Object.assign(state.preferences, body.patch);
            state.revision++;
          }
        }
        await route.fulfill({ json: state });
      });
      await page.goto('http://127.0.0.1:48002');
      const assetDir = 'target/web/assets';
      const css = readdirSync(assetDir)
        .filter((name) => /^(index|tokens)-.*\.css$/.test(name))
        .map((name) => readFileSync(`${assetDir}/${name}`, 'utf8'))
        .join('\n');
      await page.addStyleTag({
        content:
          css +
          '\n' +
          readFileSync('ui/features/model/styles.css', 'utf8') +
          '\nbody{padding:16px;}#settings,#view{max-width:740px;margin:20px auto;}#view{--fg:#222;--muted:#666;--accent:#999;--line:#ddd;--hover:#eee;--model-column-width:180px;--model-font-size:14px;}',
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate((state) => window.render(state), state);
      await page.locator('#model-organization summary').click();
      const settings = page.locator('#settings'),
        view = page.locator('#view');
      assert.equal(await view.locator('.model-row').count(), 1);
      assert.equal(await view.locator('[data-model-group]').count(), 0);
      await view.getByRole('button', { name: '所有', exact: true }).click();
      assert.equal(await view.locator('.model-tile').count(), 4);
      assert.equal(
        await view.locator('[data-model-tile="gpt-test"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(await view.locator('.model-route').count(), 2);
      await view.locator('[data-model-tile="route-b/claude-test"]').click();
      await view.getByRole('button', { name: '关闭所有模型' }).click();
      await view.locator('[data-model="route-b/claude-test"][data-reasoning="high"]').click();
      assert.equal(
        (await page.evaluate(() => window.applied)).selection.model,
        'route-b/claude-test',
      );
      await view.getByRole('button', { name: '所有', exact: true }).click();
      await view.locator('[data-model-tile="route-b/claude-test"]').click();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await settings.getByLabel('新模型分组名称').fill('编程');
      rejectNext = true;
      await settings.getByRole('button', { name: '新增分组' }).click();
      await settings.getByText(/模拟保存失败/).waitFor();
      assert.equal(await settings.getByLabel('新模型分组名称').inputValue(), '编程');
      await settings.getByRole('button', { name: '新增分组' }).click();
      await settings.getByRole('region', { name: '分组：编程' }).waitFor();
      const groupId = state.preferences.groups[0].id;
      const groupOrderBefore = await settings
        .locator('[aria-label^="分组："]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
      await settings.getByRole('button', { name: '下移分组 Anthropic', exact: true }).click();
      await page.waitForFunction(
        (before) =>
          JSON.stringify(
            [...document.querySelectorAll('#settings [aria-label^="分组："]')].map((node) =>
              node.getAttribute('aria-label'),
            ),
          ) !== JSON.stringify(before),
        groupOrderBefore,
      );
      await settings.getByRole('button', { name: '上移分组 Anthropic', exact: true }).click();
      await page.waitForFunction(
        (before) =>
          JSON.stringify(
            [...document.querySelectorAll('#settings [aria-label^="分组："]')].map((node) =>
              node.getAttribute('aria-label'),
            ),
          ) === JSON.stringify(before),
        groupOrderBefore,
      );
      await settings.getByLabel('选择 私有别名', { exact: true }).check();
      await settings.getByLabel('批量指定厂家').fill('私人厂家');
      await settings.getByRole('button', { name: '指定厂家', exact: true }).click();
      await settings.getByText('私人厂家 · 手动', { exact: true }).waitFor();
      await settings.getByLabel('批量移动分组').selectOption(groupId);
      await settings.getByRole('button', { name: '移动模型' }).click();
      await settings
        .getByRole('region', { name: '分组：编程' })
        .getByLabel('选择 私有别名')
        .waitFor();
      assert.deepEqual(state.preferences.modelOverrides.custom, {
        manufacturer: '私人厂家',
        groupId,
      });
      await settings.getByLabel('分组名称 编程', { exact: true }).fill('工作');
      conflictNext = true;
      await settings.getByRole('button', { name: '改名', exact: true }).click();
      await settings.getByText(/已在其他窗口更新/).waitFor();
      assert.equal(
        await settings.getByLabel('分组名称 编程', { exact: true }).inputValue(),
        '工作',
      );
      await settings.getByRole('button', { name: '改名', exact: true }).click();
      await settings.getByRole('region', { name: '分组：工作' }).waitFor();
      const beforeDelete = writes;
      await settings.getByRole('button', { name: '删除分组' }).click();
      await settings.getByRole('region', { name: '分组：私人厂家' }).waitFor();
      assert.equal(writes, beforeDelete + 1, 'deleting does not submit the rename form');
      assert.equal(state.preferences.modelOverrides.custom.groupId, undefined);
      await settings.getByRole('button', { name: '恢复自动分类' }).click();
      await settings
        .getByRole('region', { name: '分组：未分类' })
        .getByLabel('选择 私有别名')
        .waitFor();
      assert.deepEqual(state.preferences.presets, originalPresets);
      assert.deepEqual(state.preferences.pinned, ['gpt-test']);
      assert.deepEqual(state.preferences.modelOrder, [
        'gpt-test',
        'route-a/claude-test',
        'route-b/claude-test',
        'custom',
      ]);
      await page.evaluate((state) => window.render(state), state);
      await view.getByRole('button', { name: '所有', exact: true }).click();
      await view.locator('[data-model-group="vendor:Anthropic"]').waitFor();
      assert.equal(
        await view.locator('[data-model-group="vendor:Anthropic"] .model-tile').count(),
        2,
      );
      state.snapshot.models = state.snapshot.models.filter((m) => m.id !== 'custom');
      state.preferences.modelOverrides.custom = { manufacturer: '保留厂家' };
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await settings.getByText('保留厂家 · 手动 · 暂不可用').waitFor();
      state.snapshot.models.push(
        model('custom', '私有别名'),
        model('route-new/gemini-test', 'Gemini test'),
      );
      await settings.getByRole('button', { name: '刷新可用模型', exact: true }).click();
      await settings.getByRole('region', { name: '分组：Google' }).waitFor();
      await settings.getByText('保留厂家 · 手动', { exact: true }).waitFor();
      assert.equal(state.preferences.modelOverrides.custom.manufacturer, '保留厂家');

      mkdirSync('target/reports/model-groups', { recursive: true });
      await page.screenshot({
        path: 'target/reports/model-groups/settings-wide.png',
        fullPage: true,
      });
      await page.setViewportSize({ width: 360, height: 800 });
      await page.screenshot({
        path: 'target/reports/model-groups/settings-narrow.png',
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'narrow layout must not overflow',
      );
      await page.screenshot({
        path: 'target/reports/model-groups/settings-narrow.png',
        fullPage: true,
      });
      // Render the real component with a representative dense catalog, not a hand-drawn mockup.
      const favoriteLabels = [
        'GPT-6-Astra',
        'GPT-6.1-Sol',
        'Claude-opus-5-5-kiro',
        'Claude-opus-5-5',
        'Deepseek-V4.1-Flash · WorkBuddy',
      ];
      const catalogIds = [
        'claude-preview',
        'deepseek-preview',
        'gemini-preview',
        'gpt-preview',
        'grok-preview',
        'glm-preview',
        'kimi-preview',
        'hy3-preview',
        'step-preview',
        'minimax-preview',
        'private-preview',
      ];
      state.snapshot.models = [
        ...favoriteLabels.map((label, index) => model(`favorite-${index}`, label)),
        ...catalogIds.map((id) => model(`catalog/${id}`, id)),
      ].map((item) => ({ ...item, reasoning: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }));
      state.preferences.pinned = favoriteLabels.map((_, i) => `favorite-${i}`);
      state.preferences.modelColumnWidth = 245;
      state.preferences.modelOrder = state.snapshot.models.map((m) => m.id);
      state.preferences.modelOverrides = {};
      state.preferences.groups = [];
      state.preferences.expandedGroups = [];
      state.preferences.groupOrder = [];
      state.preferences.presets = [
        {
          id: 'design',
          name: 'sol',
          selection: { model: 'favorite-1', reasoning: 'high', speed: 'standard' },
        },
      ];
      state.snapshot.current = state.preferences.presets[0].selection;
      await page.setViewportSize({ width: 860, height: 960 });
      await page.addStyleTag({
        content:
          readFileSync('ui/surfaces/workspace/content.css', 'utf8') +
          '\n#settings{display:none}#view{height:auto;overflow:hidden;padding:0;border-radius:18px;--paper:#000;--ink:#eee;--fg:#eee;--muted:#999;--accent:#eee;--line:#222;--hover:#171717;font:14px -apple-system,sans-serif;}#view-content{padding:18px;}',
      });
      await view.evaluate((node) => {
        node.classList.add('feature-view');
        node.dataset.feature = 'model';
      });
      await page.evaluate((state) => window.render(state), state);
      const chooser = view.locator('.model-picker-toggle');
      if ((await chooser.getAttribute('aria-expanded')) === 'true') await chooser.click();
      await view.locator('[data-model-row="favorite-4"] .model-route').waitFor();
      await page.mouse.move(850, 950);
      assert.equal(await view.locator('.model-visibility, hr, .model-group-label').count(), 0);
      assert.equal(await view.locator('.model-matrix-head .model-fast').count(), 1);
      const line = await view.locator('.model-column-resize').boundingBox();
      const head = await view.locator('.model-matrix-head').boundingBox();
      assert.ok(line.y + line.height <= head.y + head.height + 1, 'resize grip ends in the header');
      await view.screenshot({ path: 'target/reports/model-groups/model-compact.png' });
      await chooser.click();
      const list = view.locator('.model-other-list');
      assert.ok(
        await list.evaluate((node) => node.scrollHeight > node.clientHeight),
        'dense catalogs scroll within the chooser',
      );
      assert.equal(await view.locator('.model-tile').count(), state.snapshot.models.length);
      assert.equal(await view.locator('.model-tile[aria-pressed="true"]').count(), 5);
      assert.equal(await view.locator('.model-tile svg').count(), 0);
      const colors = await view.locator('.model-tile').evaluateAll((nodes) =>
        nodes.map((n) => ({
          pressed: n.getAttribute('aria-pressed'),
          bg: getComputedStyle(n).backgroundColor,
          fg: getComputedStyle(n).color,
        })),
      );
      assert.notEqual(
        colors.find((n) => n.pressed === 'true').bg,
        colors.find((n) => n.pressed === 'false').bg,
      );
      assert.equal(
        colors.find((n) => n.pressed === 'true').fg,
        colors.find((n) => n.pressed === 'false').fg,
      );
      const refresh = await view
        .getByRole('button', { name: '刷新可用模型', exact: true })
        .boundingBox();
      const close = await view
        .getByRole('button', { name: '关闭所有模型', exact: true })
        .boundingBox();
      assert.ok(refresh.x + refresh.width <= close.x + 1 && Math.abs(refresh.y - close.y) < 1);
      await page.mouse.move(850, 950);
      await view.screenshot({ path: 'target/reports/model-groups/model-expanded.png' });

      await chooser.click();
      const fixedFrame = await view.boundingBox();
      await view.evaluate((node, height) => (node.style.height = `${height}px`), fixedFrame.height);
      const fixedButton = await chooser.boundingBox();
      const fixedFast = await view.locator('.model-fast').boundingBox();
      const separator = view.getByRole('separator', { name: '模型名称列宽' });
      const start = await separator.boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + 12);
      await page.mouse.down();
      await page.mouse.move(start.x - 180, start.y + 12, { steps: 12 });
      assert.equal(await separator.getAttribute('aria-valuenow'), '100');
      assert.deepEqual(
        await view.locator('.model-fast').boundingBox(),
        fixedFast,
        'Fast never follows column width',
      );
      const scroller = view.locator('.model-scroll');
      assert.ok(
        await scroller.evaluate((n) => n.scrollHeight > n.clientHeight),
        'wrapped names scroll inside the fixed table',
      );
      const narrowedButton = await chooser.boundingBox();
      assert.ok(
        Math.abs(narrowedButton.y - fixedButton.y) < 1,
        `chooser button stays visible while rows grow: ${JSON.stringify({ fixedButton, narrowedButton, geometry: await view.evaluate((n) => [...n.querySelectorAll('.feature-body,.feature-model,.model-scroll,.model-picker,.model-picker-toggle')].map((el) => ({ class: el.className, height: el.clientHeight, scroll: el.scrollHeight, flex: getComputedStyle(el).flex, y: el.getBoundingClientRect().y }))) })}`,
      );
      assert.deepEqual(
        await view.boundingBox(),
        fixedFrame,
        'column drag keeps the outer frame fixed',
      );
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          document.querySelector('.model-column-resize').getAttribute('aria-valuenow') === '100',
      );
      await scroller.evaluate((n) => (n.scrollTop = n.scrollHeight));
      const lastChoice = view.locator('[data-model="favorite-4"][data-reasoning="high"]');
      const lastBox = await lastChoice.boundingBox(),
        scrollBox = await scroller.boundingBox();
      assert.ok(
        lastBox.y >= scrollBox.y && lastBox.y + lastBox.height <= scrollBox.y + scrollBox.height,
        'last favorite remains reachable within the viewport',
      );
      await lastChoice.click();
      assert.equal((await page.evaluate(() => window.applied)).selection.model, 'favorite-4');
      await page.mouse.move(850, 950);
      await view.screenshot({ path: 'target/reports/model-groups/model-narrow-column.png' });
      await chooser.click();
      assert.equal(
        await chooser.getAttribute('aria-expanded'),
        'true',
        'compact chooser still opens after resizing',
      );
      await view.getByRole('button', { name: '关闭所有模型' }).click();
      state.preferences.presets = Array.from({ length: 24 }, (_, index) => ({
        id: `wrapping-${index}`,
        name: `收藏快捷组合 ${index + 1}`,
        selection: { ...state.snapshot.current },
      }));
      await page.evaluate((state) => window.render(state), state);
      await view
        .getByRole('button', { name: '收藏快捷组合 24', exact: true })
        .waitFor({ state: 'attached' });
      const wrapped = await view.locator('.model-presets').evaluate((node) => {
        const buttons = [...node.querySelectorAll('button')];
        return {
          rows: new Set(buttons.map((button) => button.offsetTop)).size,
          height: node.clientHeight,
          scroll: node.scrollHeight,
          rowHeight: buttons[0].getBoundingClientRect().height,
        };
      });
      assert.ok(wrapped.rows > 3 && wrapped.scroll > wrapped.height);
      assert.ok(
        wrapped.height <= wrapped.rowHeight * 3 + 9,
        'preset wrapping is capped at three rows',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
