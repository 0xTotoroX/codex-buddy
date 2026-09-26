/*
 * [INPUT]: Git worktree 清单、私有进程记录与开发服务交接回调。
 * [OUTPUT]: 可选源码清单、可安全恢复失效记录的独占租约、串行且可回退的来源切换。
 * [POS]: dev.mjs 的跨 worktree 协调层；不操作宿主或终止其他进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
export function sourcePreference(root) {
  try {
    return join(
      git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      'buddy-dev-source.json',
    );
  } catch {
    return join(root, 'target/dev/source.json');
  }
}
export function worktrees(root) {
  let listing;
  try {
    listing = git(root, ['worktree', 'list', '--porcelain', '-z']);
  } catch {
    return [{ path: realpathSync(root), branch: '(源码目录)', commit: '', dirty: false }];
  }
  return listing
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const fields = record.split('\0');
      const path = fields.find((s) => s.startsWith('worktree '))?.slice(9);
      if (!path || !existsSync(path) || fields.some((s) => s.startsWith('prunable'))) return null;
      const branch =
        fields
          .find((s) => s.startsWith('branch '))
          ?.slice(7)
          .replace(/^refs\/heads\//, '') || '(detached)';
      return {
        path: realpathSync(path),
        branch,
        commit: git(path, ['rev-parse', '--short', 'HEAD']),
        dirty: Boolean(git(path, ['status', '--porcelain'])),
      };
    })
    .filter(Boolean);
}
export function selectSource(root, path) {
  const selected = worktrees(root).find((s) => s.path === resolve(path));
  if (!selected) throw new Error('来源不在当前仓库的 worktree 清单内，请刷新后重选。');
  for (const file of [
    'Cargo.toml',
    'ui/panel/runtime/lifecycle.js',
    'ui/settings/vite.config.ts',
    'node_modules/vite/package.json',
  ]) {
    if (!existsSync(join(selected.path, file)))
      throw new Error(`此 worktree 尚未准备好：缺少 ${file}`);
  }
  return selected;
}
export function readRecord(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function leaseRecord(path) {
  try {
    return readRecord(path);
  } catch (error) {
    throw new Error(`开发占用记录无法读取，未自动清理：${path}`, { cause: error });
  }
}
function processAlive(record, path) {
  if (!Number.isSafeInteger(record?.pid) || record.pid <= 0)
    throw new Error(`开发进程记录无效，未自动清理：${path}`);
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw new Error(`无法确认开发进程是否已退出，未自动清理：${path}`, { cause: error });
  }
}
function assertLeaseStopped(prior, path) {
  if (processAlive(prior, path))
    throw new Error(
      `已有开发会话占用 ${prior.root || '此目标'}。请在原 Dev 设置中切换来源，不要重复注入。`,
    );
  if (!prior.root) return;
  const directory = join(prior.root, 'target/dev');
  const session = leaseRecord(join(directory, 'session.json'));
  const directories = new Set([join(directory, 'real'), session?.runtime].filter(Boolean));
  // A source lease precedes backend startup; session.json is only updated after handoff.
  for (const source of worktrees(prior.controller || prior.root)) {
    const owner = leaseRecord(join(source.path, 'target/dev/owner.json'));
    if (owner?.pid === prior.pid) directories.add(join(source.path, 'target/dev/real'));
  }
  for (const data of directories) {
    const runtimePath = join(data, 'runtime.json');
    const runtime = leaseRecord(runtimePath);
    if (runtime && processAlive(runtime, runtimePath))
      throw new Error(
        `开发监督进程已退出，但后台仍在运行（PID ${runtime.pid}）。请先正常关闭该后台再启动；未清理占用记录：${path}`,
      );
  }
}
function recoverLease(path, record) {
  const guard = `${path}.recovery`;
  try {
    writeFileSync(guard, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`占用记录正在恢复或上次恢复被中断，请稍后重试；仍失败时核对恢复记录：${guard}`);
  }
  try {
    const prior = leaseRecord(path);
    if (prior) {
      assertLeaseStopped(prior, path);
      unlinkSync(path);
    }
    // A normal claimant may win after unlink. Never retry deletion in that case.
    writeFileSync(path, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('另一个开发会话已取得占用，请重新打开入口。');
    throw error;
  } finally {
    unlinkSync(guard);
  }
}
export function claimLease(path, metadata = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const record = { ...metadata, pid: process.pid, nonce: randomUUID() };
  try {
    writeFileSync(path, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = leaseRecord(path);
    if (prior) assertLeaseStopped(prior, path);
    recoverLease(path, record);
  }
  return () => {
    if (readRecord(path)?.nonce === record.nonce) unlinkSync(path);
  };
}
export function claimTarget(
  host,
  root,
  directory = join(homedir(), 'Library/Caches/codex-buddy/dev-targets'),
) {
  const endpoint = new URL(host.endpoint);
  if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1';
  const key = createHash('sha256').update(`${endpoint.origin}\0${host.target.id}`).digest('hex');
  return claimLease(join(directory, `${key}.json`), {
    root,
    endpoint: endpoint.origin,
    target: host.target.id,
  });
}

export function sourceSwitcher({ initial, prepare, activate, rollback, commit }) {
  let current = initial,
    busy = false,
    phase = 'ready',
    error = '';
  return {
    state: () => ({ current, busy, phase, error }),
    async switch(path) {
      if (busy) throw new Error('正在编译或切换来源，请等待完成。');
      if (path === current) return;
      busy = true;
      phase = 'preparing';
      error = '';
      let prepared;
      let touched = false;
      try {
        prepared = await prepare(path);
        phase = 'connecting';
        touched = true;
        await activate(prepared);
        await commit(prepared);
        current = path;
        phase = 'ready';
      } catch (failure) {
        error = failure.message;
        if (touched) {
          phase = 'restoring';
          try {
            await rollback(prepared);
            phase = 'ready';
          } catch (recovery) {
            phase = 'failed';
            error += `；恢复原来源失败：${recovery.message}`;
          }
        } else phase = 'ready';
        throw new Error(error);
      } finally {
        prepared?.dispose?.(current === path);
        busy = false;
      }
    },
  };
}
