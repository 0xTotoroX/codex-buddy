/* [INPUT]: Built settings page, synthetic authenticated services and isolated Chromium.
 * [OUTPUT]: Shared drafts/DOM, Codex/manual themes without writes, retained details/scroll and responsive navigation.
 * [POS]: No real user data, model requests or host restarts.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'settings modes retain drafts, drawers, custom preferences and reading without saving on switch',
  { timeout: 60000 },
  async () => {
    let settings = structuredClone(fixtureSettings),
      rejectNext = false,
      rejectSurface = false;
    const writes = [];
    let panelTheme = null;
    let connectionStatus = 'connected';
    const streams = new Set();
    const terminology = {
      entries: [
        {
          id: 'fixture-term',
          name: '合成术语',
          english: 'Fixture',
          definition: '合成释义',
          aliases: [],
          category: ['测试'],
          example: '',
          source: '',
        },
      ],
      preferences: {
        enabled: true,
        semantic: false,
        autoExpand: false,
        cardStyle: 'plain',
        mastered: [],
        favorites: [],
        revision: 1,
      },
    };
    let appearance = {
      revision: 1,
      webRevision: 1,
      detached: false,
      alwaysOnTop: true,
      launcherAction: 'inside',
      position: null,
      typography: { mode: 'custom', source: 'body', scale: 100, customSize: 17 },
      ui: {
        width: 500,
        height: 620,
        dockWidth: 340,
        layoutMode: 'workbench',
        open: true,
        dockOpen: true,
        splitRatio: 0.45,
        fontOffset: 0,
        fontSizes: { outline: 17, next: 16, board: 15, model: 14 },
        labelOnly: false,
        promptClickMode: 'fill',
        viewOrder: ['next', 'outline'],
      },
    };
    let surfaces = {
      revision: 1,
      preferences: {
        themes: Object.fromEntries(
          ['sidebar', 'overlay', 'desktop', 'edge'].map((p) => [
            p,
            { theme: 'frosted', liquidVariant: 'regular' },
          ]),
        ),
        edge: { edge: 'right', screen: '', position: 0.5, keepOpen: false },
      },
    };
    const features = {
      mainPlacement: 'sidebar',
      features: ['outline', 'next', 'board', 'model'].map((id) => ({
        id,
        open: true,
        placement: id === 'model' ? 'edge' : 'sidebar',
        owner: id,
        pending: null,
      })),
      layouts: {},
    };
    const tasks = {
      status: '本地看板',
      store: {
        schema: 2,
        revision: 1,
        boardEnabled: true,
        syncEnabled: false,
        bindings: { calendarId: '' },
        columns: [
          { id: 'todo', title: '待办' },
          { id: 'doing', title: '进行中' },
          { id: 'done', title: '完成' },
        ],
        tasks: [],
        inflight: null,
      },
    };
    const view = () => ({
      version: 'fixture',
      configurationRevision: settings.configurationRevision,
      connection: {
        status: connectionStatus,
        targets: [],
        endpoint: 'fixture',
        targetId: 'fixture',
      },
      desktop: { hasAnswer: false, headings: 0 },
      model: { provider: 'api', model: settings.model, available: true },
      panelPreferences: appearance,
      panelTheme,
      panelFontBase: 13,
    });
    const publishTheme = (theme, status = 'connected') => {
      panelTheme = theme;
      connectionStatus = status;
      for (const stream of streams) stream.write('data: ' + JSON.stringify(view()) + '\n\n');
    };
    const server = createServer(async (req, res) => {
      const path = req.url.split('?')[0];
      if (path.startsWith('/api/')) {
        if (req.headers.authorization !== 'Bearer fixture') {
          res
            .writeHead(401, { 'Content-Type': 'application/json' })
            .end('{"message":"unauthorized"}');
          return;
        }
        if (path === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: ' + JSON.stringify(view()) + '\n\n');
          streams.add(res);
          res.on('close', () => streams.delete(res));
          return;
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : null;
        if (body && body.op !== 'state') writes.push({ path, body });
        let value;
        if (path === '/api/settings') {
          if (body) {
            if (rejectNext) {
              rejectNext = false;
              res
                .writeHead(409, { 'Content-Type': 'application/json' })
                .end('{"message":"合成保存失败"}');
              return;
            }
            settings = {
              ...settings,
              ...body,
              configurationRevision: settings.configurationRevision + 1,
            };
          }
          value = settings;
        } else if (path === '/api/features') {
          if (body?.op === 'main-placement') {
            features.mainPlacement = body.placement;
            for (const entry of features.features)
              if (entry.placement !== 'edge') entry.placement = body.placement;
          }
          if (body?.op === 'main-layout') features.layouts[body.placement] = body.layout;
          value = features;
        } else if (path === '/api/surfaces') {
          if (body?.op === 'save') {
            if (rejectSurface) {
              rejectSurface = false;
              res
                .writeHead(409, { 'Content-Type': 'application/json' })
                .end('{"message":"合成材质保存失败"}');
              return;
            }
            surfaces = {
              ...surfaces,
              revision: surfaces.revision + 1,
              preferences: {
                ...surfaces.preferences,
                themes: { ...surfaces.preferences.themes, [body.placement]: body.theme },
              },
            };
          }
          value = surfaces;
        } else if (path === '/api/surfaces/displays')
          value = { screens: [], nativeGlassAvailable: true };
        else if (path === '/api/appearance') {
          if (body)
            appearance = {
              ...appearance,
              ...body,
              ui: { ...appearance.ui, ...body.ui },
              revision: appearance.revision + 1,
            };
          value = appearance;
        } else if (path === '/api/terminology') {
          if (body?.action === 'master') terminology.preferences.mastered = [body.id];
          if (body?.action === 'restore') terminology.preferences.mastered = [];
          value = terminology;
        } else if (path === '/api/tasks/state') value = tasks;
        else if (path === '/api/dev/sources')
          value = {
            active: '/fixture/main',
            loaded: true,
            connected: true,
            resource: 'fixture',
            sources: [
              { path: '/fixture/main', branch: 'main', commit: '1234567', dirty: false },
              {
                path: '/fixture/a-long-worktree-path-for-menu-width-and-wrapping-checks',
                branch: 'codex/long-source-name',
                commit: '7654321',
                dirty: false,
              },
            ],
          };
        else if (path === '/api/model-control/state') value = { preferences: { enabled: true } };
        else value = { ok: true };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
        return;
      }
      try {
        const data = await readFile(
          join(process.cwd(), 'target/web', path === '/' ? 'index.html' : path),
        );
        res
          .writeHead(200, {
            'Content-Type': path.endsWith('.js')
              ? 'text/javascript'
              : path.endsWith('.css')
                ? 'text/css'
                : path.endsWith('.png')
                  ? 'image/png'
                  : 'text/html',
          })
          .end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 420, height: 800 },
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const simple = () => page.getByRole('button', { name: '简易', exact: true }).click();
    const detail = () => page.getByRole('button', { name: '详细设置', exact: true }).click();
    const category = async (id) => {
      const group = [
        'features',
        'next',
        'prompts',
        'terminology',
        'board',
        'model-control',
      ].includes(id)
        ? '功能'
        : id === 'model'
          ? '生成'
          : ['surfaces', 'appearance'].includes(id)
            ? '界面'
            : '系统';
      const link = page.locator(`.settings-nav a[href="#settings-${id}"]`);
      await link.waitFor({ state: 'attached' });
      if (!(await link.isVisible()))
        await page.getByRole('button', { name: group, exact: true }).click();
      await link.click();
    };
    const themeButton = (name) =>
      page
        .locator('.settings-theme-menu')
        .getByRole('button', { name, exact: true, includeHidden: true });
    const chooseTheme = async (name, target = page) => {
      await target.locator('.settings-theme-trigger').click();
      await target
        .getByRole('group', { name: '设置页主题' })
        .getByRole('button', { name, exact: true })
        .click();
    };
    const expectTheme = async (theme) => {
      await page.waitForFunction(
        (expected) =>
          document.documentElement.dataset.settingsTheme === expected &&
          getComputedStyle(document.documentElement).colorScheme === expected &&
          getComputedStyle(document.documentElement).backgroundColor ===
            (expected === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)'),
        theme,
      );
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
        theme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)',
      );
      assert.equal(
        await page.locator('.settings-brand img').evaluate((n) => getComputedStyle(n).filter),
        'none',
        'the original brand icon stays unchanged in both themes',
      );
    };
    try {
      await page.goto(origin + '/#token=fixture');
      await page.getByRole('switch', { name: '启用大纲', exact: true }).waitFor();
      assert.equal(await themeButton('跟随 Codex').getAttribute('aria-pressed'), 'true');
      await expectTheme('dark'); // Before Codex is known, the browser supplies the fallback.
      await page.emulateMedia({ colorScheme: 'light' });
      await expectTheme('light');
      publishTheme('dark');
      await expectTheme('dark'); // The host wins even when the browser prefers light.
      publishTheme(null, 'unresponsive');
      await page.getByText('页面暂未响应', { exact: true }).waitFor();
      await expectTheme('dark'); // A missing host theme retains the last valid snapshot.
      publishTheme('light');
      await expectTheme('light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectTheme('light');
      assert.equal(writes.length, 0, 'theme subscription never writes business preferences');
      // Exercise the styled native picker through actual keyboard/pointer input, not selectOption.
      const generation = page.getByLabel('建议生成方式', { exact: true });
      await generation.click();
      await page.locator('#generation-mode:open').waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await generation.inputValue(), 'manual', 'Escape cancels the pending choice');
      assert.equal(writes.length, 0, 'opening and dismissing a menu never saves');
      await generation.press('Space');
      await page.locator('#generation-mode:open').waitFor();
      await page.keyboard.press('End');
      const menuSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'POST',
      );
      await page.keyboard.press('Enter');
      await (await menuSave).finished();
      assert.equal(
        settings.generationMode,
        'auto',
        'keyboard selection uses the original save queue',
      );
      await generation.click();
      const restoreSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'POST',
      );
      await page.getByRole('option', { name: '手动刷新', exact: true }).click();
      await (await restoreSave).finished();
      assert.equal(settings.generationMode, 'manual', 'pointer selection uses the same queue');
      writes.length = 0;
      assert.equal(
        await page.locator('.settings-app').getAttribute('data-settings-mode'),
        'simple',
      );
      assert.equal(await page.getByRole('navigation', { name: '设置分类' }).isVisible(), false);
      assert.equal(await page.getByRole('switch').count(), 5);
      assert.equal(await page.getByRole('button', { name: /^打开/ }).count(), 0);
      await page.waitForFunction(
        () =>
          !document.querySelector('#main-placement button').disabled &&
          [...document.querySelectorAll('[role=switch]')]
            .filter((n) => n.checkVisibility())
            .every((n) => n.getAttribute('aria-checked') === 'true'),
      );
      await mkdir('target/reports', { recursive: true });
      await page.screenshot({ path: 'target/reports/settings-simple-default.png', fullPage: true });
      await detail();
      assert.equal(
        await page
          .getByRole('button', { name: /^打开(大纲|下一步|看板|模型快切|术语模块)$/ })
          .count(),
        0,
        'feature switches do not have duplicate open actions',
      );
      writes.length = 0;
      await simple();
      await page.goBack();
      await page.waitForFunction(
        () =>
          document.querySelector('.settings-app').getAttribute('data-settings-mode') === 'detail',
      );
      await page.goBack();
      await page.waitForFunction(
        () =>
          document.querySelector('.settings-app').getAttribute('data-settings-mode') === 'simple',
      );
      assert.equal(
        await page.getByLabel('模型名称', { exact: true }).isVisible(),
        true,
        'model configuration is visible without a disclosure',
      );
      const model = page.getByLabel('模型名称', { exact: true }),
        key = page.getByLabel('API 密钥', { exact: true });
      const modelNode = await model.elementHandle();
      const firstSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'POST',
      );
      await model.fill('未保存模型草稿');
      await key.fill('fixture-secret-draft');
      // Blur of model to key schedules a normal save; wait for it before exercising navigation-only edits.
      await (await firstSave).finished();
      await page.locator('.settings-save[data-save-state="dirty"]').waitFor({ state: 'attached' });
      writes.length = 0;
      await key.fill('fixture-unsaved-key');
      await chooseTheme('深色');
      await expectTheme('dark');
      publishTheme('light');
      await expectTheme('dark');
      await chooseTheme('浅色');
      await expectTheme('light');
      await chooseTheme('跟随 Codex');
      assert.equal(await key.inputValue(), 'fixture-unsaved-key');
      assert.equal(await model.evaluate((n, original) => n === original, modelNode), true);
      assert.equal(writes.length, 0, 'theme buttons preserve focused drafts without auto-saving');
      await detail();
      await category('model');
      assert.equal(await model.inputValue(), '未保存模型草稿');
      assert.equal(await key.inputValue(), 'fixture-unsaved-key');
      assert.equal(await model.evaluate((n, original) => n === original, modelNode), true);
      await simple();
      assert.equal(await model.isVisible(), true);
      assert.equal(await key.inputValue(), 'fixture-unsaved-key');
      assert.equal(writes.length, 0, 'mode/category changes do not save typed drafts');
      await detail();
      const splitWrites = writes.length;
      for (const id of [
        'features',
        'next',
        'prompts',
        'board',
        'model-control',
        'surfaces',
        'appearance',
        'connection',
        'codex-host',
      ]) {
        await category(id);
        assert.equal(await model.isVisible(), false, `${id} does not include model configuration`);
        assert.equal(await model.inputValue(), '未保存模型草稿');
        assert.equal(await key.inputValue(), 'fixture-unsaved-key');
        assert.equal(await model.evaluate((n, original) => n === original, modelNode), true);
        assert.equal(await page.getByLabel('搜索术语', { exact: true }).isVisible(), false);
        if (['next', 'prompts', 'board', 'model-control'].includes(id))
          assert.equal(await page.locator('.preview-scene[data-active="true"]').count(), 1);
        if (id === 'features') {
          assert.equal(await page.getByRole('switch').count(), 5);
          assert.equal(
            await page.getByRole('button', { name: '模型分组', exact: true }).isVisible(),
            false,
          );
        }
        if (id === 'surfaces')
          assert.equal(await page.getByLabel('侧栏主题', { exact: true }).isVisible(), false);
        if (id === 'appearance')
          assert.equal(await page.getByLabel('主界面布局', { exact: true }).isVisible(), false);
      }
      assert.equal(
        writes.length,
        splitWrites,
        'all subpage navigation preserves unsaved fields without writes',
      );
      // A not-yet-loaded library remains searchable and opens its own page and drawer.
      const splitSearch = page.getByRole('searchbox', { name: '搜索设置' });
      await splitSearch.fill('词库管理');
      await splitSearch.press('Enter');
      await page.getByRole('dialog', { name: '词库管理', exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, '#settings-terminology/settings-library');
      await page.getByRole('button', { name: '关闭词库管理', exact: true }).click();
      await page.getByLabel('搜索术语', { exact: true }).waitFor();
      assert.equal(
        await page.getByText('结合问答核对词义与识别概念', { exact: true }).isVisible(),
        true,
      );
      await page.getByRole('button', { name: '已掌握：合成术语', exact: true }).click();
      await page.getByRole('button', { name: '恢复提示：合成术语', exact: true }).click();
      await page.getByRole('button', { name: '已掌握：合成术语', exact: true }).waitFor();
      assert.deepEqual(terminology.preferences.mastered, []);
      await category('board');
      assert.equal(await page.getByLabel('分组名称：待办', { exact: true }).isVisible(), true);
      const group = page.getByLabel('分组名称：待办', { exact: true });
      await group.fill('未保存分组');
      await simple();
      await detail();
      assert.equal(await group.inputValue(), '未保存分组');
      assert.equal(await group.isVisible(), true);
      await category('model');
      // 前面的普通失焦允许保存；先完成它，再单独验证模式切换不保存新的限额草稿。
      await page.locator('.settings-save[data-save-state="saving"]').waitFor({ state: 'detached' });
      if (await page.locator('.settings-save[data-save-state="dirty"]').count())
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await page.locator('.settings-save[data-save-state="saved"]').waitFor({ state: 'attached' });
      const limits = page.locator('#settings-limits');
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      await page.getByLabel('输入字符上限', { exact: true }).fill('18000');
      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      await simple();
      await detail();
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      assert.equal(await limits.locator('dialog').getAttribute('open'), '');
      assert.equal(await page.getByLabel('输入字符上限', { exact: true }).inputValue(), '18000');
      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      const before = writes.length;
      await simple();
      await detail();
      assert.equal(
        writes.length,
        before,
        JSON.stringify(
          writes.map(({ path, body }) => ({
            path,
            keys: Object.keys(body),
            maxInputChars: body.maxInputChars,
          })),
        ),
      );
      await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
      const scroll = await page.evaluate(() => scrollY);
      assert.ok(scroll > 100);
      await simple();
      await detail();
      assert.ok(
        Math.abs((await page.evaluate(() => scrollY)) - scroll) < 3,
        `detail reading position restored: before=${scroll}, after=${await page.evaluate(() => scrollY)}`,
      );
      rejectNext = true;
      await model.fill('失败后保留模型');
      await page.getByRole('heading', { name: '生成模型', exact: true, level: 2 }).click();
      await page.locator('.settings-feedback').filter({ hasText: '合成保存失败' }).waitFor();
      await simple();
      await detail();
      assert.equal(await model.inputValue(), '失败后保留模型');
      await page.setViewportSize({ width: 1100, height: 850 });
      assert.equal(await page.getByLabel('详细设置分类').isVisible(), false);
      assert.equal(
        await page.getByRole('link', { name: '布局与位置', exact: true }).isVisible(),
        true,
      );
      await page.getByRole('link', { name: '布局与位置', exact: true }).click();
      for (const label of ['侧栏宽度（px）', '大纲默认位置', '贴边屏幕'])
        assert.equal(
          await page.getByLabel(label, { exact: true }).isVisible(),
          true,
          `${label} is directly visible`,
        );
      await category('appearance');
      await page.getByLabel('自定义字号（px）', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('自定义字号（px）', { exact: true }).inputValue(), '17');
      const font = page.getByLabel('自定义字号（px）', { exact: true });
      const beforeFont = writes.length;
      await font.fill('19.5');
      await simple();
      await detail();
      assert.equal(await font.inputValue(), '19.5');
      assert.equal(appearance.typography.customSize, 17);
      assert.equal(appearance.ui.fontSizes.outline, 17);
      assert.equal(writes.length, beforeFont, 'mode switch keeps unsaved font input');
      const theme = page.locator('#theme-sidebar');
      assert.equal(await theme.locator('summary').count(), 0);
      await simple();
      await page.getByLabel('侧栏主题', { exact: true }).waitFor();
      await detail();
      assert.equal(
        await page.getByLabel('侧栏主题', { exact: true }).isVisible(),
        true,
        'theme controls stay visible after mode changes',
      );

      await page.setViewportSize({ width: 360, height: 800 });
      await simple();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'settings controls fit the narrow viewport',
      );
      await mkdir('target/reports', { recursive: true });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({
        path: 'target/reports/settings-simple-live-layout.png',
        fullPage: true,
      });
      await detail();
      await category('surfaces');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'settings controls fit the narrow viewport',
      );
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({
        path: 'target/reports/settings-detail-live-layout.png',
        fullPage: true,
      });
      const count = writes.length;
      await simple();
      await page.reload();
      await page.getByRole('switch', { name: '启用大纲', exact: true }).waitFor();
      assert.equal(
        await page.locator('.settings-app').getAttribute('data-settings-mode'),
        'simple',
      );
      assert.equal(writes.length, count);
      await page.goto(origin + '/#settings-limits/timeout');
      await page.getByRole('heading', { name: '生成模型', exact: true, level: 1 }).waitFor();
      await page.getByLabel('请求超时（秒）', { exact: true }).waitFor();
      assert.equal(await limits.locator('dialog').getAttribute('open'), '');
      assert.equal(settings.directionSource, fixtureSettings.directionSource);
      assert.equal(appearance.ui.fontSizes.outline, 17);
      assert.equal(tasks.store.syncEnabled, false);

      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      // Previews consume existing saved snapshots; rejected saves never look successful.
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.getByRole('link', { name: '布局与位置', exact: true }).click();
      const preview = page.getByRole('complementary', { name: '联动预览' });
      await preview.locator('[data-ready="true"]').waitFor();
      assert.equal(
        await preview.locator('.preview-workspace').getAttribute('data-material'),
        'frosted',
      );
      rejectSurface = true;
      await category('appearance');
      await page.getByLabel('侧栏主题', { exact: true }).selectOption('black');
      await page.getByText('合成材质保存失败', { exact: false }).waitFor();
      assert.equal(
        await preview.locator('.preview-workspace').getAttribute('data-material'),
        'frosted',
      );
      await category('appearance');
      await page.getByLabel('侧栏主题', { exact: true }).selectOption('black');
      await preview.locator('.preview-workspace[data-material="black"]').waitFor();
      await category('surfaces');
      await page.getByLabel('主界面布局', { exact: true }).selectOption('horizontal');
      await preview.locator('.preview-split[data-axis="horizontal"]').waitFor();
      assert.equal(
        await preview.locator('.preview-pane').count(),
        3,
        'only opened main features appear',
      );
      await category('surfaces');
      await page.getByRole('button', { name: '页面浮层', exact: true }).click();
      await preview.locator('.preview-host[data-placement="overlay"]').waitFor();
      assert.equal(
        await preview.locator('.preview-workspace').getAttribute('data-material'),
        'frosted',
        'each placement keeps its own material',
      );
      const previewWrites = writes.length;
      await preview.getByRole('button', { name: '贴边 / 刘海', exact: true }).click();
      await preview.locator('.preview-host[data-placement="edge"]').waitFor();
      await preview.getByRole('button', { name: '主界面', exact: true }).click();
      assert.equal(writes.length, previewWrites, 'preview navigation never moves real features');

      features.layouts.overlay = {
        axis: 'vertical',
        groups: [
          { ids: ['outline'], active: 'outline', weight: 1 },
          {
            axis: 'horizontal',
            weight: 2,
            groups: [
              { ids: ['board'], active: 'board', weight: 1 },
              { ids: ['next'], active: 'next', weight: 2 },
            ],
          },
        ],
      };
      await preview
        .locator('.preview-split[data-axis="vertical"] .preview-split[data-axis="horizontal"]')
        .waitFor();
      assert.equal(
        await preview.locator('.preview-pane').count(),
        3,
        'nested layout comes from the saved tree',
      );
      features.features.find((entry) => entry.id === 'board').open = false;
      await page.waitForFunction(() => document.querySelectorAll('.preview-pane').length === 2);
      assert.equal(await preview.getByRole('button', { name: '看板', exact: true }).count(), 0);

      await page.getByRole('link', { name: '常用开关', exact: true }).click();
      const demoWrites = writes.length;
      await preview.getByRole('button', { name: /完善实现方案/ }).click();
      assert.equal(await preview.getByRole('status').textContent(), '完善实现方案');
      assert.equal(writes.length, demoWrites, 'sample interactions do not write or send');
      await page.getByRole('link', { name: '生成模型', exact: true }).click();
      await model.fill('新的预览模型草稿');
      await preview.getByText('新的预览模型草稿', { exact: true }).waitFor();
      assert.ok((await preview.textContent()).includes('未全部保存'));
      const draftWrites = writes.length;
      await simple();
      await preview.getByRole('button', { name: '贴边 / 刘海', exact: true }).click();
      assert.equal(writes.length, draftWrites);
      await detail();
      assert.equal(await model.inputValue(), '新的预览模型草稿');
      assert.equal((await preview.textContent()).includes('fixture-unsaved-key'), false);

      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({
          colorScheme: colorScheme === 'light' ? 'dark' : 'light',
          reducedMotion: 'reduce',
        });
        await chooseTheme(colorScheme === 'light' ? '浅色' : '深色');
        await expectTheme(colorScheme);
        // Chromium applies a changed media preference on its next rendering update.
        await page.waitForFunction(
          (expected) => getComputedStyle(document.documentElement).backgroundColor === expected,
          colorScheme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)',
          { timeout: 3000 },
        );
        assert.equal(
          await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
          colorScheme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(25, 25, 27)',
          'production CSS chunk ordering must not overwrite the approved settings palette',
        );
        for (const width of [360, 600, 900, 1360]) {
          await page.setViewportSize({ width, height: 900 });
          const header = await page.locator('.settings-header').evaluate((node) => {
            const rect = (selector) => node.querySelector(selector).getBoundingClientRect();
            const search = rect('.settings-search'),
              brand = rect('.settings-brand'),
              actions = rect('.settings-header-actions');
            return {
              search: search.toJSON(),
              brand: brand.toJSON(),
              actions: actions.toJSON(),
              header: node.getBoundingClientRect().toJSON(),
            };
          });
          if (width > 1100) {
            assert.ok(
              Math.abs(
                header.search.y +
                  header.search.height / 2 -
                  (header.brand.y + header.brand.height / 2),
              ) < 2,
              'wide search shares the brand row',
            );
            assert.ok(
              header.search.x >= header.brand.right && header.search.right <= header.actions.x,
            );
          } else {
            assert.ok(
              Math.abs(header.search.x - header.header.x) < 1 &&
                Math.abs(header.search.right - header.header.right) < 1,
              'wrapped search has equal left/right edges',
            );
          }
          assert.ok(header.actions.right <= header.header.right + 1, 'header controls fit');
          publishTheme(colorScheme, 'unresponsive');
          await page.getByText('页面暂未响应', { exact: true }).waitFor();
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            'connection status text fits the narrow header',
          );
          publishTheme(colorScheme);
          await page.getByRole('status', { name: '已连接', exact: true }).waitFor();

          for (const id of ['surfaces', 'features', 'model', 'connection']) {
            if (width <= 760) await category(id);
            else
              await page
                .getByRole('link', {
                  name: {
                    surfaces: '布局与位置',
                    features: '常用开关',
                    model: '生成模型',
                    connection: '启动与连接',
                  }[id],
                  exact: true,
                })
                .click();
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
              `${colorScheme} ${width} ${id} fits`,
            );
          }
          if (width <= 760) await category('surfaces');
          else await page.getByRole('link', { name: '布局与位置', exact: true }).click();
          await page.screenshot({
            path: `target/reports/settings-tom-${colorScheme}-${width}.png`,
            fullPage: true,
          });
          await page.getByLabel('主界面布局', { exact: true }).click();
          await page.locator('#main-layout:open').waitFor();
          const menuGeometry = await page.locator('#main-layout option').evaluateAll((options) =>
            options.map((option) => {
              const box = option.getBoundingClientRect();
              return {
                x: box.x,
                right: box.right,
                bottom: box.bottom,
                top: box.top,
                viewport: innerWidth,
                height: innerHeight,
              };
            }),
          );
          assert.ok(
            menuGeometry.every(
              (box) =>
                box.x >= 0 && box.right <= box.viewport && box.top >= 0 && box.bottom <= box.height,
            ),
            'menu stays inside the viewport',
          );
          await page.screenshot({
            path: `target/reports/settings-menu-${colorScheme}-${width}.png`,
          });
          await page.keyboard.press('Escape');
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelector('.settings-content').getAnimations({ subtree: true }).length,
            ),
            0,
            'reduced motion has no active animations',
          );
        }
      }
      const themeWrites = writes.length;
      const peer = await context.newPage();
      await peer.goto(origin);
      await peer.locator('html[data-settings-theme="dark"]').waitFor();
      await chooseTheme('浅色', peer);
      await expectTheme('light');
      assert.equal(
        await model.inputValue(),
        '新的预览模型草稿',
        'other tabs do not replace form drafts',
      );
      await page.reload();
      await themeButton('浅色').waitFor({ state: 'attached' });
      assert.equal(await themeButton('浅色').getAttribute('aria-pressed'), 'true');
      await expectTheme('light');
      await peer.evaluate(() => localStorage.setItem('codex-buddy-settings-theme', 'unknown'));
      await page.waitForFunction(
        () => document.documentElement.dataset.settingsThemeMode === 'codex',
      );
      publishTheme('dark');
      await expectTheme('dark');
      await peer.evaluate(() => localStorage.removeItem('codex-buddy-settings-theme'));
      await chooseTheme('跟随 Codex');
      await peer.close();
      assert.equal(
        writes.length,
        themeWrites,
        'theme persistence and cross-tab changes never submit configuration',
      );
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: '桌面窗口', exact: true }).click();
      await preview.locator('.preview-host[data-placement="desktop"]').waitFor();
      assert.ok(
        await preview.locator('.preview-workspace').evaluate((n) => n.getAnimations().length > 0),
        'placement changes animate only the illustration',
      );
      const beforeMotion = writes.length;
      await page.getByRole('link', { name: '生成模型', exact: true }).click();
      const drawer = limits.locator('dialog.settings-drawer');
      const entryHeight = await limits.evaluate((n) => n.getBoundingClientRect().height);
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      await drawer.evaluate(async (n) => {
        await Promise.allSettled(n.getAnimations().map((a) => a.finished));
      });
      assert.equal(
        await limits.evaluate((n) => n.getBoundingClientRect().height),
        entryHeight,
        'drawer does not reflow the main page',
      );
      const bounds = await drawer.boundingBox();
      assert.ok(Math.abs(bounds.x + bounds.width - page.viewportSize().width) < 2);
      assert.ok(bounds.width <= 720);
      await page.keyboard.press('Escape');
      assert.equal(await drawer.evaluate((n) => n.open), false);
      assert.equal(
        await drawer.evaluate((n) => getComputedStyle(n).transitionDuration),
        '0s',
        'keyboard closing is immediate',
      );
      const nav = page.getByRole('link', { name: '布局与位置', exact: true });
      await nav.press('Enter');
      assert.equal(
        await page.locator('.settings-content').evaluate((n) => n.getAnimations().length),
        0,
        'keyboard navigation has no entry animation',
      );
      await page.getByRole('link', { name: '生成模型', exact: true }).click();
      await page.getByRole('button', { name: '高级设置', exact: true }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await drawer.evaluate((n) => getComputedStyle(n).transitionDuration), '0s');
      assert.equal(await drawer.evaluate((n) => n.getAnimations().length), 0);
      await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
      assert.equal(
        writes.length,
        beforeMotion,
        'drawer motion and navigation never save configuration',
      );
      await category('connection');
      await page.addScriptTag({ content: await readFile('ui/settings/dev-sources.js', 'utf8') });
      await category('dev');
      await page.getByText('开发来源 · main · 1234567', { exact: true }).waitFor();
      const source = page.getByLabel('调试 worktree', { exact: true });
      const sourceWrites = writes.length;
      for (const mode of ['浅色', '深色']) {
        await chooseTheme(mode);
        await page.setViewportSize({ width: 360, height: 900 });
        await source.click();
        await page.locator('#buddy-dev-sources select:open').waitFor();
        assert.equal(await source.evaluate((n) => getComputedStyle(n).appearance), 'base-select');
        const bounds = await page.locator('#buddy-dev-sources option').evaluateAll((nodes) =>
          nodes.map((node) => ({
            left: node.getBoundingClientRect().left,
            right: node.getBoundingClientRect().right,
            width: innerWidth,
          })),
        );
        assert.ok(
          bounds.every((box) => box.left >= 0 && box.right <= box.width),
          'long Dev source labels remain inside a narrow viewport',
        );
        await page.keyboard.press('Escape');
      }
      assert.equal(writes.length, sourceWrites, 'previewing Dev menus never switches sources');
      const restricted = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await restricted.addInitScript(() => {
        const get = Storage.prototype.getItem,
          set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key === 'codex-buddy-settings-theme')
            throw new DOMException('Storage unavailable', 'SecurityError');
          return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === 'codex-buddy-settings-theme')
            throw new DOMException('Storage unavailable', 'SecurityError');
          return set.call(this, key, value);
        };
      });
      const restrictedPage = await restricted.newPage();
      restrictedPage.on('pageerror', (e) => errors.push(e.message));
      await restrictedPage.goto(origin + '/#token=fixture');
      await chooseTheme('浅色', restrictedPage);
      await restrictedPage.locator('html[data-settings-theme="light"]').waitFor();
      await restricted.close();
      await detail();
      await category('model');
      const headerWrites = writes.length;
      await page.locator('.settings-theme-trigger').click();
      await page.keyboard.press('End');
      assert.equal(await themeButton('深色').evaluate((n) => n === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(
        await page.locator('.settings-theme-trigger').getAttribute('aria-expanded'),
        'false',
      );
      assert.equal(
        await page.locator('.settings-theme-trigger').evaluate((n) => n === document.activeElement),
        true,
      );
      await page.keyboard.press('Control+k');
      assert.equal(
        await page
          .getByRole('searchbox', { name: '搜索设置' })
          .evaluate((n) => n === document.activeElement),
        true,
      );
      for (const color of ['浅色', '深色']) {
        await chooseTheme(color);
        for (const width of [390, 680, 760, 761, 1100, 1440]) {
          await page.setViewportSize({ width, height: 850 });
          await page.evaluate(() => scrollTo(0, 0));
          await page.locator('.settings-theme-trigger').click();
          const box = await page.locator('.settings-theme-menu').boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width);
          await page.keyboard.press('Escape');
          const links = await page.locator('.settings-category-links a').evaluateAll((nodes) =>
            nodes.map((n) => ({
              width: n.clientWidth,
              content: n.scrollWidth,
              visible: !!n.getBoundingClientRect().height,
            })),
          );
          assert.equal(links.length, 12);
          assert.ok(links.filter((n) => n.visible).every((n) => n.width >= n.content));
          assert.equal(links.filter((n) => n.visible).length, width <= 760 ? 1 : 12);
          assert.equal(await page.locator('.settings-nav summary').count(), 0);
          const layout = await page.evaluate(() => {
            const nav = document.querySelector('.settings-nav').getBoundingClientRect();
            const content = document.querySelector('.settings-content').getBoundingClientRect();
            return {
              navRight: nav.right,
              navBottom: nav.bottom,
              contentLeft: content.left,
              contentTop: content.top,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.equal(layout.overflow, false, `no horizontal overflow at ${width}px`);
          if (width <= 760)
            assert.ok(layout.navBottom <= layout.contentTop, 'narrow navigation precedes content');
          else
            assert.ok(layout.navRight < layout.contentLeft, 'wide navigation sits left of content');
          await page.screenshot({
            path: `target/reports/settings-header-${color === '浅色' ? 'light' : 'dark'}-${width}.png`,
          });
        }
      }
      assert.equal(
        writes.length,
        headerWrites,
        'header navigation and keyboard theme selection never save',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
