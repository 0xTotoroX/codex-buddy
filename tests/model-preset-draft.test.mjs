/* [INPUT]: Real FeatureView/ModelView with synthetic owner handoff and model preferences.
 * [OUTPUT]: Creation/rename drafts survive remount, failed saves and current-model changes; clearing is synchronous.
 * [POS]: Isolated browser regression; no native windows, real host or model requests.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FeatureView} from './ui/surfaces/workspace/feature-session';
window.calls=[]; window.failSave=false; window.sequence=1;
window.alpha={model:'alpha',reasoning:'high',speed:'fast'};
window.beta={model:'beta',reasoning:'low',speed:'standard'};
window.model={revision:1,preferences:{enabled:true,pinned:['alpha','beta'],presets:[{id:'existing',name:'原名称',selection:window.alpha}]},snapshot:{target:{id:'chat'},revision:'r1',status:'ready',message:'',current:window.alpha,models:[{id:'alpha',label:'Alpha',reasoning:['high'],fast:true},{id:'beta',label:'Beta',reasoning:['low'],fast:false}]}};
window.entry={id:'model',owner:'owner-1',placement:'sidebar',open:true,pending:null,view:{},size:[500,400],reveal:0};
const notify=()=>{};
const request=async(input)=>{
  window.calls.push(structuredClone(input));
  if(input.owner!==window.entry.owner) throw Error('stale owner');
  if(input.op==='read') return structuredClone(window.model);
  if(input.op==='action') {
    if(input.action!=='preferences') throw Error('unexpected model action');
    if(window.failSave) throw Error('模拟保存失败');
    if(input.data.revision!==window.model.revision) throw Error('stale revision');
    Object.assign(window.model.preferences,structuredClone(input.data.patch));
    window.model.revision++;
    return structuredClone(window.model);
  }
  return {};
};
window.render=()=>window.root.render(<FeatureView entry={window.entry} owner={window.entry.owner} request={request} onState={notify}/>);
window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.render()};
window.beginMove=()=>{window.entry={...window.entry,pending:{owner:'owner-'+(++window.sequence),placement:window.entry.placement==='sidebar'?'desktop':'sidebar',ready:false}};window.render()};
window.finishMove=()=>{
  const capture=window.calls.findLast(c=>c.op==='handoff'&&c.pendingOwner===window.entry.pending.owner);
  if(!capture) throw Error('missing source handoff');
  window.root.unmount();
  window.entry={...window.entry,owner:window.entry.pending.owner,placement:window.entry.pending.placement,pending:null,view:structuredClone(capture.view)};
  window.model.snapshot.current=window.beta;
  window.mount();
};
window.editAndRemount=(name)=>{
  const input=document.querySelector('input[aria-label="预设名称"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,name);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  window.root.unmount();
  const capture=window.calls.findLast(c=>c.op==='save');
  window.entry={...window.entry,view:structuredClone(capture.view)};
  window.mount();
  return capture.view;
};
window.mount();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  })
).outputFiles[0].text;

async function fixture(browser) {
  const page = await browser.newPage();
  await page.route('http://localhost:19991/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root" style="width:500px;height:400px"></div>',
    }),
  );
  await page.goto('http://localhost:19991/');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: '保存预设', exact: true }).waitFor();
  return page;
}
async function move(page) {
  await page.evaluate(() => window.beginMove());
  await page.waitForFunction(() =>
    window.calls.some((c) => c.op === 'handoff' && c.pendingOwner === window.entry.pending.owner),
  );
  const captured = await page.evaluate(() => window.calls.findLast((c) => c.op === 'handoff'));
  await page.evaluate(() => window.finishMove());
  await page.getByRole('button', { name: '保存预设', exact: true }).waitFor();
  return captured.view;
}

test('new preset draft survives owner handoff, failure, model changes and immediate unmount', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    const input = page.getByRole('textbox', { name: '预设名称' });
    await page.getByRole('button', { name: '保存预设', exact: true }).click();
    await input.fill('新增草稿');
    const first = (await move(page)).modelPresetDraft;
    assert.equal(first.name, '新增草稿');
    assert.equal(first.creating, true);
    assert.ok(first.id);
    assert.deepEqual(first.selection, { model: 'alpha', reasoning: 'high', speed: 'fast' });
    assert.equal(await input.inputValue(), first.name);
    assert.equal(await page.evaluate(() => window.model.snapshot.current.model), 'beta');
    await page.evaluate(() => (window.failSave = true));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
    assert.equal(await input.inputValue(), first.name);
    assert.deepEqual((await move(page)).modelPresetDraft, first);
    assert.equal(await input.inputValue(), first.name);
    // 同一浏览器任务内输入后立即卸载，不能等待被动 effect 才把文字交给 capture。
    const captured = await page.evaluate(() => window.editAndRemount('卸载前最后一次编辑'));
    assert.deepEqual(captured.modelPresetDraft, { ...first, name: '卸载前最后一次编辑' });
    await input.waitFor();
    assert.equal(await input.inputValue(), '卸载前最后一次编辑');
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    const saved = await page.evaluate(() => window.model.preferences.presets.at(-1));
    assert.deepEqual(saved, {
      id: first.id,
      name: '卸载前最后一次编辑',
      selection: first.selection,
    });
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.equal(await input.count(), 0);
  } finally {
    await browser.close();
  }
});

test('rename draft retains identity and captured selection; cancel and Escape clear handoff state', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await fixture(browser);
    const input = page.getByRole('textbox', { name: '预设名称' });
    await page.getByRole('button', { name: '模型工具', exact: true }).click();
    await page.getByRole('button', { name: '重命名预设 原名称' }).click();
    await input.fill('改名草稿');
    const draft = (await move(page)).modelPresetDraft;
    assert.deepEqual(draft, {
      id: 'existing',
      name: '改名草稿',
      selection: { model: 'alpha', reasoning: 'high', speed: 'fast' },
      creating: false,
    });
    assert.equal(await input.inputValue(), draft.name);
    await page.evaluate(() => (window.failSave = true));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
    assert.deepEqual((await move(page)).modelPresetDraft, draft);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.equal(await input.count(), 0);
    assert.equal(await page.evaluate(() => window.model.preferences.presets[0].name), '原名称');
    await page.getByRole('button', { name: '保存预设', exact: true }).click();
    await input.fill('取消创建');
    await input.press('Escape');
    assert.equal((await move(page)).modelPresetDraft, undefined);
    assert.equal(await input.count(), 0);
    await page.getByRole('button', { name: '重命名预设 原名称' }).click();
    await input.fill('保存改名');
    await move(page);
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.model.preferences.presets), [
      { id: 'existing', name: '保存改名', selection: draft.selection },
    ]);
    assert.equal((await move(page)).modelPresetDraft, undefined);
  } finally {
    await browser.close();
  }
});
