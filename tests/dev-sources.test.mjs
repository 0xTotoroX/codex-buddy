/*
 * [INPUT]: 临时 Git worktrees、进程租约和合成开发交接回调。
 * [OUTPUT]: 来源白名单、互斥占用、失效租约恢复与孤儿后台保护、并发/失败回退及认证网关行为验收。
 * [POS]: 开发切换契约；不连接官方宿主、不终止真实开发会话。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  worktrees,
  selectSource,
  sourcePreference,
  claimLease,
  claimTarget,
  sourceSwitcher,
} from '../scripts/dev-sources.mjs';
import { startGateway } from '../scripts/dev-runtime.mjs';
const temporary = (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-sources-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
test('worktree discovery handles spaces, dirty files, shared preferences and rejects arbitrary paths', (t) => {
  const directory = temporary(t),
    root = join(directory, 'main tree'),
    other = join(directory, 'other tree');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'marker'), 'main');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('worktree', 'add', '-b', 'Stepwise', other);
  assert.deepEqual(
    worktrees(root).map((s) => s.branch),
    ['main', 'Stepwise'],
  );
  assert.equal(sourcePreference(root), sourcePreference(other));
  assert.throws(() => selectSource(root, directory), /清单/);
  assert.throws(() => selectSource(root, other), /尚未准备/);
  for (const file of [
    'Cargo.toml',
    'ui/codex/runtime/lifecycle.js',
    'ui/settings/vite.config.ts',
    'node_modules/vite/package.json',
  ]) {
    const path = join(other, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
  }
  assert.equal(selectSource(root, other).dirty, true);
});
test('a target lease excludes another worktree, normalizes localhost and never releases a replacement', (t) => {
  const directory = temporary(t);
  const host = { endpoint: 'http://localhost:9333', target: { id: 'synthetic' } };
  const release = claimTarget(host, 'main', directory);
  assert.throws(
    () => claimTarget({ ...host, endpoint: 'http://127.0.0.1:9333' }, 'Stepwise', directory),
    /已有开发会话/,
  );
  const other = claimTarget({ ...host, target: { id: 'another' } }, 'other', directory);
  other();
  release();
  claimTarget(host, 'Stepwise', directory)();
  const file = join(directory, 'owner.json');
  const close = claimLease(file);
  writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: 'replacement' }));
  close();
  assert.equal(existsSync(file), true);
});
test('leases left by an exited process recover while live and invalid records stay untouched', (t) => {
  const directory = temporary(t);
  const file = join(directory, 'owner.json');
  const module = new URL('../scripts/dev-sources.mjs', import.meta.url).href;
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {claimLease} from ${JSON.stringify(module)}; claimLease(${JSON.stringify(file)}, {root:${JSON.stringify(directory)}});`,
  ]);
  const prior = readFileSync(file, 'utf8');
  const release = claimLease(file, { root: directory });
  assert.notEqual(readFileSync(file, 'utf8'), prior);
  assert.equal(existsSync(file + '.recovery'), false);
  assert.throws(() => claimLease(file), /已有开发会话/);
  release();
  for (const record of ['{', '{}', '{"pid":-1}', '{"pid":"2147483647"}']) {
    writeFileSync(file, record);
    assert.throws(() => claimLease(file), /未自动清理/);
    assert.equal(readFileSync(file, 'utf8'), record);
    assert.equal(existsSync(file + '.recovery'), false);
  }
});

test('recovery refuses uncertain process status and an interrupted recovery guard', (t) => {
  const file = join(temporary(t), 'owner.json');
  const prior = JSON.stringify({ pid: 2147483647 });
  writeFileSync(file, prior);
  const kill = t.mock.method(process, 'kill', () => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' });
  });
  assert.throws(() => claimLease(file), /无法确认/);
  assert.equal(readFileSync(file, 'utf8'), prior);
  kill.mock.restore();
  writeFileSync(file + '.recovery', 'interrupted');
  assert.throws(() => claimLease(file), /恢复被中断/);
  assert.equal(readFileSync(file, 'utf8'), prior);
  assert.equal(readFileSync(file + '.recovery', 'utf8'), 'interrupted');
});

test('stale target recovery protects a live backend in a handoff source before session publication', (t) => {
  const directory = temporary(t),
    root = join(directory, 'main'),
    other = join(directory, 'other');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitignore'), 'target/');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('worktree', 'add', '-b', 'other', other);
  mkdirSync(join(other, 'target/dev/real'), { recursive: true });
  writeFileSync(
    join(other, 'target/dev/owner.json'),
    JSON.stringify({ pid: 2147483647, controller: root }),
  );
  const runtime = join(other, 'target/dev/real/runtime.json');
  writeFileSync(runtime, JSON.stringify({ pid: process.pid }));
  const file = join(directory, 'target.json');
  const prior = JSON.stringify({ pid: 2147483647, root });
  writeFileSync(file, prior);
  assert.throws(() => claimLease(file, { root }), /后台仍在运行/);
  assert.equal(readFileSync(file, 'utf8'), prior);
  writeFileSync(runtime, JSON.stringify({ pid: 2147483647 }));
  claimLease(file, { root })();
  assert.equal(existsSync(file), false);
});

test(
  'simultaneous recovery has one owner and cannot remove the winning lease',
  { timeout: 10000 },
  async (t) => {
    const file = join(temporary(t), 'owner.json');
    writeFileSync(file, JSON.stringify({ pid: 2147483647 }));
    const module = new URL('../scripts/dev-sources.mjs', import.meta.url).href;
    const children = Array.from({ length: 8 }, () =>
      spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
    import {claimLease} from ${JSON.stringify(module)};
    let release;
    process.on('message', (message) => {
      if (message === 'go') {
        try { release = claimLease(${JSON.stringify(file)}); process.send({won:true,pid:process.pid}); }
        catch (error) { process.send({won:false,message:error.message}); }
      } else { release?.(); process.exit(0); }
    });
    process.send('ready');
  `,
        ],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      ),
    );
    t.after(async () => {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exited = once(child, 'exit');
          child.kill();
          await exited;
        }),
      );
    });
    await Promise.all(children.map((child) => once(child, 'message')));
    const outcomes = children.map((child) => once(child, 'message'));
    for (const child of children) child.send('go');
    const winners = (await Promise.all(outcomes))
      .map(([result]) => result)
      .filter((result) => result.won);
    assert.equal(winners.length, 1);
    assert.equal(JSON.parse(readFileSync(file)).pid, winners[0].pid);
    const exits = children.map((child) => once(child, 'exit'));
    for (const child of children) child.send('stop');
    await Promise.all(exits);
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(file + '.recovery'), false);
  },
);

test('source switching is serialized and prepares before disconnecting, persists only on success', async () => {
  const events = [];
  let finish;
  const ready = new Promise((r) => {
    finish = r;
  });
  const controller = sourceSwitcher({
    initial: 'main',
    prepare: async (path) => {
      events.push('prepare');
      await ready;
      return { path, dispose: (ok) => events.push(`dispose:${ok}`) };
    },
    activate: async () => events.push('activate'),
    rollback: async () => events.push('rollback'),
    commit: async () => events.push('commit'),
  });
  const switched = controller.switch('Stepwise');
  assert.equal(controller.state().current, 'main');
  await assert.rejects(controller.switch('other'), /等待/);
  assert.deepEqual(events, ['prepare']);
  finish();
  await switched;
  assert.equal(controller.state().current, 'Stepwise');
  assert.deepEqual(events, ['prepare', 'activate', 'commit', 'dispose:true']);
});
test('build failure leaves the original running; connection failure restores it; failed recovery is explicit', async () => {
  for (const failure of ['build', 'connect', 'recovery']) {
    const events = [];
    const controller = sourceSwitcher({
      initial: 'main',
      prepare: async () => {
        if (failure === 'build') throw new Error('build');
        return { dispose: (ok) => events.push(ok) };
      },
      activate: async () => {
        events.push('connect');
        throw new Error('connect');
      },
      rollback: async () => {
        events.push('restore');
        if (failure === 'recovery') throw new Error('recovery');
      },
      commit: async () => events.push('commit'),
    });
    await assert.rejects(controller.switch('Stepwise'));
    assert.equal(controller.state().current, 'main');
    assert.equal(controller.state().busy, false);
    assert.equal(controller.state().phase, failure === 'recovery' ? 'failed' : 'ready');
    assert.deepEqual(events, failure === 'build' ? [] : ['connect', 'restore', false]);
  }
});
test('source endpoint remains authenticated and available without a backend', async (t) => {
  const calls = [];
  const gateway = await startGateway('fixture-secret', () => undefined, {
    switch: async (path) => {
      if (path !== 'Stepwise') throw new Error('not registered');
      calls.push(path);
    },
    status: async () => ({ active: calls.at(-1) || 'main' }),
  });
  t.after(() => gateway.close());
  const send = (body, headers = {}) =>
    fetch(gateway.origin + '/api/dev/sources', {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer fixture-secret', ...headers },
      body,
    });
  assert.equal((await send()).status, 200);
  assert.equal((await send('{"path":"Stepwise"}', { Authorization: 'invalid' })).status, 401);
  assert.equal((await send('{"path":"Stepwise"}', { Origin: 'https://example.com' })).status, 403);
  assert.equal((await send('{"path":"arbitrary"}')).status, 409);
  assert.equal((await send('{')).status, 409);
  assert.equal((await send('a'.repeat(9000))).status, 413);
  assert.deepEqual(await (await send('{"path":"Stepwise"}')).json(), { active: 'Stepwise' });
  assert.deepEqual(calls, ['Stepwise']);
});
