/* [INPUT]: Shared header markup/styles in an isolated browser.
 * [OUTPUT]: Row-only hover, keyboard access and centered eyes geometry.
 * [POS]: No real host, model or configuration operations.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('settings gear follows only the header and stays keyboard accessible', async () => {
  const built = await build({
    stdin: {
      contents: `import {workbenchHeadHtml,bindWorkbenchSettings} from './ui/surfaces/workspace/chrome.js';document.querySelector('.csw-workbench').innerHTML=workbenchHeadHtml()+"<div id='content' style='height:200px'>Content</div>";window.opens=0;bindWorkbenchSettings(document,()=>window.opens++);`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    define: { CODEX_BUDDY_DEVELOPMENT: 'true' },
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await page.setContent(
      '<style>:root{--csw-default-chip-width:84px;--csw-default-chip-height:36px}.csw-workbench{width:400px!important}.csw-workbench-face{grid-column:2;grid-row:1}.csw-settings-entry svg{width:18px;height:18px}</style><div class="csw-workbench"></div>',
    );
    await page.addStyleTag({ content: await readFile('ui/surfaces/workspace/styles.css', 'utf8') });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const gear = page.locator('[data-settings-entry]');
    await page.locator('#content').hover();
    assert.equal(await gear.evaluate((n) => getComputedStyle(n).opacity), '0');
    const head = page.locator('.csw-workbench-head');
    await head.hover();
    assert.equal(await gear.evaluate((n) => getComputedStyle(n).opacity), '1');
    const h = await head.boundingBox(),
      face = await page.locator('.csw-workbench-face').boundingBox(),
      g = await gear.boundingBox();
    assert.ok(Math.abs(face.x + face.width / 2 - h.x - h.width / 2) < 1);
    assert.ok(g.x > face.x + face.width);
    assert.equal(g.width, 28);
    await gear.click();
    assert.equal(await page.evaluate(() => window.opens), 1);
    await page.locator('#content').hover();
    await gear.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await gear.evaluate((n) => getComputedStyle(n).opacity), '1');
  } finally {
    await browser.close();
  }
});
