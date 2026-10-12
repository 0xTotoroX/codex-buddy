/* [INPUT]: 共用贴字浮层、合成主题与可控业务回调。
 * [OUTPUT]: 两入口一致的材质、主题色、失败回退、开合中断、液态回收。
 * [POS]: 隔离浏览器测试，不读取真实聊天或系统截图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const script = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import{createTermPopover}from'./ui/terminology/popover.js';window.fail=false;window.term={id:'one',name:'防抖',english:'Debouncing',definition:'连续触发时重新计时，等待输入停止后再执行。'};window.options={preferences:{cardMaterial:'matte'},appearance:{theme:'light',colors:{text:'#252525',accent:'#8745bf','surface-opaque':'#faf7ff',muted:'#665e71',divider:'#dfdae6'}},onFavorite:async()=>{if(window.fail)throw Error('模拟保存失败');},onMaster:async()=>{}};window.peer=createTermPopover();window.popup=createTermPopover();window.show=()=>window.popup.show(window.term,()=>document.getElementById('anchor').getBoundingClientRect(),window.options);window.show();`,
    },
    bundle: true,
    write: false,
  })
).outputFiles[0].text;
test('attached card preserves content, colors, transitions, errors and glass lifecycle', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 620 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://term.test/', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<button id="anchor" style="margin:100px">术语</button>',
      }),
    );
    await page.goto('https://term.test/');
    await page.addScriptTag({ content: script });
    const dialog = page.getByRole('dialog', { name: '防抖释义' });
    await dialog.waitFor();
    const details = await page.locator('.term-card').evaluate((c) => ({
      accent: c.style.getPropertyValue('--term-accent'),
      layout:
        c.querySelector('small').getBoundingClientRect().left >
        c.querySelector('strong').getBoundingClientRect().right,
      text: c.innerText,
    }));
    assert.equal(details.accent, '#8745bf');
    assert.equal(details.layout, true);
    assert.ok(!details.text.includes('分类'));
    await page.evaluate(() => (window.fail = true));
    await page.getByRole('button', { name: '收藏术语', exact: true }).click();
    await page.getByText('模拟保存失败').waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: '收藏术语', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    await page.evaluate(() => (window.fail = false));
    await page.getByRole('button', { name: '收藏术语', exact: true }).click();
    await page.getByRole('button', { name: '取消收藏', exact: true }).waitFor();
    await page.evaluate(() => {
      window.closeResult = null;
      window.popup.hide().then((v) => (window.closeResult = v));
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => window.show());
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.closeResult), false);
    await page.waitForTimeout(280);
    assert.equal(await dialog.count(), 1);
    for (const material of ['frosted', 'native-glass', 'black', 'custom']) {
      await page.evaluate((material) => {
        window.options.preferences = {
          cardMaterial: material,
          cardLiquidVariant: 'clear',
          cardCustomColor: '#808080',
        };
        window.show();
      }, material);
      assert.equal(await page.locator('.term-card').getAttribute('data-material'), material);
      assert.equal(
        await page.locator('.term-card').evaluate((c) => c.style.getPropertyValue('--term-accent')),
        '#8745bf',
      );
      if (material === 'native-glass') {
        await page.locator('[data-csw-optics]').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-csw-optics]').count(), 1);
      }
    }
    assert.equal(
      await page.locator('.term-card').evaluate((c) => c.style.getPropertyValue('--term-fg')),
      '#000000',
    );
    assert.equal(await page.locator('[data-csw-optics]').count(), 0);
    await page.evaluate(() => {
      window.popup.show(
        window.term,
        () => document.getElementById('anchor').getBoundingClientRect(),
        window.options,
      );
      window.peer.show(
        window.term,
        () => document.getElementById('anchor').getBoundingClientRect(),
        window.options,
      );
    });
    await page.waitForTimeout(280);
    assert.equal(await page.locator('.term-popover[data-open=true]').count(), 1);
    assert.equal(await page.evaluate(() => window.popup.open), false);
    await page.evaluate(() => {
      window.peer.destroy();
      window.show();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.popup.hide());
    await page.waitForFunction(
      () =>
        document.querySelector('[data-buddy-terms]').shadowRoot.querySelector('.term-card') ===
        null,
    );
    await page.evaluate(() => window.popup.destroy());
    assert.equal(await page.locator('[data-buddy-terms]').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
