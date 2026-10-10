/* [INPUT]: Real launcher adapter in a synthetic host rail with delegated navigation.
 * [OUTPUT]: Official button toggles only the old workbench; right-click opens the official side tab without global navigation; cleanup restores native behavior.
 * [POS]: Isolated integration test, no real host or plugin calls.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const result = await build({
  stdin: {
    contents: `import {syncLauncher,stopLauncher,launcherButton,openPluginSettings} from './ui/surfaces/embedded/launcher.js';window.openSettings=openPluginSettings;window.stopLauncher=stopLauncher;window.launcherButton=launcherButton;window.refresh=()=>syncLauncher({reuseOfficial:window.reuseOfficial!==false,open:false,root:null,canUseOfficial:()=>window.chatReady,click:()=>window.toggles++,pointerDown:()=>{},keyDown:()=>{},settingsBrowser:()=>window.browserSettings++,settings:()=>window.externalSettings++});window.refresh();`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { CODEX_BUDDY_DEVELOPMENT: 'true' },
});
async function fixture() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(
    '<nav class="group/sidebar-rail"><button id="official" aria-label="CodexBuddy 看板">Buddy</button><button id="other">Other</button></nav><div class="app-shell-main-content-frame" data-conversation-id="A"><div class="thread-scroll-container">Fixture</div></div><button id="toggle" aria-label="显示/隐藏侧边面板" aria-pressed="false">Panel</button><div id="right" data-app-shell-focus-area="right-panel" hidden><button id="new" aria-label="打开侧边面板标签页">New</button><div id="tabs"></div></div>',
  );
  await page.evaluate(() => {
    window.chatReady = true;
    const right = document.getElementById('right'),
      toggle = document.getElementById('toggle');
    toggle.onclick = () => {
      right.hidden = !right.hidden;
      toggle.setAttribute('aria-pressed', String(!right.hidden));
    };
    document.getElementById('new').onclick = () => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      item.textContent = 'CodexBuddy';
      item.onclick = () => {
        menu.remove();
        document.getElementById('tabs').innerHTML =
          '<button role="tab" aria-selected="true">CodexBuddy</button>';
      };
      menu.append(item);
      document.body.append(menu);
    };

    window.toggles =
      window.navigation =
      window.nativeSettings =
      window.externalSettings =
      window.browserSettings =
        0;
    document.body.addEventListener('click', (e) => {
      if (e.target.closest('#official')) window.navigation++;
    });
    document.body.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#official')) {
        e.preventDefault();
        window.nativeSettings++;
      }
    });
  });
  await page.addScriptTag({ content: result.outputFiles[0].text });
  return { page, browser };
}
test('official entry toggles without navigation, removes duplicate icon and keeps native right-click and opens settings through the explicit action', async () => {
  const { page, browser } = await fixture();
  try {
    assert.equal(await page.locator('[data-codex-buddy-launcher]').count(), 0);
    await page.locator('#official').click();
    await page.locator('#official').press('Enter');
    assert.deepEqual(
      await page.evaluate(() => ({ toggles: window.toggles, navigation: window.navigation })),
      { toggles: 2, navigation: 0 },
    );
    await page.locator('#official').evaluate((node) => {
      node.removeAttribute('aria-label');
      node.textContent = 'CodexBuddy';
      node.title = 'CodexBuddy';
    });
    await page.locator('#official').click({ button: 'right' });
    assert.equal(await page.evaluate(() => window.nativeSettings), 1);
    assert.equal(await page.locator('#right').isVisible(), false);
    await page.locator('#official').click({ button: 'right', modifiers: ['Alt'] });
    assert.equal(await page.evaluate(() => window.browserSettings), 1);
    assert.equal(await page.evaluate(() => window.nativeSettings), 1);
    assert.equal(await page.evaluate(() => window.toggles), 2);
    await page.evaluate(() => window.openSettings());
    await page.waitForFunction(
      () =>
        document.querySelector('#official').dataset.buddySettingsStatus ===
        '设置已在官方侧边页签打开。',
    );
    assert.equal(await page.locator('#right').isVisible(), true);
    assert.equal(await page.locator('[data-codex-buddy-launcher]').count(), 0);
    assert.equal(await page.locator('#official').getAttribute('title'), 'CodexBuddy');
    assert.deepEqual(
      await page.evaluate(() => ({
        native: window.nativeSettings,
        external: window.externalSettings,
        navigation: window.navigation,
        toggles: window.toggles,
      })),
      { native: 1, external: 0, navigation: 0, toggles: 2 },
    );
    await page.evaluate(() => {
      document.querySelector('[data-conversation-id]').setAttribute('data-conversation-id', 'B');
      document.getElementById('tabs').replaceChildren();
      document.getElementById('right').hidden = true;
      document.getElementById('toggle').setAttribute('aria-pressed', 'false');
    });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#right').isVisible(), false);
    await page.evaluate(() => window.stopLauncher());
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.navigation), 1);
    await page.locator('#official').click({ button: 'right' });
    assert.equal(await page.evaluate(() => window.nativeSettings), 2);
  } finally {
    await browser.close();
  }
});
test('rail replacement rebinds once and non-chat pages retain native navigation', async () => {
  const { page, browser } = await fixture();
  try {
    await page.locator('nav').evaluate((n) => {
      n.innerHTML = '<button id="official" aria-label="CodexBuddy">Buddy</button>';
    });
    await page.waitForFunction(
      () => window.launcherButton() === document.getElementById('official'),
    );
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.toggles), 1);
    await page.evaluate(() => {
      window.chatReady = false;
    });
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.navigation), 1);
    await page.evaluate(() => {
      window.chatReady = true;
      document.getElementById('official').setAttribute('aria-label', 'Another plugin');
    });
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.toggles), 1);
  } finally {
    await browser.close();
  }
});
test('ambiguous official buttons are not intercepted', async () => {
  const { page, browser } = await fixture();
  try {
    await page
      .locator('nav')
      .evaluate((n) =>
        n.insertAdjacentHTML('beforeend', '<button aria-label="CodexBuddy">Second</button>'),
      );
    await page.waitForSelector('[data-codex-buddy-launcher]');
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.navigation), 1);
    assert.equal(await page.evaluate(() => window.toggles), 0);
  } finally {
    await browser.close();
  }
});

test('default product entry works independently with the plugin button present or absent', async () => {
  const { page, browser } = await fixture();
  try {
    await page.evaluate(() => {
      window.reuseOfficial = false;
      window.refresh();
    });
    const eye = page
      .locator('[data-codex-buddy-launcher]')
      .getByRole('button', { name: 'CodexBuddy', exact: true });
    await eye.click();
    assert.equal(await page.evaluate(() => window.toggles), 1);
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.navigation), 1);
    await page.locator('#official').evaluate((node) => node.remove());
    await eye.click();
    assert.equal(await page.evaluate(() => window.toggles), 2);
    await eye.click({ button: 'right', modifiers: ['Alt'] });
    assert.equal(await page.evaluate(() => window.browserSettings), 1);
  } finally {
    await browser.close();
  }
});
