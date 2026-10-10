/* [INPUT]: Dev launcher, plugin-tab adapter and an isolated synthetic host.
 * [OUTPUT]: User-click opening, session restoration, no repeated stealing and guarded failures.
 * [POS]: Narrow browser regression; never connects to ChatGPT or calls MCP/model tools.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const compiled = await build({
  stdin: {
    contents: `import {syncLauncher,stopLauncher} from './ui/surfaces/embedded/launcher.js';window.stopBuddy=stopLauncher;syncLauncher({open:false,root:null,click:()=>window.legacyClicks++,pointerDown:()=>{},keyDown:()=>{},settings:()=>window.settingsClicks++,pluginOpened:()=>window.opened++});`,
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
    `<nav class="group/sidebar-rail"><span>官方导航</span></nav><div class="app-shell-main-content-frame" data-conversation-id="A"><div class="thread-scroll-container">合成聊天</div></div><button id="toggle" aria-label="显示/隐藏侧边面板" aria-pressed="false">侧边面板</button><div id="right" data-app-shell-focus-area="right-panel" hidden><button id="new" aria-label="打开侧边面板标签页">＋</button><div id="tabs"></div></div>`,
  );
  await page.evaluate(() => {
    window.legacyClicks = window.settingsClicks = window.opened = window.menuClicks = 0;
    window.pluginAvailable = true;
    window.createDelay = 0;
    const right = document.getElementById('right'),
      tabs = document.getElementById('tabs'),
      toggle = document.getElementById('toggle');
    toggle.onclick = () => {
      right.hidden = !right.hidden;
      toggle.setAttribute('aria-pressed', String(!right.hidden));
    };
    document.getElementById('new').onclick = () => {
      window.menuClicks++;
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      item.textContent = window.pluginAvailable ? 'CodexBuddy' : '其他插件';
      item.onclick = () => {
        menu.remove();
        setTimeout(() => {
          const tab = document.createElement('button');
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-selected', 'true');
          tab.textContent = 'CodexBuddy';
          tab.onclick = () => tab.setAttribute('aria-selected', 'true');
          tabs.append(tab);
        }, window.createDelay);
      };
      menu.append(item);
      document.body.append(menu);
    };
    window.switchSession = (id) => {
      document
        .querySelector('.app-shell-main-content-frame')
        .setAttribute('data-conversation-id', id);
      tabs.replaceChildren();
      right.hidden = true;
      toggle.setAttribute('aria-pressed', 'false');
    };
  });
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  return {
    browser,
    page,
    button: page
      .locator('[data-codex-buddy-launcher]')
      .getByRole('button', { name: 'CodexBuddy', exact: true }),
  };
}
test('manual launcher opens official plugin once and follows sessions without stealing same-session tabs', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.menuClicks), 0);
    await button.click();
    await page.waitForFunction(() => window.opened === 1);
    assert.equal(await page.evaluate(() => window.legacyClicks), 0);
    await button.click();
    await page.waitForFunction(() => window.opened === 2);
    assert.equal(await page.evaluate(() => window.menuClicks), 1);
    await page
      .getByRole('tab', { name: 'CodexBuddy' })
      .evaluate((n) => n.setAttribute('aria-selected', 'false'));
    await page.waitForTimeout(650);
    assert.equal(
      await page.getByRole('tab', { name: 'CodexBuddy' }).getAttribute('aria-selected'),
      'false',
    );
    await page.evaluate(() => window.switchSession('B'));
    await page.waitForFunction(() => window.opened === 3);
    assert.equal(await page.evaluate(() => window.menuClicks), 2);
    await page.getByRole('button', { name: '显示/隐藏侧边面板' }).click();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#right').isVisible(), false);
    await button.click({ button: 'right' });
    assert.equal(await page.evaluate(() => window.settingsClicks), 1);
    await page.evaluate(() => window.stopBuddy());
    await page.evaluate(() => window.switchSession('C'));
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.menuClicks), 2);
  } finally {
    await browser.close();
  }
});
test('missing plugin stops with an error and never opens legacy UI or loops', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      window.pluginAvailable = false;
    });
    await button.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-codex-buddy-launcher]')
          .shadowRoot.querySelector('button')
          .title.includes('未找到官方 Buddy'),
      {},
      { timeout: 7000 },
    );
    await page.evaluate(() => window.switchSession('B'));
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.menuClicks), 1);
    assert.equal(await page.evaluate(() => window.legacyClicks), 0);
  } finally {
    await browser.close();
  }
});
test('unrelated menus and in-flight session changes are not adopted', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      const m = document.createElement('div');
      m.id = 'unrelated';
      m.setAttribute('role', 'menu');
      m.textContent = '其他菜单';
      document.body.append(m);
    });
    await button.click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-codex-buddy-launcher]')
        .shadowRoot.querySelector('button')
        .title.includes('请先关闭当前菜单'),
    );
    assert.equal(await page.evaluate(() => window.menuClicks), 0);
    await page.locator('#unrelated').evaluate((n) => n.remove());
    await page.evaluate(() => {
      window.createDelay = 500;
    });
    await button.click();
    await page.waitForFunction(() => window.menuClicks === 1);
    await page.evaluate(() => window.switchSession('B'));
    await page.waitForFunction(() =>
      document
        .querySelector('[data-codex-buddy-launcher]')
        .shadowRoot.querySelector('button')
        .title.includes('聊天正在切换'),
    );
    assert.equal(await page.evaluate(() => window.opened), 0);
  } finally {
    await browser.close();
  }
});

test('current host conversation marker and New tab context menu open the plugin without a browser page', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      const host = document.querySelector('.app-shell-main-content-frame');
      host.className = 'current-host-layout';
      host.removeAttribute('data-conversation-id');
      const marker = document.createElement('div');
      marker.setAttribute('data-above-composer-conversation-id', 'current-A');
      document.querySelector('.thread-scroll-container').append(marker);
      const plus = document.getElementById('new');
      plus.setAttribute('aria-label', '新标签页');
      // 新版统一标签条位于主工具栏，不在旧 right-panel 容器内。
      document.getElementById('right').removeAttribute('data-app-shell-focus-area');
      const tabs = document.getElementById('tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '任务选项卡');
      document.getElementById('toggle').setAttribute('aria-label', '显示标签页');
      const split = document.createElement('button');
      split.setAttribute('aria-label', '进入分屏视图');
      split.setAttribute('aria-pressed', 'false');
      window.splitOpened = false;
      split.onclick = () => {
        window.splitOpened = true;
        split.setAttribute('aria-pressed', 'true');
      };
      document.body.append(split);
      const menu = plus.onclick;
      window.browserPages = 0;
      plus.onclick = () => window.browserPages++;
      plus.oncontextmenu = (event) => {
        event.preventDefault();
        menu.call(plus, event);
      };
    });
    await button.click();
    await page.waitForFunction(() => window.opened === 1);
    assert.equal(await page.evaluate(() => window.browserPages), 0);
    assert.equal(await page.evaluate(() => window.splitOpened), true);
    assert.equal(await page.evaluate(() => window.menuClicks), 1);
  } finally {
    await browser.close();
  }
});

test('two visible main conversations remain ambiguous instead of choosing the first', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      const extra = document.createElement('div');
      extra.setAttribute('data-conversation-id', 'other');
      extra.innerHTML = '<div class="thread-scroll-container">another fixture</div>';
      document.body.append(extra);
    });
    await button.click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-codex-buddy-launcher]')
        .shadowRoot.querySelector('button')
        .title.includes('无法唯一识别'),
    );
    assert.equal(await page.evaluate(() => window.menuClicks), 0);
  } finally {
    await browser.close();
  }
});

test('empty official panel opens through New tab and keyboard-operated More tools, ignoring hidden duplicates', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      const plus = document.getElementById('new');
      const right = document.getElementById('right');
      const originalMenu = plus.onclick;
      document.getElementById('toggle').remove();
      plus.remove();
      const start = document.createElement('button');
      start.textContent = '新建标签页';
      start.onclick = () => {
        start.remove();
        right.hidden = false;
        const more = document.createElement('button');
        more.textContent = '更多工具…';
        more.setAttribute('aria-haspopup', 'menu');
        // Match the host's menu primitive: a naked click is not its activation event.
        more.onkeydown = (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            originalMenu.call(plus, event);
          }
        };
        right.append(more);
      };
      document.body.append(start);
      const hidden = document.createElement('div');
      hidden.setAttribute('aria-hidden', 'true');
      hidden.innerHTML = '<button aria-label="新建标签页">hidden duplicate</button>';
      document.body.append(hidden);
      const offscreen = document.createElement('button');
      offscreen.textContent = '新建标签页';
      offscreen.style.cssText = 'position:absolute;left:-2000px';
      document.body.append(offscreen);
    });
    await button.click();
    await page.waitForFunction(() => window.opened === 1);
    assert.equal(await page.evaluate(() => window.menuClicks), 1);
    assert.equal(await page.evaluate(() => window.legacyClicks), 0);
  } finally {
    await browser.close();
  }
});

test('following stays armed after an interrupted session and a later session can recover', async () => {
  const { browser, page, button } = await fixture();
  try {
    await button.click();
    await page.waitForFunction(() => window.opened === 1);
    // B never finishes loading its plugin. Navigation to C must cancel B, not disable follow.
    await page.evaluate(() => {
      window.pluginAvailable = false;
      window.switchSession('B');
    });
    await page.waitForFunction(() => window.menuClicks === 2);
    await page.evaluate(() => {
      document.querySelectorAll('[role="menu"]').forEach((n) => n.remove());
      window.pluginAvailable = true;
      window.switchSession('C');
    });
    await page.waitForFunction(() => window.opened === 2);
    assert.equal(await page.evaluate(() => window.menuClicks), 3);
  } finally {
    await browser.close();
  }
});

test('plugin selection that hides the chat in full view is restored to split before success', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      const plus = document.getElementById('new');
      const openMenu = plus.onclick;
      plus.onclick = (event) => {
        openMenu.call(plus, event);
        const item = document.querySelector('[role="menuitem"]');
        const select = item.onclick;
        item.onclick = (event) => {
          document.querySelector('.app-shell-main-content-frame').setAttribute('hidden', '');
          const split = document.createElement('button');
          split.textContent = '进入分屏视图';
          split.setAttribute('aria-pressed', 'false');
          split.onclick = () => {
            document.querySelector('.app-shell-main-content-frame').removeAttribute('hidden');
            split.setAttribute('aria-pressed', 'true');
          };
          document.body.append(split);
          select.call(item, event);
        };
      };
    });
    await button.click();
    await page.waitForFunction(() => window.opened === 1);
    assert.equal(await page.locator('.app-shell-main-content-frame').isVisible(), true);
  } finally {
    await browser.close();
  }
});

test('occluded duplicate controls do not block the active official control', async () => {
  const { browser, page, button } = await fixture();
  try {
    await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:0;top:400px;width:220px;height:60px';
      holder.innerHTML =
        '<button aria-label="显示/隐藏侧边面板" aria-pressed="false">covered</button><div style="position:absolute;inset:0;background:gray"></div>';
      document.body.append(holder);
    });
    await button.click();
    await page.waitForFunction(() => window.opened === 1);
    assert.equal(await page.evaluate(() => window.menuClicks), 1);
  } finally {
    await browser.close();
  }
});
