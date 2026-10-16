/* [INPUT]: Actual settings components/CSS, synthetic services and isolated Chromium.
 * [OUTPUT]: Preview continuity, fixed button geometry, truthful outcomes and reduced-motion checks.
 * [POS]: No real credentials, generation, settings writes or host actions.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'settings motion preserves preview geometry and reports only real action success',
  { timeout: 45000 },
  async () => {
    const script = (
      await build({
        stdin: {
          loader: 'jsx',
          resolveDir: process.cwd(),
          contents: `
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{SettingsPreview}from'./ui/settings/settings-preview';
import{SettingsForm}from'./ui/settings/settings-controls';
import{ModelSettings}from'./ui/settings/model-settings';
import{ModelOrganization}from'./ui/settings/model-organization';
import{useSettingsForm}from'./ui/settings/use-settings-form';
import{useSettingsMotion}from'./ui/settings/settings-motion';
import{fixtureSettings}from'./tests/fixtures.mjs';
function App(){const [notice,setNotice]=useState('');const editor=useSettingsForm(false,undefined,({configurationRevision,generationRevision,...v})=>v,setNotice);useEffect(()=>editor.load(fixtureSettings),[]);const ref=useSettingsMotion('test');
return <div className="settings-app" ref={ref}><div style={{width:430}}><SettingsPreview mode="detail" page="features" form={editor.form} dirty={editor.dirty} tasks={null} model={null} view={null} live={true}/></div>
<SettingsForm editor={editor} notify={setNotice} active><ModelSettings editor={editor} simple={false}/></SettingsForm><div role="alert">{notice}</div>
<ModelOrganization state={{preferences:{enabled:true,pinned:[],presets:[],groups:[]},snapshot:{models:[]}}} busy={false} save={async()=>true} refresh={async()=>{const r=await fetch('/refresh');return r.ok}}/>
</div>};createRoot(document.getElementById('root')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
      page.setDefaultTimeout(4000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let generation = true,
        status = 200,
        delay = 320,
        writes = 0;
      let settings = structuredClone(fixtureSettings);
      await page.route('http://motion.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith('/api/') || path === '/refresh') {
          const code = status,
            attempted = generation;
          await new Promise((r) => setTimeout(r, delay));
          let body = {};
          if (path.endsWith('/test')) body = { generationAttempted: attempted, items: [] };
          else if (path.endsWith('/models')) body = { models: ['Alpha', 'Beta'] };
          else if (path === '/api/settings') {
            writes++;
            if (code === 200) {
              const { apiKey, clearApiKey, jevApiKey, clearJevApiKey, expectedRevision, ...patch } =
                JSON.parse(route.request().postData());
              settings = {
                ...settings,
                ...patch,
                configurationRevision: settings.configurationRevision + 1,
              };
            }
            body = settings;
          }
          await route.fulfill({
            status: code,
            contentType: 'application/json',
            body: JSON.stringify(code === 200 ? body : { message: '合成请求失败' }),
          });
        } else await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      });
      await page.goto('http://motion.test/');
      const html = await readFile('target/web/index.html', 'utf8');
      for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
        await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
      await page.addScriptTag({ content: script });
      const preview = page.locator('.preview-frame');
      await preview.waitFor();
      const rect = await preview.boundingBox();
      const tabs = page.getByRole('group', { name: '功能预览' });
      await preview.getByRole('button', { name: /完善实现方案/ }).click();
      for (const name of ['大纲', '看板', '模型快切', '下一步']) {
        await tabs.getByRole('button', { name, exact: true }).click();
        const frames = await page.locator('.preview-scenes').evaluate(async (el) => {
          const samples = [];
          for (let i = 0; i < 16; i++) {
            const b = el.closest('.preview-frame').getBoundingClientRect();
            samples.push({
              height: b.height,
              animations: el.getAnimations({ subtree: true }).map((a) => ({
                duration: a.effect.getTiming().duration,
                frames: a.effect.getKeyframes(),
              })),
            });
            await new Promise(requestAnimationFrame);
          }
          return samples;
        });
        assert.ok(
          frames.every((f) => Math.abs(f.height - rect.height) < 1),
          'frame never changes height',
        );
        assert.ok(
          frames.some((f) => f.animations.some((a) => a.duration === 200)),
          'content has a real transition',
        );
        assert.ok(
          frames
            .flatMap((f) => f.animations)
            .some((a) => a.frames.some((k) => k.transform === 'translateY(4px)')),
        );
        assert.equal(await page.locator('.preview-scene:not([inert])').count(), 1);
      }
      assert.equal(
        await preview.getByRole('status').textContent(),
        '完善实现方案',
        'sample draft survives tabs',
      );
      assert.equal(writes, 0, 'preview changes never write settings');
      // Rapid reversal cancels the previous transition and leaves only the selected scene interactive.
      await tabs.evaluate((el) => {
        el.querySelectorAll('button')[0].click();
      });
      await page.waitForTimeout(35);
      await tabs.evaluate((el) => {
        el.querySelectorAll('button')[2].click();
      });
      await page.waitForTimeout(250);
      assert.equal(
        await page.locator('.preview-scene:not([inert])').getAttribute('data-preview-scene'),
        'board',
      );
      assert.equal(
        await page
          .locator('.preview-scenes')
          .evaluate((el) => el.getAnimations({ subtree: true }).length),
        0,
      );
      const testButton = page.getByRole('button', { name: '测试连接', exact: true });
      const width = (await testButton.boundingBox()).width;
      await testButton.click();
      const pending = page.getByRole('button', { name: '正在测试…', exact: true });
      await pending.waitFor();
      assert.equal(
        (await pending.boundingBox()).width,
        width,
        'pending does not change button width',
      );
      assert.equal(
        await pending.locator('[data-action-state]').getAttribute('data-action-state'),
        'pending',
      );
      await testButton.locator('[data-action-state="success"]').waitFor();
      assert.equal((await testButton.boundingBox()).width, width);
      const iconDurations = await testButton
        .locator('.settings-action-layer')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration);
      assert.match(iconDurations, /0.16s/);
      status = 500;
      await testButton.click();
      await page.getByText(/连接测试失败：合成请求失败/).waitFor();
      assert.equal(
        await testButton.locator('[data-action-state]').getAttribute('data-action-state'),
        'idle',
      );
      status = 200;
      generation = false;
      await testButton.click();
      await page.getByText(/测试未完成/).waitFor();
      assert.equal(
        await testButton.locator('[data-action-state]').getAttribute('data-action-state'),
        'idle',
      );
      const arrow = page.getByRole('button', { name: '选择模型', exact: true });
      const arrowWidth = (await arrow.boundingBox()).width;
      await arrow.click();
      await arrow.locator('[data-action-state="pending"]').waitFor();
      await arrow.locator('[data-action-state="success"]').waitFor();
      assert.equal((await arrow.boundingBox()).width, arrowWidth);
      await page.getByRole('combobox', { name: '模型名称', exact: true }).press('Escape');
      const input = page.getByRole('combobox', { name: '模型名称', exact: true });
      await input.fill('new-model');
      await input.press('Escape');
      const save = page.getByRole('button', { name: '保存设置', exact: true });
      const saveWidth = (await save.boundingBox()).width;
      await save.click();
      await save.locator('[data-action-state="pending"]').waitFor();
      assert.equal((await save.boundingBox()).width, saveWidth);
      await save.locator('[data-action-state="success"]').waitFor();
      assert.equal((await save.boundingBox()).width, saveWidth);
      assert.equal(settings.model, 'new-model');
      await input.fill('retry-model');
      await input.press('Escape');
      status = 500;
      await save.click();
      await page.getByRole('alert').getByText('合成请求失败', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), 'retry-model');
      assert.equal(
        await save.locator('[data-action-state]').getAttribute('data-action-state'),
        'idle',
      );
      await page.getByText('自定义模型分组', { exact: true }).click();
      status = 200;
      const refresh = page.getByRole('button', { name: '刷新可用模型', exact: true });
      await refresh.click();
      await refresh.locator('[data-action-state="pending"]').waitFor();
      await refresh.locator('[data-action-state="success"]').waitFor();
      status = 500;
      await refresh.click();
      await page.waitForTimeout(400);
      assert.equal(
        await refresh.locator('[data-action-state]').getAttribute('data-action-state'),
        'idle',
      );
      // Reduced motion cancels in-flight WAAPI and suppresses spinner/CSS transforms, but keeps state feedback.
      await tabs.getByRole('button', { name: '大纲', exact: true }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(30);
      assert.equal(
        await page
          .locator('.preview-scenes')
          .evaluate((el) => el.getAnimations({ subtree: true }).length),
        0,
      );
      await tabs.getByRole('button', { name: '模型快切', exact: true }).click();
      assert.equal(
        await page
          .locator('.preview-scenes')
          .evaluate((el) => el.getAnimations({ subtree: true }).length),
        0,
      );
      status = 200;
      generation = true;
      await input.fill(settings.model);
      await input.press('Escape');
      await testButton.click();
      await pending.waitFor();
      assert.equal(
        await pending
          .locator('.settings-action-wait')
          .evaluate((el) => getComputedStyle(el).animationName),
        'none',
      );
      assert.ok(
        parseFloat(
          await pending
            .locator('.settings-action-layer')
            .first()
            .evaluate((el) => getComputedStyle(el).transitionDuration),
        ) <= 0.00001,
        'reduced motion has no perceptible transition',
      );
      await testButton.locator('[data-action-state="success"]').waitFor();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await tabs.getByRole('button', { name: '看板', exact: true }).focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page
          .locator('.preview-scenes')
          .evaluate((el) => el.getAnimations({ subtree: true }).length),
        0,
      );
      await mkdir('target/reports', { recursive: true });
      await page.screenshot({ path: 'target/reports/settings-motion-light.png', fullPage: true });
      await page.evaluate(() => (document.documentElement.dataset.settingsTheme = 'dark'));
      await page.screenshot({ path: 'target/reports/settings-motion-dark.png', fullPage: true });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
