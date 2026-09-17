/*
 * [INPUT]: 共享外观模块、Playwright 与合成停靠容器。
 * [OUTPUT]: 场景默认值、独立持久化、胶囊/原生偏好隔离与星星选中表现回归。
 * [POS]: 外观行为测试；不连接真实聊天或模型。
 * [PROTOCOL]: 变更时检查 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({
  stdin: {
    contents: `import * as appearance from './ui/panel/core/panel-appearance.js';
      import {shellState} from './ui/panel/runtime/state.js';
      window.probe = {...appearance, shellState};`,
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true,
  write: false,
  format: 'iife',
});
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('dock appearances remember independent choices and leave shared window preferences intact', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
    headless: true,
  });
  try {
    for (const popout of [false, true]) {
      const page = await browser.newPage();
      await page.route('http://fixture.test/**', (route) =>
        route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
      );
      await page.goto('http://fixture.test');
      const mount = async () => {
        await page.evaluate((popout) => {
          if (popout) window.__companionPopout = {};
          document.body.innerHTML =
            '<div id="main"><aside data-codex-buddy-dock><div id="root" data-workbench="true"><div class="csw-popover"><div class="csw-panel"><button data-action="material"><span data-material-value></span></button><button class="csw-control-button csw-liquid-star" data-action="liquid-variant"></button></div></div></div></aside></div><div id="chat" data-codex-buddy-chat-row="true"></div>';
        }, popout);
        await page.evaluate(bundle.outputFiles[0].text);
        await page.evaluate(() => {
          const p = window.probe;
          Object.assign(p.shellState, {
            root: document.querySelector('#root'),
            panel: document.querySelector('.csw-panel'),
            popover: document.querySelector('.csw-popover'),
            layoutMode: 'workbench',
            material: 'frosted',
            liquidVariant: 'regular',
          });
          document.querySelector('.csw-liquid-star').innerHTML = p.iconSvg('star');
          p.applyMaterial({ animate: false });
        });
      };
      await mount();
      const read = () => page.evaluate(() => window.probe.currentAppearance());
      const move = (id) =>
        page.evaluate((id) => {
          document.getElementById(id).append(document.querySelector('[data-codex-buddy-dock]'));
          window.probe.applyMaterial({ animate: false });
        }, id);
      if (popout) {
        assert.deepEqual(await read(), { material: 'frosted', liquidVariant: 'regular' });
        await move('chat');
        assert.deepEqual(await read(), { material: 'frosted', liquidVariant: 'regular' });
      } else {
        assert.deepEqual(await read(), { material: 'native-glass', liquidVariant: 'clear' });
        await page.addStyleTag({
          content: readFileSync(
            new URL('../ui/panel/core/styles/controls.css', import.meta.url),
            'utf8',
          ),
        });
        await page.addStyleTag({
          content: ':root{--csw-muted:rgb(140,140,140);--csw-text:white;--csw-accent:blue}',
        });
        const star = () =>
          page.locator('.csw-liquid-star').evaluate((n) => ({
            color: getComputedStyle(n).color,
            background: getComputedStyle(n).backgroundColor,
            fill: getComputedStyle(n.querySelector('path')).fill,
            pressed: n.getAttribute('aria-pressed'),
          }));
        const selected = await star();
        assert.equal(selected.color, 'rgb(140, 140, 140)');
        assert.equal(selected.background, 'rgba(0, 0, 0, 0)');
        assert.equal(selected.fill, selected.color);
        await page.evaluate(() => window.probe.toggleLiquidVariant());
        assert.equal((await star()).fill, 'none');
        assert.equal((await star()).pressed, 'false');
        await move('chat');
        assert.deepEqual(await read(), { material: 'matte', liquidVariant: 'regular' });
        await page.evaluate(() => window.probe.writeMaterial('frosted'));
        await move('main');
        assert.deepEqual(await read(), { material: 'native-glass', liquidVariant: 'regular' });
        await move('chat');
        assert.equal((await read()).material, 'frosted');
        await page.reload();
        await mount();
        assert.deepEqual(await read(), { material: 'native-glass', liquidVariant: 'regular' });
        await move('chat');
        assert.equal((await read()).material, 'frosted');
        await page.evaluate(() => {
          window.probe.shellState.root.dataset.workbench = 'false';
        });
        assert.deepEqual(await read(), { material: 'frosted', liquidVariant: 'regular' });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
