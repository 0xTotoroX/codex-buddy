/* [INPUT]: Real settings lists/model fields, synthetic settings service and built CSS.
 * [OUTPUT]: Structural reflow, row identity, provider transitions and immediate accessibility fallback.
 * [POS]: Browser-only fixtures; never reads or changes live configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { emulateMedia, finishAnimations } from './browser-motion.mjs';
import { fixtureSettings } from './fixtures.mjs';

test(
  'configuration motion preserves rows, drafts, geometry and existing saves',
  { timeout: 45000 },
  async () => {
    const script = (
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'jsx',
          contents: `
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{NextSettings}from'./ui/settings/next-settings';import{ModelSettings}from'./ui/settings/model-settings';
import{SettingsForm}from'./ui/settings/settings-controls';import{useSettingsForm}from'./ui/settings/use-settings-form';
import{useSettingsMotion}from'./ui/settings/settings-motion';
import{TaskSettings}from'./ui/settings/task-settings';import{ModelOrganization}from'./ui/settings/model-organization';
function App(){const editor=useSettingsForm(false,undefined,({configurationRevision,generationRevision,...v})=>v,()=>{});useEffect(()=>editor.load(window.fixture),[]);const root=useSettingsMotion('test');
const [columns,setColumns]=useState([{id:'first',title:'首组'},{id:'second',title:'次组'}]);
const [prefs,setPrefs]=useState({groups:[],pinned:[],presets:[]});
return <div className="settings-app" ref={root}><SettingsForm editor={editor} notify={()=>{}} active><ModelSettings editor={editor} simple={false}/><NextSettings editor={editor}/></SettingsForm>
<TaskSettings tasks={{state:{store:{columns,bindings:{calendarId:''},tasks:[]}},command:async({op,title})=>{if(op==='createColumn')setColumns(v=>[...v,{id:'new',title}]);return true}}}/>
<ModelOrganization state={{preferences:prefs, snapshot:{models:[]}}} busy={false} save={async patch=>{setPrefs(v=>({...v,...patch}));return true}} refresh={async()=>true}/></div>}
createRoot(document.getElementById('root')).render(<App/>);`,
        },
        loader: { '.css': 'empty' }, // CSS comes from the built settings entry below.
        bundle: true,
        write: false,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
      })
    ).outputFiles[0].text;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
      page.setDefaultTimeout(4000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let settings = {
        ...structuredClone(fixtureSettings),
        provider: 'codex',
        directionSource: 'manual',
        selectedDirections: fixtureSettings.directionLibrary.slice(0, 2).map((d) => d.id),
        quickPrompts: [
          { label: '重复', prompt: '相同' },
          { label: '重复', prompt: '相同' },
          { label: '保留', prompt: '草稿' },
        ],
      };
      let writes = 0;
      await page.route('https://lists.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/settings') {
          const body = route.request().postDataJSON();
          if (body) {
            writes++;
            const { expectedRevision, apiKey, clearApiKey, jevApiKey, clearJevApiKey, ...patch } =
              body;
            assert.equal(expectedRevision, settings.configurationRevision);
            settings = {
              ...settings,
              ...patch,
              configurationRevision: settings.configurationRevision + 1,
            };
          }
          return route.fulfill({ json: settings });
        }
        if (path.startsWith('/api/')) return route.fulfill({ json: {} });
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      });
      await page.goto('https://lists.test/');
      const html = await readFile('target/web/index.html', 'utf8');
      for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
        await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
      await page.evaluate((fixture) => {
        window.fixture = fixture;
        window.motion = [];
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          const entry = {
            key: this.dataset.settingsListItem,
            list: this.parentElement?.dataset.settingsList,
            field: this.querySelector('label')?.htmlFor,
            frames,
            duration: options.duration,
            easing: options.easing,
            samples: [],
          };
          window.motion.push(entry);
          const animation = animate.call(this, frames, options);
          const sample = () => {
            entry.samples.push(this.getBoundingClientRect().y);
            if (animation.playState === 'running') requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          return animation;
        };
      }, settings);
      await page.addScriptTag({ content: script });
      await page.locator('#provider').waitFor();
      assert.equal(
        (await page.evaluate(() => window.motion)).filter((x) => x.list || x.field).length,
        0,
        'no initial motion',
      );
      const clear = () =>
        page.evaluate(() => {
          window.motion = [];
        });
      const animations = () => page.evaluate(() => window.motion);
      // Provider transition uses the existing elements and does not add a save.
      await clear();
      await page.locator('#provider').selectOption('api');
      let log = await animations();
      assert.ok(log.some((x) => x.field === 'base-url' && x.duration === 180));
      assert.ok(
        log.filter((x) => x.field).every((x) => x.frames[0].transform === 'translateY(4px)'),
      );
      assert.equal(writes, 0, 'animation does not submit provider change');
      const geometry = await page.locator('#base-url').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      await finishAnimations(page.locator('.settings-model-editor'));
      assert.deepEqual(
        await page.locator('#base-url').evaluate((el) => {
          const box = el.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
        geometry,
      );
      await clear();
      await page.locator('#base-url').fill('https://fixture.test/v1');
      assert.equal((await animations()).length, 0, 'typing never replays entry');
      await page.locator('#provider').selectOption('codex');
      await page.locator('#provider').selectOption('api');
      assert.equal(await page.locator('#base-url').inputValue(), 'https://fixture.test/v1');
      await finishAnimations(page.locator('.settings-model-editor'));
      assert.equal(
        await page
          .locator('.settings-model-editor')
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.effect.getTiming().duration === 180).length,
          ),
        0,
      );
      // Deleting the first of two identical prompts preserves the second row's DOM.
      await page
        .getByRole('textbox', { name: '常用提示词 3 内容', exact: true })
        .fill('保留的草稿');
      await page.evaluate(() => {
        window.kept = document.querySelectorAll('[data-settings-list="quick-prompts"] > div')[1];
        window.last = document.querySelectorAll('[data-settings-list="quick-prompts"] > div')[2];
      });
      await clear();
      await page.getByRole('button', { name: '删除常用提示词 1', exact: true }).click();
      const confirmation = page.locator('dialog[open]');
      const beforeDelete = writes;
      if (await confirmation.count())
        await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-settings-list="quick-prompts"] > div').length === 2,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.kept ===
              document.querySelectorAll('[data-settings-list="quick-prompts"] > div')[0] &&
            window.last ===
              document.querySelectorAll('[data-settings-list="quick-prompts"] > div')[1],
        ),
        true,
      );
      assert.equal(
        await page.getByRole('textbox', { name: '常用提示词 2 内容', exact: true }).inputValue(),
        '保留的草稿',
      );
      log = await animations();
      assert.ok(
        log.some(
          (x) =>
            x.list === 'quick-prompts' &&
            x.duration === 200 &&
            x.frames[0].transform.startsWith('translate('),
        ),
        'survivors move',
      );
      await page.waitForTimeout(300); // Cover the save debounce independently of rendering.
      await finishAnimations(page.locator('[data-settings-list="quick-prompts"]'));
      assert.equal(settings.quickPrompts.length, 2, 'deletion stays saved after blur debounce');
      assert.equal(writes, beforeDelete + 1, 'confirmation blur never submits an old draft');
      const moved = (await animations()).filter(
        (x) => x.list === 'quick-prompts' && x.key !== 'add',
      );
      assert.ok(
        moved.some((x) => new Set(x.samples.map((y) => y.toFixed(2))).size > 2),
        'actual row geometry has intermediate frames',
      );
      assert.equal(
        await page
          .locator('[data-settings-list="quick-prompts"]')
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.effect.getTiming().duration === 200).length,
          ),
        0,
      );
      assert.ok(
        settings.quickPrompts.every((p) => Object.keys(p).sort().join(',') === 'label,prompt'),
        'no UI keys in persisted config',
      );
      const beforeAdd = writes;
      await clear();
      await page.getByRole('button', { name: '添加提示词', exact: true }).click();
      log = await animations();
      assert.ok(
        log.some(
          (x) => x.list === 'quick-prompts' && x.duration === 200 && x.frames[0].opacity === 0,
        ),
      );
      assert.equal(writes, beforeAdd, 'adding an empty row does not introduce a save');
      await page.getByRole('textbox', { name: '常用提示词 3 名称', exact: true }).fill('新提示');
      await page.getByRole('textbox', { name: '常用提示词 3 内容', exact: true }).fill('新内容');
      // Existing IDs cover direction reorder/removal without remounting controls.
      await page.getByRole('button', { name: '下移方向 1', exact: true }).scrollIntoViewIfNeeded();
      await clear();
      await page.getByRole('button', { name: '下移方向 1', exact: true }).click();
      log = await animations();
      assert.ok(log.some((x) => x.list === 'direction-slots' && x.duration === 200));
      await page.getByRole('button', { name: '移除方向位置 1', exact: true }).click();
      assert.ok((await animations()).some((x) => x.list === 'direction-slots' && x.key === 'add'));
      const libraryDetails = page
        .locator('details')
        .filter({ has: page.getByText('自定义方向库', { exact: true }) });
      if (await libraryDetails.count()) await libraryDetails.locator('summary').click();
      await clear();
      await page.getByRole('button', { name: '添加自定义方向', exact: true }).click();
      assert.ok(
        (await animations()).some(
          (x) => x.list === 'direction-library' && x.frames[0].opacity === 0,
        ),
      );
      await page.getByRole('textbox', { name: '方向名称 4', exact: true }).fill('新增方向');
      await page.getByRole('textbox', { name: '倾向说明 4', exact: true }).fill('合成方向说明');
      // Board/model grouping use the same motion with successful synthetic persistence.
      await page.getByRole('textbox', { name: '新分组名称', exact: true }).fill('新看板分组');
      await clear();
      await page.getByRole('button', { name: '新增分组', exact: true }).click();
      assert.ok(
        (await animations()).some(
          (x) => x.list === 'board-groups' && x.key === 'new' && x.duration === 200,
        ),
      );
      const groupEntry = page.getByText('自定义模型分组', { exact: true });
      if (await groupEntry.count()) await groupEntry.click();
      else await page.getByRole('button', { name: '模型分组', exact: true }).click();
      await page.getByRole('textbox', { name: '新模型分组名称', exact: true }).fill('新模型组');
      await clear();
      await page
        .locator('#model-organization')
        .getByRole('button', { name: '新增分组', exact: true })
        .click();
      assert.ok((await animations()).some((x) => x.list === 'model-groups' && x.duration === 200));
      const closeGroups = page.getByRole('button', { name: '关闭模型分组', exact: true });
      if (await closeGroups.count()) await closeGroups.click();
      // Reduced motion cancels in flight and performs future operations immediately.
      await emulateMedia(page, { reducedMotion: 'reduce' });
      await clear();
      await page.locator('#provider').selectOption('codex');
      await page.locator('#provider').selectOption('api');
      await page.getByRole('button', { name: '添加提示词', exact: true }).click();
      assert.equal((await animations()).filter((x) => x.field || x.list).length, 0);
      await emulateMedia(page, { reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: '添加提示词', exact: true }).focus();
      await clear();
      await page.keyboard.press('Enter');
      assert.equal(
        (await animations()).filter((x) => x.list).length,
        0,
        'keyboard list actions immediate',
      );
      await page.setViewportSize({ width: 520, height: 900 });
      await page.getByRole('button', { name: '添加提示词', exact: true }).scrollIntoViewIfNeeded();
      await clear();
      // Two clicks in one task deliberately interrupt the first animation.
      await page
        .getByRole('button', { name: '添加提示词', exact: true })
        .dispatchEvent('pointerdown');
      await page
        .getByRole('button', { name: '添加提示词', exact: true })
        .evaluate(async (button) => {
          button.click();
          await new Promise(requestAnimationFrame);
          button.click();
          await new Promise(requestAnimationFrame);
          const active = document
            .querySelector('[data-settings-list="quick-prompts"]')
            .getAnimations({ subtree: true });
          if (!active.length) throw new Error('No reflow animation to cancel');
          active.forEach((a) => a.pause());
        });
      assert.ok((await animations()).some((x) => x.list === 'quick-prompts' && x.duration === 200));
      await emulateMedia(page, { reducedMotion: 'reduce' });
      assert.equal(
        await page
          .locator('[data-settings-list="quick-prompts"]')
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.effect.getTiming().duration === 200).length,
          ),
        0,
        'reduce cancels active reflow',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'narrow page has no horizontal overflow',
      );
      await emulateMedia(page, { reducedMotion: 'no-preference' });
      await page.locator('#provider').focus();
      await page.keyboard.press('ArrowUp');
      await clear();
      await page.locator('#provider').selectOption('codex');
      assert.equal(
        (await animations()).filter((x) => x.field).length,
        0,
        'keyboard provider switching is immediate',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
