/* [INPUT]: Current CLI binary, isolated local service and synthetic credentials/tasks.
 * [OUTPUT]: JSON discovery, real service writes, stale/danger rejection and persistence checks.
 * [POS]: Never reads installed configuration or connects to a real host or reminders account.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareTestBinary } from '../scripts/verify.mjs';
const exec = promisify(execFile);
const { binary } = prepareTestBinary();
const data = await mkdtemp(join(tmpdir(), 'buddy-config-cli-'));
let child;
const cli = async (...args) =>
  JSON.parse(
    (await exec(binary, ['--data-dir', data, 'config', ...args], { maxBuffer: 4 * 1024 * 1024 }))
      .stdout,
  );
const set = (scope, patch, ...args) => cli('set', scope, '--json', JSON.stringify(patch), ...args);
async function start() {
  child = spawn(
    binary,
    ['--data-dir', data, 'serve', '--port', '0', '--cdp', 'http://127.0.0.1:9'],
    { stdio: 'ignore' },
  );
  for (let n = 0; n < 100; n++) {
    try {
      await cli('get', 'settings');
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('fixture service unavailable');
}
async function stop() {
  if (child?.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await done;
  }
}
try {
  const schema = await cli('schema');
  assert.equal(schema.length, 9);
  await assert.rejects(() => cli('get', 'settings'), /后台未运行/);
  await start();
  const original = await cli('get', 'settings');
  const dry = await set('settings', { generationMode: 'manual' }, '--dry-run');
  assert.equal(dry.dryRun, true);
  assert.equal(
    (await cli('get', 'settings')).configurationRevision,
    original.configurationRevision,
  );
  await assert.rejects(
    () =>
      set('settings', { model: 'ignored', expectedRevision: original.configurationRevision + 1 }),
    /修订已变化/,
  );
  await assert.rejects(() => set('appearance', { setingsTheme: 'dark' }), /未知/);
  await assert.rejects(() => set('settings', { clearApiKey: true }), /明确确认/);
  const secretPath = join(data, 'input.json');
  await writeFile(
    secretPath,
    JSON.stringify({ apiKey: 'fixture-key-never-in-output', generationMode: 'manual' }),
    { mode: 0o600 },
  );
  const preview = await cli('set', 'settings', '--file', secretPath, '--dry-run');
  assert.equal(preview.patch.apiKey, '[redacted]');
  const secretResult = await cli('set', 'settings', '--file', secretPath);
  assert.ok(!JSON.stringify(secretResult).includes('fixture-key-never-in-output'));
  const changed = await set('settings', { maxItems: 4 });
  assert.equal(changed.current.maxItems, 4);
  assert.equal(changed.current.storedApiKey, true);
  const appearance = await cli('get', 'appearance');
  assert.equal(appearance.settingsTheme, null);
  const dark = await set('appearance', { settingsTheme: 'dark' });
  assert.equal(dark.current.settingsTheme, 'dark');
  assert.deepEqual(dark.current.ui, appearance.ui);
  await assert.rejects(() => set('appearance', { settingsTheme: 'other' }), /主题无效/);
  assert.equal((await cli('get', 'appearance')).settingsTheme, 'dark');
  await set('tasks', { op: 'modules', boardEnabled: true });
  const created = await set('tasks', {
    op: 'create',
    fields: {
      title: 'CLI 合成任务',
      notes: '保留说明',
      priority: 3,
      due: { year: 2026, month: 10, day: 20, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
    },
  });
  const task = created.current.store.tasks[0];
  const edited = await set('tasks', { op: 'update', id: task.id, fields: { priority: 5 } });
  assert.equal(edited.current.store.tasks[0].fields.priority, 5);
  assert.equal(edited.current.store.tasks[0].fields.notes, '保留说明');
  assert.equal(edited.current.store.tasks[0].fields.due.timeZone, 'Asia/Shanghai');
  await assert.rejects(
    () =>
      set('tasks', { op: 'update', id: task.id, expectedTask: task, fields: { title: 'stale' } }),
    /修订已变化/,
  );
  await assert.rejects(() => set('tasks', { op: 'remove', id: task.id }), /明确确认/);
  assert.equal((await cli('get', 'tasks')).store.tasks.length, 1);
  await set('terminology', { jumpOnClick: false });
  const surface = await cli('get', 'surfaces');
  await set('surfaces', {
    placement: 'sidebar',
    theme: { theme: 'matte', liquidVariant: 'regular' },
  });
  const latest = await cli('get', 'surfaces');
  assert.equal(latest.preferences.themes.sidebar.theme, 'matte');
  assert.deepEqual(latest.preferences.themes.desktop, surface.preferences.themes.desktop);
  await set('model-control', { patch: { modelColumnWidth: 240 } });
  assert.equal((await cli('get', 'model-control')).preferences.modelColumnWidth, 240);
  const layout = {
    axis: 'vertical',
    groups: [
      { ids: ['outline'], active: 'outline', weight: 1 },
      { ids: ['next'], active: 'next', weight: 1 },
    ],
  };
  const arranged = await set('layout', { op: 'main-layout', placement: 'sidebar', layout });
  assert.deepEqual(arranged.current.layouts.sidebar, layout);
  await assert.rejects(
    () => set('layout', { op: 'main-layout', placement: 'sidebar', layout, expectedLayout: null }),
    /布局已变化/,
  );
  const keys = Object.keys(await cli('get'));
  assert.equal(keys.length, 9);
  await stop();
  await start();
  assert.equal((await cli('get', 'appearance')).settingsTheme, 'dark');
  assert.equal((await cli('get', 'settings')).storedApiKey, true);
  assert.equal((await cli('get', 'tasks')).store.tasks[0].fields.priority, 5);
  await mkdir('target/reports', { recursive: true });
  await writeFile(
    'target/reports/config-cli.json',
    JSON.stringify({ passed: true, scopes: keys, realUserDataAccessed: false }, null, 2),
  );
  console.log(
    'PASS CLI discovery, dry-run, real service writes, secrets, revision protection and restart persistence',
  );
} finally {
  await stop();
  await rm(data, { recursive: true, force: true });
}
