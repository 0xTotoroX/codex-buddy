/* [INPUT]: Real drawer, navigation, search and form blur handling in synthetic Chromium.
 * [OUTPUT]: Draft/DOM/scroll retention, no navigation saves, nested confirmation and direct links.
 * [POS]: Isolated browser; no user configuration or credentials.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const script = (
  await build({
    stdin: {
      loader: 'jsx',
      resolveDir: process.cwd(),
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{SettingsDrawer}from'./ui/settings/settings-drawer';
import{SettingsForm}from'./ui/settings/settings-controls';
import{useSettingsPage}from'./ui/settings/settings-outline';
import{SettingsSearch}from'./ui/settings/settings-search';
import{ConfirmationButton}from'./ui/settings/settings-confirmation';
function App(){const{page,mode,navigate,switchMode}=useSettingsPage(true);const[draft,setDraft]=useState('原始内容');window.counts??={blur:0,submit:0,delete:0};
const editor={dirty:false,saving:false,remoteChanged:false,form:{},schedule:()=>window.counts.blur++,save:()=>{window.counts.submit++;return Promise.resolve(null)}};
return <div className="settings-app"><SettingsSearch navigate={navigate}/><button data-settings-navigation onClick={()=>switchMode(mode==='simple'?'detail':'simple')}>切换模式</button><button data-settings-navigation onClick={()=>navigate('features','#settings-features')}>功能</button><button data-settings-navigation onClick={()=>navigate('model','#settings-model')}>模型</button><main className="settings-content"><SettingsForm editor={editor} notify={()=>{}} active><section data-settings-page="model" hidden={mode!=='detail'||page!=='model'}><SettingsDrawer id="settings-limits" title="高级设置"><label htmlFor="timeout">超时草稿</label><input id="timeout" required value={draft} onChange={e=>setDraft(e.target.value)}/><button type="button">普通操作</button><ConfirmationButton title="删除测试内容？" confirmLabel="确认删除" description="合成测试" onConfirm={async()=>{window.counts.delete++;return true}}>删除测试</ConfirmationButton><div style={{height:1200}}>滚动测试区域</div></SettingsDrawer></section><section data-settings-page="features" hidden={mode!=='detail'||page!=='features'}><SettingsDrawer id="library" title="词库管理"><label htmlFor="term">术语草稿</label><input id="term" defaultValue="词条"/></SettingsDrawer></section><button type="submit">提交测试</button></SettingsForm></main></div>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
).outputFiles[0].text;
const css = await readFile('ui/settings/settings-controls.css', 'utf8');
async function fixture(hash = 'settings-model') {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
  page.setDefaultTimeout(4000);
  await page.route('http://drawers.test/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('http://drawers.test/#' + hash);
  await page.addStyleTag({
    content:
      css +
      '\n:root{--buddy-page:#fafafa;--buddy-text:#27272a;--buddy-subtle:#f1f1f2;--settings-ease:ease}body{margin:0}.settings-drawer{box-sizing:border-box}',
  });
  await page.addScriptTag({ content: script });
  return { browser, page };
}
test('drawers retain mounted drafts and scroll without saving on close or navigation', async () => {
  const { browser, page } = await fixture();
  try {
    const open = page.getByRole('button', { name: '高级设置', exact: true }),
      close = page.getByRole('button', { name: '关闭高级设置', exact: true }),
      drawer = page.locator('#settings-limits-drawer'),
      input = page.locator('#timeout');
    await open.click();
    await input.fill('未完成的输入');
    await input.evaluate((n) => {
      window.originalInput = n;
    });
    await close.click();
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.counts.blur), 0);
    await open.click();
    assert.equal(await input.inputValue(), '未完成的输入');
    assert.equal(await input.evaluate((n) => n === window.originalInput), true);
    await input.focus();
    await page.keyboard.press('Escape');
    assert.equal(await drawer.evaluate((n) => n.open), false);
    assert.equal(await page.evaluate(() => window.counts.blur), 0);
    await open.click();
    await input.focus();
    await page.mouse.click(10, 400);
    assert.equal(await drawer.evaluate((n) => n.open), false);
    assert.equal(
      await page.evaluate(() => window.counts.blur),
      0,
      'backdrop navigation does not save',
    );
    await page.getByRole('button', { name: '切换模式', exact: true }).click();
    await page.getByRole('button', { name: '切换模式', exact: true }).click();
    await open.click();
    assert.equal(await input.inputValue(), '未完成的输入');
    await input.focus();
    await page.getByRole('button', { name: '普通操作' }).click();
    assert.equal(await page.evaluate(() => window.counts.blur), 1, 'ordinary blur still saves');
    await page.getByRole('button', { name: '删除测试', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await drawer.evaluate((n) => n.open), true, 'Esc closes only nested confirmation');
    assert.equal(await page.evaluate(() => window.counts.delete), 0);
    await drawer.locator('.settings-drawer-content').evaluate((n) => (n.scrollTop = 500));
    await close.click();
    await open.click();
    assert.equal(
      await drawer.locator('.settings-drawer-content').evaluate((n) => n.scrollTop),
      500,
    );
    await close.click();
    await page.getByRole('button', { name: '功能', exact: true }).click();
    await page.getByRole('button', { name: '词库管理', exact: true }).click();
    await page.getByLabel('术语草稿').fill('未保存词条');
    await page.getByRole('button', { name: '关闭词库管理', exact: true }).click();
    await page.getByRole('button', { name: '模型', exact: true }).click();
    await open.click();
    assert.equal(await input.inputValue(), '未完成的输入');
    assert.equal(await input.evaluate((n) => n === window.originalInput), true);
    assert.equal(await page.locator('.settings-drawer[open]').count(), 1);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const box = await drawer.boundingBox();
    assert.equal(Math.round(box.x), 0);
    assert.equal(Math.round(box.width), 360);
    assert.equal(await drawer.evaluate((n) => getComputedStyle(n).transitionDuration), '0s');
    assert.equal(await drawer.evaluate((n) => n.scrollWidth <= n.clientWidth), true);
  } finally {
    await browser.close();
  }
});
test('initial links and search open the right drawer and retain its fields', async () => {
  const { browser, page } = await fixture('settings-model/timeout');
  try {
    await page.locator('#settings-limits-drawer[open]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timeout');
    await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
    const search = page.getByRole('searchbox', { name: '搜索设置' });
    await search.fill('术语草稿');
    await search.press('Enter');
    await page.locator('#library-drawer[open]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'term');
    await page.getByLabel('术语草稿').fill('保留词条');
    await page.getByRole('button', { name: '关闭词库管理', exact: true }).click();
    await search.fill('超时草稿');
    await search.press('Enter');
    await page.locator('#settings-limits-drawer[open]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timeout');
    assert.equal(await page.evaluate(() => window.counts.submit), 0);
  } finally {
    await browser.close();
  }
});

test('manual submit reveals invalid hidden drawer fields without discarding their draft', async () => {
  const { browser, page } = await fixture();
  try {
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    await page.getByLabel('超时草稿').fill('');
    await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
    await page.getByRole('button', { name: '提交测试', exact: true }).click();
    await page.locator('#settings-limits-drawer[open]').waitFor();
    assert.equal(await page.getByLabel('超时草稿').inputValue(), '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timeout');
    assert.equal(await page.evaluate(() => window.counts.submit), 0);
    await page.getByLabel('超时草稿').fill('有效草稿');
    await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
    await page.getByRole('button', { name: '提交测试', exact: true }).click();
    assert.equal(await page.evaluate(() => window.counts.submit), 1);
  } finally {
    await browser.close();
  }
});
