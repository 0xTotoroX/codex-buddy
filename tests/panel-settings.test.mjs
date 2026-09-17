/*
 * [INPUT]: 实际 React PanelSettings 与隔离浏览器中的合成外观 API。
 * [OUTPUT]: 工作台设置逐字段保存、数值范围及胶囊尺寸/主题/功能开关隔离的回归。
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
        window.renderSettings = (value) => createRoot(document.getElementById('root')).render(
          <PanelSettings value={value} theme="dark" connected={true} popoutSupported={true}
            notify={(text, failed) => window.notices.push({text, failed})} />);`,
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
        fontOffset: 0,
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
          revision: prefs.revision + 1,
          webRevision: prefs.webRevision + 1,
          ui: { ...prefs.ui, ...input.ui },
        };
        await route.fulfill({ json: prefs });
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
    const mode = page.getByLabel('布局模式', { exact: true });
    await mode.waitFor();
    assert.equal(await mode.inputValue(), 'capsule');
    await mode.selectOption('workbench');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByText('停靠布局', { exact: true }).click();
    for (const [label, value] of [
      ['侧栏宽度（px）', '380'],
      ['停靠上下比例', '0.6'],
    ]) {
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByLabel(label, { exact: true }).press('Tab');
      await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    }
    assert.deepEqual(saves, [
      { expectedRevision: 0, ui: { layoutMode: 'workbench' } },
      { expectedRevision: 1, ui: { dockWidth: 380 } },
      {
        expectedRevision: 2,
        ui: {
          dockLayout: {
            group: 'split',
            active: 'outline',
            mode: 'auto',
            first: 'outline',
            verticalRatio: 0.6,
            horizontalRatio: 0.4,
          },
        },
      },
    ]);
    for (const [label, invalid, restored] of [
      ['侧栏宽度（px）', '299', '380'],
      ['停靠上下比例', '0.9', '0.6'],
    ]) {
      const input = page.getByLabel(label, { exact: true });
      await input.fill(invalid);
      await input.press('Tab');
      assert.equal(await input.inputValue(), restored);
    }
    assert.equal(saves.length, 3);
    await page.getByText('浮窗布局', { exact: true }).click();
    await page.getByLabel('浮窗编排', { exact: true }).selectOption('tabs');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByLabel('浮窗选中标签', { exact: true }).selectOption('next');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.equal(prefs.ui.popoutLayout.group, 'tabs');
    assert.equal(prefs.ui.popoutLayout.active, 'next');
    assert.equal(prefs.ui.dockLayout.group, 'split');
    await page.getByLabel('浮窗排列', { exact: true }).selectOption('horizontal');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.equal(prefs.ui.popoutLayout.mode, 'horizontal');
    assert.equal(prefs.ui.dockLayout.verticalRatio, 0.6);
    await page.getByLabel('浮窗首个面板', { exact: true }).selectOption('next');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.equal(prefs.ui.popoutLayout.first, 'next');
    assert.equal(prefs.ui.popoutLayout.horizontalRatio, 0.6);
    await page.getByRole('button', { name: '恢复浮窗默认布局' }).click();
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.equal(prefs.ui.popoutLayout.mode, 'auto');
    assert.equal(prefs.ui.dockLayout.verticalRatio, 0.6);

    assert.equal(await page.getByLabel('Codex 明暗', { exact: true }).inputValue(), 'dark');
    assert.equal(prefs.ui.width, 510);
    assert.equal(prefs.ui.height, 600);
    assert.equal(prefs.ui.material, 'frosted');
    assert.equal(prefs.ui.dockOpen, true);
    assert.equal(await page.evaluate(() => window.notices.filter((item) => item.failed).length), 2);
  } finally {
    await browser.close();
  }
});
