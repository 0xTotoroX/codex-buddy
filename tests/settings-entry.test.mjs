/* [INPUT]: Shared header markup/styles in an isolated browser.
 * [OUTPUT]: No redundant face/settings entry; breathing room and right-aligned window actions.
 * [POS]: No real host, model or configuration operations.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('workbench preserves top breathing room and aligns desktop controls on the right', async () => {
  const built = await build({
    stdin: {
      contents: `import {workbenchHeadHtml} from './ui/surfaces/workspace/chrome.js';window.renderHeader=(desktop=false)=>document.querySelector('.csw-workbench').innerHTML=workbenchHeadHtml(desktop)+"<div id='content' style='height:200px'>Content</div>";window.renderHeader();`,
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
      '<style>*{box-sizing:border-box}.csw-icon{padding:5px;border:0;display:inline-flex;align-items:center;justify-content:center}:root{--csw-default-chip-width:84px;--csw-default-chip-height:36px}.csw-workbench{width:400px!important}.csw-workbench-face{grid-column:2;grid-row:1}.csw-settings-entry svg{width:18px;height:18px}</style><div class="csw-workbench"></div>',
    );
    await page.addStyleTag({ content: await readFile('ui/surfaces/workspace/styles.css', 'utf8') });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const head = page.locator('.csw-workbench-head');
    assert.equal(await head.isVisible(), true);
    assert.equal((await head.boundingBox()).height, 16);
    assert.equal(await page.locator('[data-settings-entry]').count(), 0);
    assert.equal(await page.locator('.csw-workbench-face').isVisible(), false);
    assert.equal(await page.locator('.csw-fab-eye').count(), 0);
    assert.equal(
      await page.locator('.csw-workbench [title], .csw-workbench [role=tooltip]').count(),
      0,
    );
    await page.evaluate(() => window.renderHeader(true));
    await page
      .locator('.csw-workbench-controls')
      .evaluate(
        (node) =>
          (node.innerHTML =
            '<button class="csw-icon" data-pin aria-label="置顶"><svg viewBox="0 0 24 24"></svg></button>'),
      );
    await page.locator('.csw-workbench').hover();
    const actions = await page.locator('.csw-workbench-head .csw-icon').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect(),
          s = node.querySelector('svg').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, icon: [s.width, s.height] };
      }),
    );
    assert.equal(actions.length, 4);
    assert.equal(
      await page.locator('.csw-workbench [title], .csw-workbench [role=tooltip]').count(),
      0,
    );
    const bounds = await head.boundingBox();
    assert.equal(bounds.height, 44);
    assert.ok(actions[0].x > bounds.x + bounds.width / 2);
    for (const [index, action] of actions.entries()) {
      assert.deepEqual([action.width, action.height], [28, 28]);
      assert.deepEqual(action.icon, [18, 18]);
      assert.equal(action.y, actions[0].y);
      if (index) assert.equal(action.x - (actions[index - 1].x + 28), 4);
    }
    assert.equal(bounds.x + bounds.width - (actions[3].x + 28), 12);
    assert.equal(await head.isVisible(), true);
    assert.equal(await page.locator('.csw-workbench-face').isVisible(), false);
  } finally {
    await browser.close();
  }
});
