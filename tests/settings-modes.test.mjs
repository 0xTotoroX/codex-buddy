/* [INPUT]: Built settings page, synthetic authenticated services and isolated Chromium.
 * [OUTPUT]: Shared drafts/DOM, no mode-only writes, retained details/scroll and responsive dual navigation.
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
  'settings modes retain drafts, details, custom preferences and reading without saving on switch',
  { timeout: 30000 },
  async () => {
    let settings = structuredClone(fixtureSettings),
      rejectNext = false;
    const writes = [];
    let appearance = {
      revision: 1,
      webRevision: 1,
      detached: false,
      alwaysOnTop: true,
      launcherAction: 'inside',
      position: null,
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
      connection: { status: 'connected', targets: [], endpoint: 'fixture', targetId: 'fixture' },
      desktop: { hasAnswer: false, headings: 0 },
      model: { provider: 'api', model: settings.model, available: true },
      panelPreferences: appearance,
      panelTheme: 'light',
      panelFontBase: 13,
    });
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
        } else if (path === '/api/features') value = features;
        else if (path === '/api/surfaces') {
          if (body?.op === 'save') {
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
        } else if (path === '/api/tasks/state') value = tasks;
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
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const simple = () => page.getByRole('button', { name: '简易', exact: true }).click();
    const detail = () => page.getByRole('button', { name: '详细设置', exact: true }).click();
    const category = (id) => page.getByLabel('详细设置分类').selectOption(id);
    try {
      await page.goto(origin + '/#token=fixture');
      await page.getByRole('switch', { name: '启用大纲', exact: true }).waitFor();
      assert.equal(
        await page.locator('.settings-app').getAttribute('data-settings-mode'),
        'simple',
      );
      assert.equal(await page.getByRole('navigation', { name: '设置分类' }).isVisible(), false);
      assert.equal(await page.getByRole('switch').count(), 4);
      assert.equal(await page.getByRole('button', { name: /^打开/ }).count(), 0);
      await page.waitForFunction(
        () =>
          !document.querySelector('#main-placement button').disabled &&
          [...document.querySelectorAll('[role=switch]')].every(
            (n) => n.getAttribute('aria-checked') === 'true',
          ),
      );
      await mkdir('target/reports', { recursive: true });
      await page.screenshot({ path: 'target/reports/settings-simple-default.png', fullPage: true });
      await detail();
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
      await page.getByText('更改模型', { exact: true }).click();
      const model = page.getByLabel('模型名称', { exact: true }),
        key = page.getByLabel('API 密钥', { exact: true });
      const modelNode = await model.elementHandle();
      await model.fill('未保存模型草稿');
      await key.fill('fixture-secret-draft');
      // Blur of model to key schedules a normal save; wait for it before exercising navigation-only edits.
      await page.waitForTimeout(250);
      writes.length = 0;
      await key.fill('fixture-unsaved-key');
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
      await category('features');
      await page.getByText('看板分组', { exact: true }).click();
      const group = page.getByLabel('分组名称：待办', { exact: true });
      await group.fill('未保存分组');
      await simple();
      await detail();
      assert.equal(await group.inputValue(), '未保存分组');
      assert.equal(await group.isVisible(), true);
      await category('model');
      const limits = page.locator('#settings-limits');
      await limits.locator('summary').click();
      await page.getByLabel('输入字符上限', { exact: true }).fill('18000');
      await simple();
      await detail();
      assert.equal(await limits.getAttribute('open'), '');
      assert.equal(await page.getByLabel('输入字符上限', { exact: true }).inputValue(), '18000');
      const before = writes.length;
      await simple();
      await detail();
      assert.equal(writes.length, before);
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
      await page.getByText('合成保存失败', { exact: true }).waitFor();
      await simple();
      await detail();
      assert.equal(await model.inputValue(), '失败后保留模型');
      await page.setViewportSize({ width: 1100, height: 850 });
      assert.equal(await page.getByLabel('详细设置分类').isVisible(), false);
      assert.equal(
        await page.getByRole('link', { name: '外观与布局', exact: true }).isVisible(),
        true,
      );
      await page.getByRole('link', { name: '外观与布局', exact: true }).click();
      await page.locator('#settings-fonts summary').click();
      await page.getByLabel('大纲字号（px）', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('大纲字号（px）', { exact: true }).inputValue(), '17');
      const font = page.getByLabel('大纲字号（px）', { exact: true });
      const beforeFont = writes.length;
      await font.fill('19.5');
      await simple();
      await detail();
      assert.equal(await font.inputValue(), '19.5');
      assert.equal(appearance.ui.fontSizes.outline, 17);
      assert.equal(writes.length, beforeFont, 'mode switch keeps unsaved font input');
      const theme = page.locator('#theme-sidebar');
      if (await theme.evaluate((n) => n.open)) await theme.locator('summary').click();
      await simple();
      await page.getByLabel('侧栏主题', { exact: true }).waitFor();
      await detail();
      assert.equal(
        await theme.evaluate((n) => n.open),
        false,
        'detailed theme disclosure restored',
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
      await page.getByRole('heading', { name: '模型与生成', exact: true, level: 1 }).waitFor();
      await page.getByLabel('请求超时（秒）', { exact: true }).waitFor();
      assert.equal(await limits.getAttribute('open'), '');
      assert.equal(settings.directionSource, fixtureSettings.directionSource);
      assert.equal(appearance.ui.fontSizes.outline, 17);
      assert.equal(tasks.store.syncEnabled, false);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
