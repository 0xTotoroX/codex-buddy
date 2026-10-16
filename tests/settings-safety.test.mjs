/* [INPUT]: Actual settings components/save queue and isolated synthetic APIs.
 * [OUTPUT]: Cancellation/confirmation, Jev key preservation and partial-import failure coverage.
 * [POS]: Fake configuration only; never deletes live data or restarts Codex.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'settings require explicit confirmation and preserve secrets, drafts and import progress',
  { timeout: 45000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
import{NextSettings}from'./ui/settings/next-settings';import{ConnectionSettings}from'./ui/settings/connection-settings';
import{SettingsForm}from'./ui/settings/settings-controls';import{useSettingsForm}from'./ui/settings/use-settings-form';
import{TerminologySettings}from'./ui/settings/terminology-settings';import{CodexHostSettings}from'./ui/settings/codex-host-settings';
function App(){const e=useSettingsForm(false,undefined,v=>Object.fromEntries(["enabled", "answerOutlineEnabled", "promptEnhancementEnabled", "generationMode", "hostRestartPolicy", "provider", "protocol", "model", "baseUrl", "apiKeyEnv", "maxItems", "directionSource", "directionLibrary", "selectedDirections", "jev", "quickPrompts", "maxInputChars", "maxOutputTokens", "timeoutMs"].map(key=>[key,v[key]])),()=>{});useEffect(()=>{e.load(window.fixture);window.loadSettings=e.load},[]);
return <div><SettingsForm editor={e} notify={()=>{}} active><NextSettings editor={e}/><ConnectionSettings editor={e} live view={{connection:{status:'connected',endpoint:'9229',targets:[]}}} notify={()=>{}}/></SettingsForm><CodexHostSettings live active/><TerminologySettings active/></div>}
createRoot(document.getElementById('root')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
      })
    ).outputFiles[0].text;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      let settings = {
        ...fixtureSettings,
        directionSource: 'smart',
        storedJevApiKey: true,
        jevKeyConfigured: true,
      };
      let host = {
        enabled: false,
        revision: 1,
        state: 'pendingDisable',
        version: '0.10.2',
        baseline: '0.10.2',
        canRestore: true,
      };
      const terms = {
        entries: [],
        preferences: {
          enabled: false,
          semantic: false,
          autoExpand: false,
          cardStyle: 'matte',
          mastered: [],
          favorites: [],
          revision: 1,
        },
      };
      let failKey = false,
        failPrompt = false,
        failImport = false;
      const writes = [];
      await page.route('http://safety.test/**', async (route) => {
        const url = new URL(route.request().url()),
          body = route.request().postDataJSON();
        if (!url.pathname.startsWith('/api/'))
          return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        if (body) writes.push({ path: url.pathname, body });
        let result = {};
        if (url.pathname === '/api/settings') {
          if (body?.quickPrompts && failPrompt)
            return route.fulfill({ status: 500, json: { message: '合成提示词删除失败' } });
          if (body?.clearJevApiKey && failKey)
            return route.fulfill({ status: 500, json: { message: '合成密钥删除失败' } });
          if (body) {
            assert.equal(body.expectedRevision, settings.configurationRevision);
            const { expectedRevision, apiKey, clearApiKey, jevApiKey, clearJevApiKey, ...patch } =
              body;
            settings = {
              ...settings,
              ...patch,
              configurationRevision: settings.configurationRevision + 1,
            };
            if (clearJevApiKey)
              settings = { ...settings, storedJevApiKey: false, jevKeyConfigured: false };
          }
          result = settings;
        } else if (url.pathname === '/api/codex-host') {
          if (body) {
            assert.equal(body.expectedRevision, host.revision);
            host = { ...host, revision: host.revision + 1 };
          }
          result = host;
        } else if (url.pathname === '/api/terminology') {
          if (body?.action === 'import' && failImport && body.entries[0].id === 'TERM-20')
            return route.fulfill({ status: 400, json: { message: '合成词条冲突' } });
          result = terms;
        }
        await route.fulfill({ json: result });
      });
      await page.goto('http://safety.test/');
      await page.evaluate((value) => (window.fixture = value), settings);
      await page.addScriptTag({ content: script });
      const dialog = page.locator('dialog[open]');
      const cancel = () => dialog.getByRole('button', { name: '取消', exact: true }).click();
      const accept = (label) => dialog.getByRole('button', { name: label, exact: true }).click();
      const jevDelete = page.getByRole('button', { name: '删除已保存的 Jev 密钥', exact: true });
      await page.getByRole('button', { name: '更换 Jev 密钥' }).waitFor();
      assert.equal(await page.locator('input#jev-key').count(), 0);
      await page.getByRole('button', { name: '更换 Jev 密钥' }).click();
      assert.equal(await page.getByRole('button', { name: '显示新密钥' }).count(), 0);
      await page.locator('#jev-key').fill('fixture-new-key');
      await page.getByRole('button', { name: '显示新密钥' }).click();
      assert.equal(writes.length, 0);
      await page.getByRole('button', { name: '取消更换' }).click();
      assert.equal(writes.length, 0);
      await page.getByText('高级设置', { exact: true }).click();
      await jevDelete.click();
      assert.equal(
        await dialog
          .getByRole('button', { name: '取消', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press('Escape');
      assert.equal(writes.length, 0);
      await jevDelete.click();
      await cancel();
      assert.equal(writes.length, 0);
      failKey = true;
      await jevDelete.click();
      await accept('确认删除');
      await dialog.getByRole('alert').filter({ hasText: '合成密钥删除失败' }).waitFor();
      assert.deepEqual(writes.at(-1).body, {
        clearJevApiKey: true,
        expectedRevision: settings.configurationRevision,
      });
      assert.equal(settings.storedJevApiKey, true);
      assert.equal(settings.storedApiKey, fixtureSettings.storedApiKey);
      await cancel();
      const failedCount = writes.length;
      await page.getByRole('heading', { name: '建议方向', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(writes.length, failedCount, 'failed deletion is not retried by blur');
      failKey = false;
      await jevDelete.click();
      await accept('确认删除');
      await page.locator('input#jev-key').waitFor();
      assert.equal(settings.storedJevApiKey, false);
      assert.equal(settings.apiKeyConfigured, true);
      const beforeDirections = structuredClone(settings.directionLibrary);
      await page
        .getByRole('button', { name: `删除方向 ${beforeDirections[0].name}`, exact: true })
        .click();
      await cancel();
      assert.deepEqual(settings.directionLibrary, beforeDirections);
      await page
        .getByRole('button', { name: `删除方向 ${beforeDirections[0].name}`, exact: true })
        .click();
      await accept('确认删除');
      await dialog.waitFor({ state: 'hidden' }).catch(async (error) => {
        throw Error(
          `${error.message}\nDialog: ${await dialog.textContent()}\nWrites: ${JSON.stringify(writes.map((w) => ({ path: w.path, keys: Object.keys(w.body), revision: w.body.expectedRevision })))}`,
        );
      });
      assert.equal(settings.directionLibrary.length, beforeDirections.length - 1);
      assert.equal(settings.selectedDirections.includes(beforeDirections[0].id), false);
      const prompts = structuredClone(settings.quickPrompts);
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      await cancel();
      assert.deepEqual(settings.quickPrompts, prompts);
      failPrompt = true;
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      await accept('确认删除');
      await dialog.getByRole('alert').filter({ hasText: '合成提示词删除失败' }).waitFor();
      assert.deepEqual(settings.quickPrompts, prompts);
      await cancel();
      assert.equal(
        await page.getByRole('textbox', { name: '常用提示词 1 名称', exact: true }).inputValue(),
        prompts[0].label,
      );
      const failedPromptWrites = writes.length;
      await page.getByRole('heading', { name: '建议方向', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(writes.length, failedPromptWrites);
      failPrompt = false;
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      await accept('确认删除');
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(settings.quickPrompts, prompts.slice(1));
      for (const [name, label, path, op] of [
        ['断开', '确认断开', '/api/disconnect', undefined],
        ['重启 Codex 并停用', '确认重启', '/api/codex-host', 'restart-disabled'],
        ['恢复上一版本', '确认恢复', '/api/codex-host', 'restore'],
      ]) {
        const button = page.getByRole('button', { name, exact: true }),
          before = writes.length;
        await button.click();
        await cancel();
        assert.equal(writes.length, before);
        await button.click();
        await accept(label);
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, before + 1);
        assert.equal(writes.at(-1).path, path);
        if (op) assert.equal(writes.at(-1).body.op, op);
      }
      await page.getByText('词库管理', { exact: true }).click();
      assert.equal(
        await page.getByRole('textbox', { name: '中文术语名', exact: true }).isVisible(),
        true,
      );
      const entries = Array.from({ length: 21 }, (_, i) => ({
        id: `TERM-${i}`,
        name: `合成词条${i}`,
        english: '',
        definition: '合成释义',
        aliases: [],
        category: [],
        example: '',
        source: '',
      }));
      const file = {
        name: 'fixture.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(entries)),
      };
      const fileInput = page.locator('input[type=file]');
      const beforeImport = writes.length;
      await fileInput.setInputFiles(file);
      await dialog.getByText(/相同编号的已有释义会被替换/).waitFor();
      await cancel();
      assert.equal(writes.length, beforeImport);
      failImport = true;
      await fileInput.setInputFiles(file);
      await accept('确认导入');
      await dialog.getByRole('alert').filter({ hasText: '已导入 20 条，其余未完成' }).waitFor();
      assert.equal(writes.filter((x) => x.body.action === 'import').length, 2);
      await cancel();
      assert.deepEqual(
        settings.jev,
        fixtureSettings.jev,
        'credential removal retains endpoint/model/consent',
      );
      assert.equal(settings.baseUrl, fixtureSettings.baseUrl);
    } finally {
      await browser.close();
    }
  },
);
