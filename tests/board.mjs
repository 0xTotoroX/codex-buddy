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
  browser = await chromium.launch({
    ...(process.env.CODEX_BUDDY_CHROME_BIN
      ? { executablePath: process.env.CODEX_BUDDY_CHROME_BIN }
      : { channel: 'chrome' }),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const failures = [];
  page.on('pageerror', (e) => {
    failures.push(e.message);
    console.error(e);
  });
  await page.goto(`http://127.0.0.1:${runtime.port}/board.html#token=${runtime.token}`);
  await page
    .getByRole('region', { name: '待办', exact: true })
    .getByRole('button', { name: '新建任务', exact: true })
    .click();
  await page.getByLabel('新任务标题', { exact: true }).fill('整理下一次发布');
  await command({ op: 'windowSize', size: [980, 680] });
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByText('整理下一次发布', { exact: true }).waitFor();
  await page
    .getByText('整理下一次发布', { exact: true })
    .dragTo(page.getByRole('region', { name: '进行中', exact: true }));
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="进行中"] .card-title')?.textContent === '整理下一次发布',
  );
  let state = await api('tasks/state');
  assert.equal(state.store.tasks[0].fields.column, 'doing');
  await page.getByText('整理下一次发布', { exact: true }).click();
  assert.equal(await page.locator('dialog').count(), 0, 'task click has no detail modal');
  const remove = page.getByRole('button', { name: '删除任务：整理下一次发布', exact: true });
  await page.mouse.move(0, 0);
  await remove.evaluate(async (node) => {
    while (getComputedStyle(node).opacity !== '0') await new Promise((r) => setTimeout(r, 20));
  });
  await page.getByText('整理下一次发布', { exact: true }).hover();
  await remove.evaluate(async (node) => {
    while (getComputedStyle(node).opacity !== '1') await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(await remove.evaluate((node) => getComputedStyle(node).pointerEvents), 'auto');
  await page.mouse.move(0, 0);
  await remove.focus();
  await remove.evaluate(async (node) => {
    while (getComputedStyle(node).opacity !== '1') await new Promise((r) => setTimeout(r, 20));
  });
  await command({
    op: 'create',
    fields: { ...fields('完善看板交互'), notes: '拖拽卡片。', priority: 1 },
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
  await page.getByText('完善看板交互', { exact: true }).waitFor();
  await page
    .getByText('完善看板交互', { exact: true })
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
      .getByText('等待设计反馈', { exact: true })
      .count(),
    1,
  );
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByRole('navigation', { name: '任务阶段' }).waitFor();
  assert.deepEqual(await page.locator('.stage-tabs button').allTextContents(), [
    '待办',
    '进行中',
    '完成',
  ]);
  assert.equal(await page.locator('.board-column').count(), 1);
  await page.screenshot({ path: join(report, 'narrow.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await command({
    op: 'archive',
    id: (await api('tasks/state')).store.tasks.find((t) => t.fields.title === '等待设计反馈').id,
    archived: true,
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: '任务阶段' })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await page.getByText('等待设计反馈', { exact: true }).waitFor();
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
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await page.getByText('完成本地数据持久化', { exact: true }).waitFor();
  await page
    .getByText('等待设计反馈', { exact: true })
    .dragTo(
      page
        .getByRole('navigation', { name: '任务阶段' })
        .getByRole('button', { name: '待办', exact: true }),
    );
  await page
    .getByRole('navigation', { name: '任务阶段' })
    .getByRole('button', { name: '待办', exact: true })
    .click();
  await page.getByText('等待设计反馈', { exact: true }).waitFor();
  state = await api('tasks/state');
  assert.equal(state.store.tasks.length, 4);
  const legacy = state.store.tasks.find((t) => t.fields.title === '等待设计反馈');
  assert.equal(legacy.fields.column, 'todo');
  assert.equal(legacy.fields.due.day, 1);
  assert.equal(legacy.archived, false);
  // Group personalization belongs to settings; the board keeps stable IDs and live tasks.
  assert.equal(await page.getByRole('button', { name: '新增分组', exact: true }).count(), 0);
  const settings = await browser.newPage({ viewport: { width: 980, height: 900 } });
  await settings.goto(`http://127.0.0.1:${runtime.port}/#token=${runtime.token}`);
  await settings.getByRole('link', { name: '看板', exact: true }).click();
  await settings.getByText('看板分组', { exact: true }).click();
  await settings.getByLabel('分组名称：待办', { exact: true }).fill('准备做');
  await settings.getByRole('button', { name: '保存分组：待办', exact: true }).click();
  await settings.getByLabel('分组名称：准备做', { exact: true }).waitFor();
  await settings.getByLabel('新分组名称', { exact: true }).fill('等待确认');
  await settings.getByRole('button', { name: '新增分组', exact: true }).click();
  await settings.getByLabel('分组名称：等待确认', { exact: true }).waitFor();
  await settings
    .locator('#settings-tasks')
    .screenshot({ path: join(report, 'group-settings.png') });
  await settings.close();
  const groupTab = page
    .getByRole('navigation', { name: '任务阶段' })
    .getByRole('button', { name: '等待确认', exact: true });
  await page.getByText('等待设计反馈', { exact: true }).dragTo(groupTab);
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="等待确认"] .card-title')?.textContent === '等待设计反馈',
  );
  state = await api('tasks/state');
  const custom = state.store.columns.find((c) => c.title === '等待确认');
  assert.equal(state.store.tasks.find((t) => t.id === legacy.id).fields.column, custom.id);
  assert.equal(state.store.tasks.find((t) => t.id === legacy.id).fields.completed, false);
  await page
    .getByText('等待设计反馈', { exact: true })
    .dragTo(
      page
        .getByRole('navigation', { name: '任务阶段' })
        .getByRole('button', { name: '完成', exact: true }),
    );
  await page.waitForFunction(
    () => document.querySelector('[aria-label="完成"] .card-title')?.textContent,
  );
  assert.equal(
    (await api('tasks/state')).store.tasks.find((t) => t.id === legacy.id).fields.completed,
    true,
  );
  const removedId = legacy.id;
  await page.getByText('等待设计反馈', { exact: true }).hover();
  await page.getByRole('button', { name: '删除任务：等待设计反馈', exact: true }).click();
  await page.getByText('等待设计反馈', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(
    (await api('tasks/state')).store.tasks.some((task) => task.id === removedId),
    false,
  );
  assert.equal(await page.locator('dialog').count(), 0);
  await page.screenshot({ path: join(report, 'custom-narrow.png'), fullPage: true });
  await stop();
  runtime = await start();
  state = await api('tasks/state');
  assert.equal(state.store.columns.find((c) => c.id === 'todo').title, '准备做');
  assert.equal(state.store.columns.find((c) => c.id === custom.id).title, '等待确认');
  assert.equal(state.store.tasks.length, 3);
  await assert.rejects(() => command({ op: 'delete', id: legacy.id, confirmBoth: true }), /未知/);
  assert.deepEqual(failures, []);
  writeFileSync(
    join(report, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'authentication',
          'inline create, no details, hover/focus removal',
          'inline creation and title-only cards',
          'custom group names and persistence',
          'narrow tab drop',
          'drag/drop',
          'archive',
          'restart persistence',
          'stale revision',
          'module independence',
          'drag restores archive; local deletion persists; dual deletion rejected',
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
