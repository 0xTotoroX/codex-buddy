/* [INPUT]: Built local service and synthetic tasks in a temporary data directory.
 * [OUTPUT]: Board/API behavior assertions and light/dark screenshots.
 * [POS]: Isolated regression; never authorizes or writes Apple reminders.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { prepareTestBinary } from '../scripts/verify.mjs';
const root = resolve(import.meta.dirname, '..');
const data = mkdtempSync(join(tmpdir(), 'buddy-board-'));
const report = join(root, 'target/reports/board');
mkdirSync(report, { recursive: true });
const artifact = prepareTestBinary();
let child, browser;
async function start() {
  child = spawn(
    artifact.binary,
    ['--data-dir', data, 'serve', '--port', '0', '--cdp', 'http://127.0.0.1:9'],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const runtime = JSON.parse(readFileSync(join(data, 'runtime.json')));
      const alive = await fetch(`http://127.0.0.1:${runtime.port}/api/state`, {
        headers: { Authorization: `Bearer ${runtime.token}` },
      });
      if (alive.ok) return runtime;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('service did not start');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await done;
}
let runtime = await start();
async function api(path, body) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.message);
  return value;
}
async function command(body) {
  const { store } = await api('tasks/state');
  return api('tasks/command', { revision: store.revision, ...body });
}
const fields = (title) => ({
  title,
  notes: '',
  due: null,
  priority: 0,
  column: 'todo',
  completed: false,
});
try {
  for (const [path, method] of [
    ['state', 'GET'],
    ['command', 'POST'],
  ]) {
    const r = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    assert.equal(r.status, 401);
  }
  await command({ op: 'modules', boardEnabled: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const failures = [];
  page.on('pageerror', (e) => {
    failures.push(e.message);
    console.error(e);
  });
  await page.goto(`http://127.0.0.1:${runtime.port}/board.html#token=${runtime.token}`);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('整理下一次发布');
  await page.getByLabel('备注', { exact: true }).fill('核对功能范围与验收结果。');
  await command({ op: 'windowSize', size: [980, 680] });
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.getByRole('button', { name: '整理下一次发布', exact: true }).waitFor();
  await page.getByLabel('移动 整理下一次发布').selectOption('doing');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="进行中"] .card-title')?.textContent === '整理下一次发布',
  );
  let state = await api('tasks/state');
  assert.equal(state.store.tasks[0].fields.column, 'doing');
  await page.getByRole('button', { name: '整理下一次发布', exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill('调整窗口和其他任务变化后仍可保存。');
  await command({ op: 'modules', boardEnabled: true });
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(
    (await api('tasks/state')).store.tasks[0].fields.notes,
    '调整窗口和其他任务变化后仍可保存。',
  );
  await command({
    op: 'create',
    fields: { ...fields('完善看板交互'), notes: '拖拽卡片，也可以使用阶段菜单。', priority: 1 },
  });
  await command({
    op: 'create',
    fields: {
      ...fields('等待设计反馈'),
      column: 'waiting',
      due: { year: 2026, month: 10, day: 1, hour: null, minute: null, timeZone: null },
    },
  });
  await command({ op: 'create', fields: { ...fields('完成本地数据持久化'), completed: true } });
  await page.reload();
  await page.getByRole('button', { name: '完善看板交互', exact: true }).waitFor();
  await page
    .getByRole('button', { name: '完善看板交互', exact: true })
    .dragTo(page.getByRole('region', { name: '进行中', exact: true }));
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-label="进行中"] .task-card').length === 2,
  );
  await page.screenshot({ path: join(report, 'light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(report, 'dark.png'), fullPage: true });
  assert.equal(await page.locator('.board-column').count(), 3);
  assert.equal(
    await page
      .getByRole('region', { name: '待办', exact: true })
      .getByRole('button', { name: '等待设计反馈', exact: true })
      .count(),
    1,
  );
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByRole('navigation', { name: '任务阶段' }).waitFor();
  assert.deepEqual(await page.locator('.stage-tabs button').allTextContents(), [
    '看板',
    '处理中',
    '归档',
  ]);
  assert.equal(await page.locator('.board-column').count(), 1);
  await page.screenshot({ path: join(report, 'narrow.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '等待设计反馈', exact: true }).click();
  await page.getByRole('button', { name: '归档', exact: true }).last().click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page
    .getByRole('navigation', { name: '任务阶段' })
    .getByRole('button', { name: '归档', exact: true })
    .click();
  await page.getByRole('button', { name: '等待设计反馈', exact: true }).waitFor();
  await stop();
  runtime = await start();
  state = await api('tasks/state');
  assert.equal(state.store.tasks.length, 4);
  assert.equal(state.store.tasks.find((t) => t.fields.title === '等待设计反馈').archived, true);
  const stale = state.store.revision;
  await command({ op: 'modules', boardEnabled: false });
  await assert.rejects(
    () => api('tasks/command', { op: 'create', revision: stale, fields: fields('late') }),
    /刷新/,
  );
  assert.equal((await api('tasks/state')).store.syncEnabled, false);
  await command({ op: 'modules', boardEnabled: true });
  await page.goto(`http://127.0.0.1:${runtime.port}/board.html#token=${runtime.token}`);
  await page
    .getByRole('navigation', { name: '任务阶段' })
    .getByRole('button', { name: '归档', exact: true })
    .click();
  await page.getByRole('button', { name: '完成本地数据持久化', exact: true }).waitFor();
  await page.getByRole('button', { name: '等待设计反馈', exact: true }).click();
  await page.getByRole('button', { name: '取消归档', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page
    .getByRole('navigation', { name: '任务阶段' })
    .getByRole('button', { name: '看板', exact: true })
    .click();
  await page.getByRole('button', { name: '等待设计反馈', exact: true }).waitFor();
  state = await api('tasks/state');
  assert.equal(state.store.tasks.length, 4);
  const legacy = state.store.tasks.find((t) => t.fields.title === '等待设计反馈');
  assert.equal(legacy.fields.column, 'waiting');
  assert.equal(legacy.fields.due.day, 1);
  assert.equal(legacy.archived, false);
  await page.getByRole('button', { name: '等待设计反馈', exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill('保留原截止日期');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(
    (await api('tasks/state')).store.tasks.find((t) => t.id === legacy.id).fields.due,
    legacy.fields.due,
  );
  await assert.rejects(() => command({ op: 'delete', id: legacy.id, confirmBoth: true }), /未知/);
  assert.deepEqual(failures, []);
  writeFileSync(
    join(report, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'authentication',
          'create/edit',
          'column menu',
          'drag/drop',
          'archive',
          'restart persistence',
          'stale revision',
          'module independence',
          'archive restoration and delete rejection',
          'legacy waiting and metadata preservation',
          'light/dark',
          'narrow viewport',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Board API and browser acceptance passed.');
} finally {
  await browser?.close();
  await stop();
  rmSync(data, { recursive: true, force: true });
}
