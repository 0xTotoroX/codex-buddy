/* [INPUT]: Real Board component and synthetic task transport with controlled failures.
 * [OUTPUT]: Priority/details, retained drafts, external conflicts and remount recovery checks.
 * [POS]: Browser-only regression; never touches user tasks or Apple reminders.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const script = (
  await build({
    stdin: {
      loader: 'tsx',
      resolveDir: process.cwd(),
      contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{Board}from'./ui/features/board/app';
const task={id:'a',fields:{title:'合成任务',notes:'原备注',priority:3,due:{year:2026,month:10,day:20,hour:9,minute:30,timeZone:'Asia/Shanghai'},column:'todo',completed:false},archived:false,deleteRequested:false,remote:null,remoteMissing:false,conflict:null};
window.fixture={state:{store:{revision:1,boardEnabled:true,syncEnabled:false,bindings:{calendarId:''},tasks:[task],inflight:null},status:'fixture'},writes:[],fail:false,view:{search:'',stage:'todo',tab:'board'}};
const request=async(path,body)=>{const f=window.fixture;if(body){f.writes.push(structuredClone(body));if(f.fail)throw Error('合成保存失败');if(body.expectedTask&&JSON.stringify(body.expectedTask)!==JSON.stringify(f.state.store.tasks[0]))throw Error('任务冲突');f.state.store.tasks[0]={...f.state.store.tasks[0],fields:body.fields};f.state.store.revision++;}return structuredClone(f.state)};
let root;window.mount=()=>{root=createRoot(document.getElementById('root'));root.render(<Board request={request} view={window.fixture.view}/>)};window.unmount=()=>root.unmount();window.mount();
`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
).outputFiles[0].text;
test('board details preserve fields, drafts and priority through failure, external change and handoff', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(6000);
  try {
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: readFileSync('ui/features/board/styles.css', 'utf8') });
    await page.addScriptTag({ content: script });
    const open = () =>
      page.getByRole('button', { name: '任务详情：合成任务', exact: true }).click();
    await open();
    const dialog = page.getByRole('dialog', { name: '任务详情' });
    await dialog.waitFor();
    assert.equal(await page.getByLabel('优先级', { exact: true }).inputValue(), '3');
    assert.equal(await page.getByLabel('时间（可选）').inputValue(), '09:30');
    await page.getByLabel('备注', { exact: true }).fill('未保存草稿');
    await page.evaluate(() => {
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        input,
        '未保存草稿',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.unmount();
      window.mount();
    });
    await dialog.waitFor();
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '未保存草稿');
    await page.getByRole('button', { name: '关闭任务详情' }).click();
    assert.equal(await page.evaluate(() => window.fixture.writes.length), 0);
    await open();
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '未保存草稿');
    await page.getByLabel('优先级', { exact: true }).selectOption('5');
    await page.evaluate(() => {
      window.fixture.fail = true;
    });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '合成保存失败' }).waitFor();
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '未保存草稿');
    await page.evaluate(() => {
      window.unmount();
      window.mount();
    });
    await dialog.waitFor();
    assert.equal(await page.getByLabel('优先级', { exact: true }).inputValue(), '5');
    await page.evaluate(() => {
      window.fixture.fail = false;
    });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.fixture.state.store.tasks[0]);
    assert.equal(saved.fields.notes, '未保存草稿');
    assert.equal(saved.fields.priority, 5);
    assert.equal(saved.fields.due.timeZone, 'Asia/Shanghai');
    assert.equal(saved.fields.column, 'todo');
    await open();
    await page.getByLabel('备注', { exact: true }).fill('冲突前草稿');
    await page.evaluate(() => {
      window.fixture.state.store.tasks[0].fields.notes = '外部修改';
      window.fixture.state.store.revision++;
      window.dispatchEvent(new Event('focus'));
    });
    await dialog.getByRole('alert').filter({ hasText: '其他位置更新' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '冲突前草稿');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: '重新载入' }).click();
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '冲突前草稿');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '重新载入' }).click();
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '外部修改');
    mkdirSync('target/reports/board-details', { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: 'target/reports/board-details/' + theme + '.png' });
    }
    await page.setViewportSize({ width: 360, height: 640 });
    assert.equal(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth), true);
    await page.screenshot({ path: 'target/reports/board-details/narrow.png' });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('button', { name: '任务详情：合成任务', exact: true })
        .evaluate((n) => document.activeElement === n),
      true,
    );
  } finally {
    await browser.close();
  }
});
