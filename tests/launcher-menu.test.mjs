/* [INPUT]: Vertical launcher UI in a synthetic browser with no host or native window.
 * [OUTPUT]: Hover travel, quick-click hit area, action identity, focus and cleanup checks.
 * [POS]: Isolated interaction/render verification; only synthetic screenshots.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const compiled = await build({
  stdin: {
    contents: `import {createLauncherMenu} from './ui/surfaces/embedded/launcher-menu.js';window.options={defaultAction:'inside',outsideAvailable:true,colors:{text:'#272727','surface-opaque':'#fafafa'},action:async action=>window.actions.push(action)};window.actions=[];window.menu=createLauncherMenu(document.querySelector('#eyes'),()=>window.options);`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
});
test('inline expanding menu preserves eyes hit target and has stable hover, keyboard and cleanup', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 520, height: 460 },
    reducedMotion: 'reduce',
  });
  try {
    await page.route('http://localhost:12345/**', (route) =>
      route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
    );
    await page.goto('http://localhost:12345/');
    await page.setContent(
      `<body style="margin:0;background:#f4f4f4;font-family:system-ui"><aside style="width:64px;height:460px;display:flex;flex-direction:column;align-items:center;gap:8px;background:#eee;border-right:1px solid #ddd"><div id="rail-content" style="flex:1;min-height:0"></div><div id="entry" style="display:flex;flex:none;flex-direction:column;align-items:center;gap:8px"><button id="eyes" aria-label="CodexBuddy" style="width:36px;height:36px;flex:none;border:0;border-radius:10px;background:transparent;color:#292929"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="7" width="4" height="10" rx="2"/><rect x="15" y="7" width="4" height="10" rx="2"/></svg></button></div><div style="height:48px;flex:none"></div></aside></body>`,
    );
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    const eye = page.locator('#eyes'),
      host = page.locator('[data-codex-buddy-launcher-menu]');
    const initialEye = await eye.boundingBox();
    await eye.hover();
    await page.waitForFunction(() =>
      document.querySelector('[data-codex-buddy-launcher-menu]').hasAttribute('data-open'),
    );
    const rect = await eye.boundingBox();
    assert.equal(Math.round(rect.y), Math.round(initialEye.y));
    assert.equal(await host.evaluate((node) => node.parentElement.id), 'entry');
    assert.notEqual(await host.evaluate((node) => getComputedStyle(node).position), 'fixed');
    const menuBox = await host.locator('.menu-shell').boundingBox();
    assert.equal(Math.round(rect.y - menuBox.y - menuBox.height), 4);
    assert.equal(Math.round(menuBox.x + menuBox.width / 2), Math.round(rect.x + rect.width / 2));
    assert.equal(
      await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest('button')?.id, {
        x: rect.x + rect.width - 2,
        y: rect.y + rect.height / 2,
      }),
      'eyes',
    );
    await host.getByRole('menuitem', { name: '在桌面打开' }).hover();
    await page.waitForTimeout(220);
    assert.equal(await host.getAttribute('data-open'), '');
    assert.equal(await host.locator('.glass,.rim,[data-csw-optics]').count(), 0);
    assert.equal(
      await host.evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
    await mkdir('target/reports', { recursive: true });
    await page.screenshot({ path: 'target/reports/launcher-menu-light.png' });
    await page.evaluate(() => {
      window.menu.close();
    });
    await eye.focus();
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => {
      window.options.theme = 'dark';
      window.options.colors = { text: '#f5f5f5', 'surface-opaque': '#202020', hover: '#ffffff15' };
      document.body.style.background = '#202020';
      document.querySelector('aside').style.background = '#292929';
      window.menu.update();
    });
    await page.screenshot({ path: 'target/reports/launcher-menu-dark.png' });

    await host.getByRole('menuitem', { name: '在桌面打开' }).click();
    assert.deepEqual(await page.evaluate(() => window.actions), ['outside']);
    assert.equal(await host.getAttribute('data-open'), null);
    await eye.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.actions), ['outside', 'outside']);
    await eye.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    assert.equal(await eye.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => {
      window.options.outsideAvailable = false;
      window.options.defaultAction = 'settings';
      window.menu.update();
      document.querySelector('aside').style.height = '340px';
    });
    await page.mouse.move(300, 100);
    await eye.hover();
    await page.waitForFunction(() =>
      document.querySelector('[data-codex-buddy-launcher-menu]').hasAttribute('data-open'),
    );
    assert.equal(await host.getAttribute('data-flip-y'), null);
    assert.equal(await host.getByRole('menuitem', { name: '在桌面打开' }).isDisabled(), true);
    for (const item of await host.getByRole('menuitem').all()) {
      const r = await item.boundingBox();
      assert.ok(r.y >= 0 && r.x >= 0 && r.y + r.height <= 460);
    }
    await page.evaluate(() => window.menu.destroy());
    assert.equal(await host.count(), 0);
  } finally {
    await browser.close();
  }
});
