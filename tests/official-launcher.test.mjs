/* [INPUT]: Real launcher adapter in a synthetic host rail with delegated navigation.
 * [OUTPUT]: Official button toggles only the old workbench; cleanup and settings remain native.
 * [POS]: Isolated integration test, no real host or plugin calls.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const result = await build({
  stdin: {
    contents: `import {syncLauncher,stopLauncher,launcherButton} from './ui/surfaces/embedded/launcher.js';window.stopLauncher=stopLauncher;window.launcherButton=launcherButton;window.refresh=()=>syncLauncher({open:false,root:null,canUseOfficial:()=>window.chatReady,click:()=>window.toggles++,pointerDown:()=>{},keyDown:()=>{},settings:()=>window.externalSettings++});window.refresh();`,
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
    '<nav class="group/sidebar-rail"><button id="official" aria-label="CodexBuddy 看板">Buddy</button><button id="other">Other</button></nav>',
  );
  await page.evaluate(() => {
    window.chatReady = true;
    window.toggles = window.navigation = window.nativeSettings = window.externalSettings = 0;
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
test('official entry toggles without navigation, removes duplicate icon and preserves native settings', async () => {
  const { page, browser } = await fixture();
  try {
    assert.equal(await page.locator('[data-codex-buddy-launcher]').count(), 0);
    await page.locator('#official').click();
    await page.locator('#official').press('Enter');
    assert.deepEqual(
      await page.evaluate(() => ({ toggles: window.toggles, navigation: window.navigation })),
      { toggles: 2, navigation: 0 },
    );
    await page.locator('#official').click({ button: 'right' });
    assert.deepEqual(
      await page.evaluate(() => ({
        native: window.nativeSettings,
        external: window.externalSettings,
      })),
      { native: 1, external: 0 },
    );
    await page.evaluate(() => window.stopLauncher());
    await page.locator('#official').click();
    assert.equal(await page.evaluate(() => window.navigation), 1);
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
