/* [INPUT]: Matching test binary, isolated Chrome fixture and optional AppKit window probe.
 * [OUTPUT]: Real HTTP/CDP feature ownership, draft handoff, native readiness and task independence.
 * [POS]: Isolated end-to-end acceptance; no real chat, model requests or EventKit writes.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { prepareTestBinary } from '../scripts/verify.mjs';
const root = resolve(import.meta.dirname, '..'),
  artifact = prepareTestBinary(),
  native = process.argv.includes('--native');
const directory = mkdtempSync(join(tmpdir(), 'buddy-features-')),
  output = join(root, 'target/reports', native ? 'independent-native' : 'features-e2e');
mkdirSync(output, { recursive: true });
const report = { artifact, native, passed: false, checks: [] },
  record = (name) => {
    report.checks.push(name);
    console.log(`PASS ${name}`);
  };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label) {
  for (let i = 0; i < 150; i++) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw Error(label);
}
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(readFileSync(join(root, 'tests/host-fixture.html')));
});
let chrome, browser, service, runtime;
try {
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
  const reserve = createServer();
  await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
  const debugPort = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  chrome = await chromium.launchServer({
    executablePath: existsSync(executablePath) ? executablePath : undefined,
    headless: true,
    args: [`--remote-debugging-port=${debugPort}`],
  });
  browser = await chromium.connect(chrome.wsEndpoint());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${fixture.address().port}/fixture`);
  await page.evaluate(() => {
    const workspace = document.querySelector('.workspace');
    workspace.classList.add('app-shell-main-content-frame');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:row;height:100%;min-width:0';
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;height:100%';
    content.append(...workspace.childNodes);
    content.append(content.querySelector('.composer'));
    row.append(content);
    workspace.append(row);
  });
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.detach();
  writeFileSync(
    join(directory, 'config.json'),
    JSON.stringify({
      cdpEndpoint: `http://127.0.0.1:${debugPort}`,
      targetId: targetInfo.targetId,
      stepwise: { enabled: false, answerOutlineEnabled: true, generationMode: 'manual' },
    }),
  );
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CODEX_BUDDY_|COMPANION_)/.test(key)) delete env[key];
  env.CODEX_BUDDY_PANEL_TEST = '1';
  service = spawn(
    artifact.binary,
    ['--data-dir', directory, 'serve', '--port', '0', '--allow-fixture'],
    { env, stdio: 'ignore' },
  );
  runtime = await wait(() => {
    try {
      return JSON.parse(readFileSync(join(directory, 'runtime.json'), 'utf8'));
    } catch {
      return null;
    }
  }, 'service startup');
  const base = `http://127.0.0.1:${runtime.port}`;
  async function api(path, data) {
    const response = await fetch(`${base}/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.message || JSON.stringify(value));
    return value;
  }
  const state = () => api('features', { op: 'state' }),
    entry = async (id) => (await state()).features.find((e) => e.id === id);
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.runtimeActive);
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.outlineItems.length > 0);
  let tasks = await api('tasks/state');
  await api('tasks/command', {
    op: 'modules',
    revision: tasks.store.revision,
    boardEnabled: true,
    syncEnabled: false,
  });
  tasks = await api('tasks/state');
  await api('tasks/command', {
    op: 'create',
    revision: tasks.store.revision,
    fields: {
      title: '隔离验收任务',
      notes: '保留原内容',
      due: null,
      priority: 0,
      column: 'todo',
      completed: false,
    },
  });
  await api('features', { op: 'move', id: 'outline', placement: 'sidebar' });
  await wait(async () => {
    const e = await entry('outline');
    return e?.open && !e.pending;
  }, 'outline ready');
  await api('features', { op: 'move', id: 'board', placement: 'overlay' });
  await wait(async () => {
    const e = await entry('board');
    return e?.open && !e.pending;
  }, 'board ready');
  const board = page.locator('[data-feature="board"]');
  await board.getByRole('button', { name: '隔离验收任务', exact: true }).click();
  await board.getByLabel('标题', { exact: true }).fill('仍未保存的草稿');
  await board.getByLabel('备注', { exact: true }).fill('不写入 Apple 或任务服务');
  await board.getByRole('button', { name: '保留草稿并返回' }).click();
  const before = await api('tasks/state');
  const original = await entry('board');
  const destination = native ? 'desktop' : 'sidebar';
  await api('features', { op: 'move', id: 'board', placement: destination });
  const moved = await wait(async () => {
    const e = await entry('board');
    return e.placement === destination && !e.pending && e;
  }, 'destination automatically ready');
  assert.notEqual(moved.owner, original.owner);
  assert.equal(moved.view.board.editor.draft.title, '仍未保存的草稿');
  assert.deepEqual((await api('tasks/state')).store, before.store);
  record('external placement waits for source draft and commits a new owner without task writes');
  await assert.rejects(() =>
    api('features', {
      op: 'action',
      id: 'board',
      owner: original.owner,
      data: { op: 'archive', id: before.store.tasks[0].id, archived: true },
    }),
  );
  record('late source writes are rejected');
  if (native) {
    const lease = await api('features', { op: 'window', id: 'board', owner: moved.owner });
    assert.ok(lease.pid);
    const helper = join(directory, 'native-probe');
    execFileSync('swiftc', ['tests/native-probe.swift', '-o', helper], { cwd: root });
    const windows = await wait(() => {
      const rows = JSON.parse(
        execFileSync(helper, ['windows', String(lease.pid)], { encoding: 'utf8' }),
      );
      return rows.some((w) => w.kCGWindowBounds.Width >= 320) && rows;
    }, 'native feature window visible');
    report.windows = windows;
    assert.ok(windows.some((w) => w.kCGWindowBounds.Width >= 320));
    record('actual Wry window loaded the feature page and completed readiness');
    const revealed = await api('features', { op: 'reveal', id: 'board' });
    assert.equal(revealed.features.find((e) => e.id === 'board').owner, moved.owner);
    assert.equal(
      (await api('features', { op: 'window', id: 'board', owner: moved.owner })).pid,
      lease.pid,
    );
    record('reveal reuses the native process');
  }
  await api('features', { op: 'move', id: 'board', placement: 'overlay' });
  await wait(async () => {
    const e = await entry('board');
    return e.placement === 'overlay' && !e.pending;
  }, 'return to host');
  await board.getByRole('button', { name: '继续编辑草稿' }).click();
  assert.equal(await board.getByLabel('标题', { exact: true }).inputValue(), '仍未保存的草稿');
  await board.getByRole('button', { name: '保留草稿并返回' }).click();
  record('round trip restores the original unsaved task snapshot and draft');
  if (native) {
    const helper = join(directory, 'native-probe');
    for (const id of ['outline', 'next', 'model']) {
      if (id === 'model') {
        const model = await api('model-control/state');
        await api('model-control/preferences', {
          revision: model.revision,
          patch: { enabled: true },
        });
      }
      await api('features', { op: 'move', id, placement: 'desktop' });
      const feature = await wait(async () => {
        const e = await entry(id);
        return e?.placement === 'desktop' && !e.pending && e;
      }, `${id} native ready`);
      const lease = await api('features', { op: 'window', id, owner: feature.owner });
      await wait(
        () =>
          JSON.parse(
            execFileSync(helper, ['windows', String(lease.pid)], { encoding: 'utf8' }),
          ).some((w) => w.kCGWindowBounds.Width >= 320),
        `${id} native visible`,
      );
      await api('features', { op: 'move', id, placement: 'sidebar' });
      await wait(async () => {
        const e = await entry(id);
        return e.placement === 'sidebar' && !e.pending;
      }, `${id} returned`);
      record(`${id} native view automatically readies and returns to sidebar`);
    }
  }
  if (native) {
    for (const id of ['board', 'outline', 'next', 'model']) {
      await api('features', { op: 'move', id, placement: 'edge' });
      await wait(async () => {
        const e = await entry(id);
        return e?.placement === 'edge' && !e.pending;
      }, `${id} edge ready`);
    }
    assert.equal((await entry('board')).view.board.editor.draft.title, '仍未保存的草稿');
    await api('model-control/close', {});
    assert.equal((await entry('model')).open, false);
    const boardOwner = (await entry('board')).owner;
    assert.equal((await entry('board')).open, true);
    assert.equal(
      (await api('features', { op: 'read', id: 'board', owner: boardOwner })).store.tasks.length,
      1,
    );
    await api('features', { op: 'move', id: 'board', placement: 'overlay' });
    await wait(async () => {
      const e = await entry('board');
      return e.placement === 'overlay' && !e.pending;
    }, 'board returns from edge');
    await board.getByRole('button', { name: '继续编辑草稿' }).click();
    assert.equal(await board.getByLabel('标题', { exact: true }).inputValue(), '仍未保存的草稿');
    await board.getByRole('button', { name: '保留草稿并返回' }).click();
    await assert.rejects(() =>
      api('features', { op: 'save', id: 'board', owner: boardOwner, view: {} }),
    );
    assert.deepEqual((await api('tasks/state')).store, before.store);
    record(
      'all four features share edge, disabling model preserves board, edge round trip retains draft and rejects stale owner',
    );
  }
  await page.screenshot({ path: join(output, 'independent-surfaces.png') });
  await api('disconnect', {});
  const current = await entry('board');
  const read = await api('features', { op: 'read', id: 'board', owner: current.owner });
  assert.equal(read.store.tasks.length, 1);
  const task = read.store.tasks[0];
  await api('features', {
    op: 'action',
    id: 'board',
    owner: current.owner,
    data: {
      op: 'update',
      revision: read.store.revision,
      id: task.id,
      expectedTask: task,
      fields: { ...task.fields, column: 'doing' },
    },
  });
  assert.equal((await api('tasks/state')).store.tasks[0].fields.column, 'doing');
  assert.equal((await api('tasks/state')).store.syncEnabled, false);
  record('board editing remains available without chat and keeps Apple sync paused');
  assert.deepEqual(errors, []);
  report.passed = true;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (service) {
    service.kill('SIGTERM');
    await delay(1000);
    if (service.exitCode === null) service.kill('SIGKILL');
  }
  await browser?.close();
  await chrome?.close();
  fixture.closeAllConnections();
  await new Promise((r) => fixture.close(r));
  rmSync(directory, { recursive: true, force: true });
}
