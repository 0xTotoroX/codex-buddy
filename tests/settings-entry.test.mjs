/* [INPUT]: Shared header markup/styles in an isolated browser.
 * [OUTPUT]: No redundant settings entry and centered eyes geometry.
 * [POS]: No real host, model or configuration operations.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('workbench header retains centered eyes without a settings gear', async () => {
  const built = await build({
    stdin: {
      contents: `import {workbenchHeadHtml} from './ui/surfaces/workspace/chrome.js';document.querySelector('.csw-workbench').innerHTML=workbenchHeadHtml()+"<div id='content' style='height:200px'>Content</div>";`,
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
    const head = page.locator('.csw-workbench-head');
    await head.hover();
    assert.equal(await page.locator('[data-settings-entry]').count(), 0);
    const h = await head.boundingBox(),
      face = await page.locator('.csw-workbench-face').boundingBox();
    assert.ok(Math.abs(face.x + face.width / 2 - h.x - h.width / 2) < 1);
  } finally {
    await browser.close();
  }
});
