/* [INPUT]: Host browser adapter and synthetic visible navigation controls.
 * [OUTPUT]: Local settings enter the host address bar; no external window fallback.
 * [POS]: No real host, browser profile, settings token or network traffic.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const compiled = await build({
  stdin: {
    contents:
      "import {openSettingsBrowser} from './ui/codex/plugin-tab.js';window.openSettingsBrowser=openSettingsBrowser;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  define: { CODEX_BUDDY_DEVELOPMENT: 'true' },
});
test('web settings use native browser address controls and return to split view', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<div class="app-shell-main-content-frame" data-conversation-id="fixture-A"><div class="thread-scroll-container">Chat</div></div><button id="show" aria-label="显示标签页">Show tabs</button><button id="new" aria-label="新标签页" hidden>New</button><div id="browser"></div>',
    );
    await page.evaluate(() => {
      document.querySelector('#show').onclick = () => {
        document.querySelector('#new').hidden = false;
        document.querySelector('#show').hidden = true;
      };
      window.externalCalls = 0;
      window.open = () => window.externalCalls++;
      document.querySelector('#new').onclick = () => {
        document.querySelector('#browser').innerHTML =
          '<input placeholder="搜索或输入网址"><button id="split" aria-label="进入分屏视图" aria-pressed="false">Split</button>';
        const input = document.querySelector('input');
        input.onkeydown = (e) => {
          if (e.key === 'Enter') window.submitted = input.value;
        };
        document.querySelector('#split').onclick = (e) =>
          e.currentTarget.setAttribute('aria-pressed', 'true');
      };
    });
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    await page.evaluate(() => window.openSettingsBrowser('http://127.0.0.1:12345/#token=fixture'));
    assert.equal(
      await page.evaluate(() => window.submitted),
      'http://127.0.0.1:12345/#token=fixture',
    );
    assert.equal(await page.locator('#split').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.externalCalls), 0);
    await assert.rejects(page.evaluate(() => window.openSettingsBrowser('https://example.com')));
  } finally {
    await browser.close();
  }
});
