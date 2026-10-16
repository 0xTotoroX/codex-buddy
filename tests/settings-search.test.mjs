/* [INPUT]: Mounted settings controls, category navigation and local search.
 * [OUTPUT]: Search navigation/focus, hidden-details opening and draft/credential isolation.
 * [POS]: Synthetic browser only; no local backend or user data.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const script = (
  await build({
    stdin: {
      loader: 'jsx',
      resolveDir: process.cwd(),
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{SettingsSearch}from'./ui/settings/settings-search';import{useSettingsPage}from'./ui/settings/settings-outline';
function App(){const{page,navigate}=useSettingsPage(true);const[draft,setDraft]=useState('未保存的草稿');return <><SettingsSearch navigate={navigate}/><output id="mode">{page}</output><main className="settings-content"><section data-settings-page="features" hidden={page!=='features'}><div id="settings-prompt-enhancement"><label htmlFor="prompt">启用提示词优化</label><input id="prompt" type="checkbox"/></div></section><section data-settings-page="surfaces" hidden={page!=='surfaces'}><details id="appearance"><summary>内容字号</summary><label htmlFor="font:field">大纲字号</label><input id="font:field" value={draft} onChange={e=>setDraft(e.target.value)}/></details></section><section data-settings-page="model" hidden={page!=='model'}><label htmlFor="key">API 密钥</label><input id="key" type="password" defaultValue="private-value-must-not-be-indexed"/></section><section data-settings-page="connection" id="settings-codex-host" hidden={page!=='connection'}><h2>CodexHost</h2><label htmlFor="host">启用 CodexHost</label><input id="host" type="checkbox"/></section></main></>};createRoot(document.getElementById('root')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
).outputFiles[0].text;
test('settings search reaches hidden categories without remounting or indexing private values', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: script });
    const search = page.getByRole('searchbox', { name: '搜索设置' });
    await search.fill('优化');
    await page.getByRole('button', { name: /启用提示词优化/ }).click();
    assert.equal(await page.locator('#mode').textContent(), 'features');
    await search.fill('大纲字号');
    await search.press('Enter');
    await page.locator('#font\\:field').waitFor();
    assert.equal(await page.locator('#mode').textContent(), 'surfaces');
    assert.equal(await page.locator('#appearance').getAttribute('open'), '');
    assert.equal(await page.locator('#font\\:field').inputValue(), '未保存的草稿');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'font:field');
    await page.locator('#font\\:field').fill('新的未保存内容');
    await search.fill('CodexHost');
    await page.getByRole('button', { name: /启用 CodexHost/ }).click();
    assert.equal(await page.locator('#mode').textContent(), 'connection');
    await search.fill('private-value-must-not-be-indexed');
    await page.getByRole('status').filter({ hasText: '没有找到设置' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: /private-value-must-not-be-indexed/ }).count(),
      0,
    );
    await search.fill('密钥');
    await search.press('Enter');
    await page.getByLabel('API 密钥').waitFor();
    assert.equal(await page.locator('#mode').textContent(), 'model');
    await search.fill('大纲字号');
    await search.press('Enter');
    assert.equal(await page.locator('#font\\:field').inputValue(), '新的未保存内容');
    await search.fill('优化');
    await search.press('Escape');
    assert.equal(await search.inputValue(), '');
    assert.equal(await page.locator('#settings-search-results').count(), 0);
  } finally {
    await browser.close();
  }
});
