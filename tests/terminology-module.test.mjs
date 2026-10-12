/* [INPUT]: 真实术语积木视图与合成投影。
 * [OUTPUT]: 当前聊天、收藏、掌握的独立过滤及双向操作。
 * [POS]: 不使用真实聊天/模型的浏览器回归。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('terminology bricks preserve independent favorite and mastery states', async () => {
  const js = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{TerminologyView}from'./ui/features/terminology';const reading={};function App(){const[state,set]=useState({entries:[{id:'a',name:'防抖',english:'Debouncing',definition:'输入停止后执行',category:[]},{id:'b',name:'竞态条件',english:'Race Condition',definition:'结果依赖顺序',category:[]}],preferences:{favorites:[],mastered:[]},involved:['a'],context:'one',phase:'ready',message:''});return <TerminologyView state={state} reading={reading} locked={false} action={async({action,id})=>{set(s=>({...s,preferences:{favorites:action==='favorite'?[id]:action==='unfavorite'?[]:s.preferences.favorites,mastered:action==='master'?[id]:action==='restore'?[]:s.preferences.mastered}}));}}/>;}createRoot(document.getElementById('root')).render(<App/>);`,
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
    await page.getByRole('button', { name: '收藏术语', exact: true }).click();
    await page.getByRole('button', { name: '已掌握，不再提示', exact: true }).click();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '防抖', exact: true }).count(), 1);
    await page.getByRole('button', { name: '已掌握', exact: true }).click();
    await page.getByRole('button', { name: '防抖', exact: true }).click();
    await page.getByRole('button', { name: '恢复提示', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '防抖', exact: true }).count(), 0);
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '防抖', exact: true }).count(), 1);
  } finally {
    await browser.close();
  }
});
