/* [INPUT]: Real credential UI/save queue, synthetic settings API and isolated Chromium.
 * [OUTPUT]: Configured status, replacement/cancel, explicit scoped deletion and retry/conflict protection.
 * [POS]: Fake keys only; never reads or changes the user's stored credentials.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'credentials keep saved keys, hide empty reveal, and require scoped confirmed deletion',
  { timeout: 30000 },
  async () => {
    const script = (
      await build({
        stdin: {
          loader: 'jsx',
          resolveDir: process.cwd(),
          contents: `
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{ModelSettings}from'./ui/settings/model-settings';
import{SettingsForm}from'./ui/settings/settings-controls';
import{useSettingsForm}from'./ui/settings/use-settings-form';
import{fixtureSettings}from'./tests/fixtures.mjs';
function App(){const[simple,setSimple]=useState(false);const editor=useSettingsForm(false,undefined,v=>Object.fromEntries(["enabled", "answerOutlineEnabled", "promptEnhancementEnabled", "generationMode", "hostRestartPolicy", "provider", "protocol", "model", "baseUrl", "apiKeyEnv", "maxItems", "directionSource", "directionLibrary", "selectedDirections", "jev", "quickPrompts", "maxInputChars", "maxOutputTokens", "timeoutMs"].map(key=>[key,v[key]])),()=>{});
useEffect(()=>{editor.load({...fixtureSettings,storedApiKey:true});window.receiveSettings=editor.load},[]);
return <div className="settings-app"><SettingsForm editor={editor} notify={()=>{}} active>
<button type="button" data-settings-navigation onClick={()=>setSimple(!simple)}>切换模式</button>
<ModelSettings editor={editor} simple={simple}/></SettingsForm></div>}
createRoot(document.getElementById('root')).render(<App/>);`,
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
      page.setDefaultTimeout(5000);
      let settings = { ...fixtureSettings, storedApiKey: true };
      let storedKey = 'fixture-original';
      let fail = false;
      const writes = [];
      await page.route('http://credentials.test/**', async (route) => {
        if (route.request().url().endsWith('/api/settings')) {
          const body = JSON.parse(route.request().postData());
          writes.push(body);
          if (fail || body.expectedRevision !== settings.configurationRevision) {
            await route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ message: fail ? '合成删除失败' : '设置已在其他窗口更新' }),
            });
            return;
          }
          const { apiKey, clearApiKey, jevApiKey, clearJevApiKey, expectedRevision, ...patch } =
            body;
          if (clearApiKey) storedKey = '';
          else if (apiKey?.trim()) storedKey = apiKey;
          settings = {
            ...settings,
            ...patch,
            storedApiKey: !!storedKey,
            apiKeyConfigured: !!storedKey,
            configurationRevision: settings.configurationRevision + 1,
          };
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify(settings) });
        } else await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      });
      await page.goto('http://credentials.test/');
      await page.addStyleTag({
        content: await readFile('ui/settings/settings-controls.css', 'utf8'),
      });
      await page.addScriptTag({ content: script });
      const replace = page.getByRole('button', { name: '更换密钥', exact: true });
      const key = page.locator('input#api-key');
      const advanced = page.getByText('高级设置', { exact: true });
      const remove = page.getByRole('button', { name: '删除已保存的密钥', exact: true });
      const dialog = page.getByRole('dialog', { name: '删除已保存的 API 密钥？' });
      await page.getByText('密钥已配置', { exact: true }).waitFor();
      assert.equal(await key.count(), 0, 'saved key is never returned or put in a dummy input');
      assert.equal(await page.getByRole('button', { name: /显示.*密钥/ }).count(), 0);
      assert.equal(await remove.isVisible(), false);
      assert.equal(writes.length, 0);
      await replace.click();
      assert.equal(await key.inputValue(), '');
      assert.equal(await page.getByRole('button', { name: '显示新密钥' }).count(), 0);
      await key.fill('fixture-new-draft');
      await page.getByRole('button', { name: '显示新密钥' }).click();
      assert.equal(await key.getAttribute('type'), 'text');
      assert.equal(writes.length, 0, 'reveal does not autosave');
      await page.getByRole('button', { name: '切换模式' }).click();
      assert.equal(await key.inputValue(), 'fixture-new-draft');
      await page.getByRole('button', { name: '切换模式' }).click();
      await page.getByRole('button', { name: '取消更换' }).click();
      await replace.waitFor();
      assert.equal(storedKey, 'fixture-original');
      assert.equal(writes.length, 0, 'cancel and mode navigation do not replace original key');

      await replace.click();
      await key.fill('fixture-replacement');
      const replaced = page.waitForResponse((r) => r.url().endsWith('/api/settings'));
      await page.getByRole('heading', { name: '生成模型', exact: true }).click();
      await (await replaced).finished();
      await replace.waitFor();
      assert.equal(storedKey, 'fixture-replacement');
      assert.equal(
        await page.getByRole('button', { name: /显示.*密钥/ }).count(),
        0,
        'reveal disappears after successful save',
      );

      await advanced.click();
      const before = writes.length;
      await remove.click();
      await dialog.waitFor();
      assert.equal(
        await dialog
          .getByRole('button', { name: '取消', exact: true })
          .evaluate((n) => n === document.activeElement),
        true,
        'confirmation defaults to cancel',
      );
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(writes.length, before);
      await remove.click();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(storedKey, 'fixture-replacement');
      assert.equal(writes.length, before);

      // Deleting a saved key must not save an unrelated unfinished form draft.
      const model = page.getByRole('combobox', { name: '模型名称', exact: true });
      await model.fill('unsaved-model');
      await model.press('Escape');
      await remove.click();
      fail = true;
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(storedKey, 'fixture-replacement');
      assert.deepEqual(writes.at(-1), {
        clearApiKey: true,
        expectedRevision: settings.configurationRevision,
      });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      fail = false;
      const nextSave = page.waitForResponse((r) => r.url().endsWith('/api/settings'));
      await page.getByRole('heading', { name: '生成模型', exact: true }).click();
      await (await nextSave).finished();
      await page.locator('[data-save-state="saved"]').waitFor({ state: 'attached' });
      assert.equal(
        writes.at(-1).clearApiKey,
        false,
        'failed deletion is not retried by ordinary autosave',
      );
      assert.equal(storedKey, 'fixture-replacement');
      assert.equal(settings.model, 'unsaved-model');

      await remove.click();
      settings = { ...settings, configurationRevision: settings.configurationRevision + 1 };
      await page.evaluate((settings) => window.receiveSettings(settings), settings);
      const beforeConflict = writes.length;
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await dialog.getByText('设置已变化，请关闭后重新确认。').waitFor();
      assert.equal(
        writes.length,
        beforeConflict,
        'old confirmation does not delete a newly saved key',
      );
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await remove.click();
      const beforeDelete = settings.configurationRevision;
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await key.waitFor();
      assert.equal(storedKey, '');
      assert.deepEqual(writes.at(-1), { clearApiKey: true, expectedRevision: beforeDelete });
      assert.equal(await page.getByRole('button', { name: /显示.*密钥/ }).count(), 0);
      assert.equal(await page.getByText('密钥已配置', { exact: true }).count(), 0);
    } finally {
      await browser.close();
    }
  },
);
