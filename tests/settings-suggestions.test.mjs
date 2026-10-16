/* [INPUT]: Actual suggestion/model components, save queue, synthetic model API and isolated Chromium.
 * [OUTPUT]: Keyboard/pointer choice, free text, loading/failure, stale-list isolation and draft-preserving behavior.
 * [POS]: Synthetic data only; no model API or real settings writes.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('suggestion inputs retain free text and only commit explicit choices', async () => {
  const script = (
    await build({
      stdin: {
        loader: 'jsx',
        resolveDir: process.cwd(),
        contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SuggestionInput}from'./ui/settings/components/ui/suggestion-input';
function App(){const[value,setValue]=useState('');const[blur,setBlur]=useState(0);const[submit,setSubmit]=useState(0);return <form onSubmit={e=>{e.preventDefault();setSubmit(n=>n+1)}} onBlur={()=>setBlur(n=>n+1)}><label htmlFor="model">模型</label><SuggestionInput id="model" value={value} options={['Alpha','Beta','Beta']} onValueChange={setValue}/><button type="button">其他操作</button><output id="state">{JSON.stringify({value,blur,submit})}</output></form>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.setContent(
      '<div class="settings-app" id="root" style="position:fixed;bottom:24px;width:320px"></div>',
    );
    await page.addStyleTag({
      content: await readFile('ui/settings/settings-controls.css', 'utf8'),
    });
    await page.addScriptTag({ content: script });
    const input = page.getByRole('combobox', { name: '模型', exact: true });
    const state = async () => JSON.parse(await page.locator('#state').textContent());
    await input.click();
    assert.equal(await page.getByRole('option').count(), 2, 'duplicate options are removed');
    assert.equal(
      await page.getByRole('listbox').getAttribute('data-above'),
      'true',
      'near-bottom menus open above the input',
    );
    await input.press('ArrowDown');
    await input.press('Escape');
    assert.deepEqual(await state(), { value: '', blur: 0, submit: 0 });
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('Enter');
    assert.deepEqual(
      await state(),
      { value: 'Beta', blur: 0, submit: 0 },
      'Enter chooses without submitting or blurring',
    );
    await input.fill('');
    await page.getByRole('option', { name: 'Alpha', exact: true }).click();
    assert.deepEqual(
      await state(),
      { value: 'Alpha', blur: 0, submit: 0 },
      'pointer selection does not prematurely save a draft',
    );
    await input.fill('my-custom-model');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await input.press('Tab');
    assert.deepEqual(
      await state(),
      { value: 'my-custom-model', blur: 1, submit: 0 },
      'free text survives normal blur',
    );
    await input.fill('a');
    await input.press('ArrowDown');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await input.inputValue(), 'a', 'IME confirmation never selects a suggestion');
  } finally {
    await browser.close();
  }
});

test('model dropdown loads saved-connection candidates without saving drafts and handles failure', async () => {
  const script = (
    await build({
      stdin: {
        loader: 'jsx',
        resolveDir: process.cwd(),
        contents: `
import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
import{ModelSettings}from'./ui/settings/model-settings';
import{SettingsForm}from'./ui/settings/settings-controls';
import{useSettingsForm}from'./ui/settings/use-settings-form';
import{fixtureSettings}from'./tests/fixtures.mjs';
const baseline={...fixtureSettings,model:'Alpha'};
function App(){
 const editor=useSettingsForm(false,undefined,v=>v,()=>{});
 useEffect(()=>editor.load(baseline),[]);
 return <div className="settings-app"><SettingsForm editor={editor} notify={()=>{}} active>
 <ModelSettings editor={editor} notify={()=>{}} simple={false}/>
 <button type="button" data-settings-navigation onClick={()=>editor.load({...baseline,configurationRevision:baseline.configurationRevision+1,baseUrl:'http://changed.invalid'})}>模拟连接变更</button>
 </SettingsForm></div>
};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let reads = 0;
    let writes = 0;
    let response = { models: ['Alpha', 'Beta', 'Beta'] };
    let status = 200;
    let hold;
    let release;
    await page.route('http://settings.test/**', async (route) => {
      if (route.request().url().endsWith('/api/settings/models')) {
        reads++;
        const body = JSON.stringify(response);
        const responseStatus = status;
        if (hold) await hold;
        await route.fulfill({ status: responseStatus, contentType: 'application/json', body });
      } else if (route.request().url().includes('/api/')) {
        writes++;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"message":"no writes expected"}',
        });
      } else {
        await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
    });
    await page.goto('http://settings.test/');
    await page.addStyleTag({
      content: await readFile('ui/settings/settings-controls.css', 'utf8'),
    });
    await page.addScriptTag({ content: script });
    const input = page.getByRole('combobox', { name: '模型名称', exact: true });
    const arrow = page.getByRole('button', { name: '选择模型', exact: true });
    const list = page.getByRole('listbox', { name: '选择模型' });
    await input.waitFor();
    assert.equal(reads, 0, 'rendering never requests a model list');
    hold = new Promise((resolve) => {
      release = resolve;
    });
    await arrow.click();
    await page.getByText('正在读取模型…').waitFor();
    release();
    hold = undefined;
    await list.getByRole('option', { name: 'Beta', exact: true }).waitFor();
    assert.equal(
      await list.getByRole('option').count(),
      2,
      'current exact ID does not hide alternatives',
    );
    assert.equal(await input.inputValue(), 'Alpha');
    await input.fill('bet');
    assert.deepEqual(await list.getByRole('option').allTextContents(), ['Beta']);
    await input.fill('not-in-catalog');
    await page.getByText('没有匹配的模型，可直接输入模型 ID。').waitFor();
    await input.press('Escape');
    await arrow.click();
    await list.getByRole('option', { name: 'Beta', exact: true }).waitFor();
    await list.getByRole('option', { name: 'Beta', exact: true }).click();
    assert.equal(await input.inputValue(), 'Beta');
    await input.press('ArrowDown');
    await list.getByRole('option', { name: 'Alpha', exact: true }).waitFor();
    await input.press('ArrowDown');
    await input.press('Enter');
    assert.equal(await input.inputValue(), 'Alpha', 'keyboard can choose an alternative');
    await input.fill('unlisted-model');
    await arrow.click(); // Typing already opened the filtered list: first click closes it.
    await arrow.click();
    await list.getByRole('option', { name: 'Beta', exact: true }).waitFor();
    assert.equal(await input.inputValue(), 'unlisted-model', 'opening preserves custom ID draft');
    await input.press('Escape');
    assert.equal(await list.count(), 0);
    assert.equal(writes, 0, 'opening, choosing and cancellation do not prematurely save');

    status = 503;
    response = { message: '模型列表暂不可用' };
    await arrow.click();
    await page.getByText(/模型列表暂不可用/).waitFor();
    assert.equal(await input.inputValue(), 'unlisted-model', 'failed list does not destroy draft');
    await input.press('Escape');
    status = 200;
    response = { models: [] };
    await arrow.click();
    await page.getByText('服务未返回模型列表，可直接输入模型 ID。').waitFor();
    await input.press('Escape');

    response = { models: ['Old-connection-model'] };
    hold = new Promise((resolve) => {
      release = resolve;
    });
    await arrow.click();
    await page.getByText('正在读取模型…').waitFor();
    await page.getByRole('button', { name: '模拟连接变更' }).click();
    release();
    hold = undefined;
    response = { models: ['New-connection-model'] };
    await arrow.click();
    await list.getByRole('option', { name: 'New-connection-model', exact: true }).waitFor();
    assert.equal(
      await list.getByRole('option', { name: 'Old-connection-model', exact: true }).count(),
      0,
      'late old connection response cannot replace the new list',
    );
    await page.keyboard.press('Escape');
    await page.getByLabel('API 地址', { exact: true }).fill('http://unsaved.invalid');
    const readsBefore = reads;
    await arrow.click();
    await page.getByText('请先保存连接配置，再读取模型列表；也可直接输入模型 ID。').waitFor();
    assert.equal(
      reads,
      readsBefore,
      'unsaved connection never loads candidates from old connection',
    );
    assert.equal(writes, 0, 'opening from another field does not save its draft');
    await page.keyboard.press('Escape');
    assert.equal(await list.count(), 0, 'Escape closes even when another field retains focus');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
