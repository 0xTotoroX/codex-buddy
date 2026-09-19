/*
 * [INPUT]: 临时源码路径、进程锁与启动器脚本生成函数。
 * [OUTPUT]: 开发入口重复启动、失效进程与 shell 路径转义回归。
 * [POS]: 独立 Node 验收，不连接宿主或启动实际开发后台。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasDevelopmentOwner, terminalScript } from '../scripts/dev-launcher.mjs';

test('development launcher respects a live owner and leaves stale records for dev cleanup', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-launcher-'));
  try {
    mkdirSync(join(root, 'target/dev'), { recursive: true });
    const lock = join(root, 'target/dev/owner.json');
    assert.equal(hasDevelopmentOwner(root), false);
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    assert.equal(hasDevelopmentOwner(root), true);
    writeFileSync(lock, JSON.stringify({ pid: 2147483647 }));
    assert.equal(hasDevelopmentOwner(root), false);
    assert.ok(readFileSync(lock));
    writeFileSync(lock, JSON.stringify({ pid: -1 }));
    assert.throws(() => hasDevelopmentOwner(root), /记录无效/);
    writeFileSync(lock, '{');
    assert.throws(() => hasDevelopmentOwner(root), /无法读取/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('terminal entry preserves spaces and shell metacharacters without evaluating them', () => {
  const root = mkdtempSync(join(tmpdir(), "buddy ' $() `quote`-"));
  try {
    mkdirSync(join(root, 'scripts'));
    writeFileSync(
      join(root, 'scripts/dev-launcher.mjs'),
      'console.log(JSON.stringify({cwd:process.cwd(), args:process.argv.slice(2), path:process.env.PATH}))',
    );
    const path = "/tmp/' $(echo wrong) `echo wrong`:/usr/bin";
    const result = spawnSync('/bin/sh', ['-s'], {
      input: terminalScript(root, process.execPath, path),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cwd: realpathSync(root), args: ['--run'], path });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
