/* [INPUT]: 真实术语积木视图与合成投影。
 * [OUTPUT]: 当前聊天、收藏、掌握的独立过滤及双向操作；跳转开关默认、保存失败与侧栏点击行为。
 * [POS]: 不使用真实聊天/模型的浏览器回归。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('settings default to no jump and card clicks use the saved toggle and current context', async () => {
  const js = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
        import{TerminologySettings}from'./ui/settings/terminology-settings';
        import{TerminologyView}from'./ui/features/terminology';
        window.actions=[];const reading={};function App(){const[state,set]=useState(window.initial);
        window.project=(preferences)=>set(s=>({...s,preferences}));
        return <><section style={{position:'fixed',inset:'0 40% 0 0',overflow:'auto'}}><TerminologySettings active={true}/></section><aside id="sidebar" style={{position:'fixed',inset:'0 0 0 60%',overflow:'auto'}}><TerminologyView state={state} reading={reading} locked={false}
          action={async(data)=>{window.actions.push(data);return state;}}/></aside><main id="chat"/></>}
        createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
    })
  ).outputFiles[0].text;
  const state = {
    entries: [
      {
        id: 'a',
        name: '防抖',
        english: 'Debouncing',
        definition: '停止输入后执行',
        category: [],
        aliases: [],
      },
    ],
    preferences: {
      enabled: true,
      semantic: false,
      autoExpand: false,
      mastered: [],
      favorites: [],
      revision: 0,
    },
    involved: ['a'],
    context: 'chat-one',
    phase: 'ready',
    message: '',
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let rejectSave = false;
    await page.route('http://terms.test/**', async (route) => {
      if (!route.request().url().includes('/api/terminology'))
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      if (route.request().method() === 'POST') {
        if (rejectSave)
          return route.fulfill({ status: 409, json: { ok: false, message: '模拟设置冲突' } });
        const patch = route.request().postDataJSON();
        assert.equal(patch.revision, state.preferences.revision);
        assert.deepEqual(Object.keys(patch).sort(), ['action', 'jumpOnClick', 'revision']);
        Object.assign(state.preferences, {
          jumpOnClick: patch.jumpOnClick,
          revision: patch.revision + 1,
        });
        await page.evaluate((prefs) => window.project(prefs), state.preferences);
      }
      await route.fulfill({ json: state });
    });
    await page.goto('http://terms.test/');
    await page.evaluate((state) => {
      window.initial = state;
    }, state);
    await page.addScriptTag({ content: js });
    const toggle = page.getByRole('switch', { name: '点击术语时跳转到上下文' });
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(), false);
    const card = page.locator('.term-brick');
    await card.click();
    await page.getByRole('dialog', { name: '防抖释义' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.actions), []);
    await page.keyboard.press('Escape');
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('#terms-jump-on-click')?.getAttribute('aria-checked') === 'true',
    );
    await card.focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.actions), [
      { action: 'locate', id: 'a', context: 'chat-one' },
    ]);
    await page.getByRole('dialog', { name: '防抖释义' }).waitFor();
    await page.locator('#chat').dispatchEvent('scroll');
    assert.equal(await page.getByRole('dialog', { name: '防抖释义' }).isVisible(), true);
    await page.locator('#sidebar').dispatchEvent('scroll');
    await page.getByRole('dialog', { name: '防抖释义' }).waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    rejectSave = true;
    await toggle.click();
    await page.getByRole('alert').filter({ hasText: '模拟设置冲突' }).waitFor();
    assert.equal(await toggle.isChecked(), true, 'failed save preserves enabled state');
    rejectSave = false;
    await toggle.click();
    await page.waitForFunction(
      () =>
        document.querySelector('#terms-jump-on-click')?.getAttribute('aria-checked') === 'false',
    );
    await card.click();
    assert.equal(await page.evaluate(() => window.actions.length), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('terminology bricks preserve independent favorite and mastery states', async () => {
  const js = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{TerminologyView}from'./ui/features/terminology';window.__codexBuddyTerminology={typography:()=>({fontFamily:'Arial',fontSize:16,fontWeight:'430',lineHeight:26,zoom:1.3})};const reading={};function App(){const[state,set]=useState({entries:[{id:'a',name:'防抖',english:'Debouncing',definition:'输入停止后执行',category:[]},{id:'b',name:'竞态条件',english:'Race Condition',definition:'结果依赖顺序',category:[]}],preferences:{favorites:[],mastered:[]},involved:['a'],context:'one',phase:'ready',message:''});return <TerminologyView state={state} reading={reading} locked={false} action={async({action,id})=>{set(s=>({...s,preferences:{favorites:action==='favorite'?[id]:action==='unfavorite'?[]:s.preferences.favorites,mastered:action==='master'?[id]:action==='restore'?[]:s.preferences.mastered}}));}}/>;}createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 330, height: 600 } });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: js });
    await page.getByRole('button', { name: '防抖', exact: true }).click();
    assert.equal(await page.getByText('输入停止后执行').count(), 1);
    assert.deepEqual(
      await page.locator('.term-card').evaluate((c) => ({
        zoom: getComputedStyle(c).zoom,
        font: getComputedStyle(c.querySelector('p')).fontFamily,
        size: getComputedStyle(c.querySelector('p')).fontSize,
      })),
      { zoom: '1.3', font: 'Arial', size: '16px' },
    );
    await page.getByRole('button', { name: '收藏术语', exact: true }).click();
    await page.getByRole('button', { name: '已掌握，不再提示', exact: true }).click();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '防抖', exact: true }).count(), 1);
    await page.getByRole('button', { name: '已掌握', exact: true }).click();
    await page.getByRole('button', { name: '防抖', exact: true }).click();
    await page.getByRole('button', { name: '恢复提示', exact: true }).click();
    await page.getByRole('button', { name: '防抖', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '防抖', exact: true }).count(), 0);
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '防抖', exact: true }).count(), 1);
  } finally {
    await browser.close();
  }
});
