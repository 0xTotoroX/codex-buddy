/*
 * [INPUT]: 实际 React PanelSettings 与隔离浏览器中的合成外观 API。
 * [OUTPUT]: 内容/容器设置逐字段保存，保留旧布局、材质和尺寸，核对数值范围。
 * [POS]: Web 设置交互契约，不连接真实宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('workbench settings save only their own preference fields', { timeout: 30000 }, async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { PanelSettings } from './ui/settings/panel-settings';
        const root = createRoot(document.getElementById('root')); window.renderSettings = (value) => root.render(
          <><PanelSettings value={value} /><PanelSettings value={value} section="next" /></>);`,
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    executablePath: process.env.CODEX_BUDDY_CHROME_BIN || (existsSync(chrome) ? chrome : undefined),
  });
  try {
    const page = await browser.newPage();
    const saves = [];
    let prefs = {
      revision: 0,
      webRevision: 0,
      detached: false,
      alwaysOnTop: false,
      position: null,
      ui: {
        open: true,
        activeTab: 'next',
        width: 510,
        height: 600,
        layoutMode: 'capsule',
        dockWidth: 340,
        splitRatio: 0.45,
        dockOpen: true,
        material: 'frosted',
        liquidVariant: 'regular',
        fontOffset: 10.130000000000003,
        labelOnly: false,
        promptClickMode: 'fill',
        viewOrder: ['next', 'outline'],
      },
    };
    await page.route('http://settings.test/**', async (route) => {
      if (route.request().url().endsWith('/api/appearance')) {
        const input = route.request().postDataJSON();
        saves.push(input);
        assert.equal(input.expectedRevision, prefs.revision);
        prefs = {
          ...prefs,
          ...input,
          revision: prefs.revision + 1,
          webRevision: prefs.webRevision + 1,
          ui: { ...prefs.ui, ...input.ui },
        };
        await route.fulfill({ json: prefs });
        await page.evaluate((value) => window.renderSettings(value), prefs);
      } else {
        await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
    });
    await page.goto('http://settings.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate((value) => {
      window.notices = [];
      window.renderSettings(value);
    }, prefs);
    const font = page.getByLabel('大纲与下一步字号（px）', { exact: true });
    assert.equal(await font.inputValue(), '23.1');
    assert.equal(await font.getAttribute('step'), '0.1');
    const width = page.getByLabel('侧栏宽度（px）', { exact: true });
    await width.fill('400');
    await width.press('Tab');
    await page.waitForFunction(() => document.querySelector('#dock-width')?.value === '400');
    await page.getByLabel('大纲与下一步字号（px）', { exact: true }).fill('16.34');
    await page.getByLabel('大纲与下一步字号（px）', { exact: true }).press('Tab');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('fieldset')].every((field) => !field.disabled),
    );
    await page.getByLabel('内容显示', { exact: true }).selectOption('true');
    await page.getByLabel('点击建议', { exact: true }).selectOption('hybrid');
    await page.getByText('双击建议会直接发送。', { exact: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('fieldset')].every((field) => !field.disabled),
    );
    await page.getByRole('switch', { name: '桌面窗口置顶' }).click();
    await page.waitForFunction(
      () => document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true',
    );
    assert.equal(prefs.ui.dockWidth, 400);
    assert.ok(Math.abs(prefs.ui.fontOffset - 3.3) < 0.0001);
    assert.equal(await font.inputValue(), '16.3');
    assert.equal(prefs.ui.labelOnly, true);
    assert.equal(prefs.ui.promptClickMode, 'hybrid');
    assert.equal(prefs.alwaysOnTop, true);
    assert.equal(await page.getByLabel('入口位置', { exact: true }).count(), 0);
    for (const save of saves) {
      assert.equal('dockLayout' in (save.ui || {}), false);
      assert.equal('popoutLayout' in (save.ui || {}), false);
      assert.equal('material' in (save.ui || {}), false);
      assert.equal('layoutMode' in (save.ui || {}), false);
    }
    assert.equal(prefs.ui.width, 510);
    assert.equal(prefs.ui.height, 600);
    assert.equal(prefs.ui.material, 'frosted');
    assert.equal(await page.getByLabel('点击胶囊后展开为').count(), 0);
    await width.fill('200');
    await width.press('Tab');
    await page.getByRole('alert').waitFor();
    assert.equal(prefs.ui.dockWidth, 400);
  } finally {
    await browser.close();
  }
});
