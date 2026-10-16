/* [INPUT]: Actual free-text suggestion component and isolated Chromium.
 * [OUTPUT]: Keyboard/pointer selection, cancellation, free text and draft-preserving blur behavior.
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
