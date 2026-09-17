/*
 * [INPUT]: release 程序、安装器与独立临时数据目录。
 * [OUTPUT]: target/reports/lifecycle.json，记录启动器、安装、服务复用、升级及回滚验收结果。
 * [POS]: 进程生命周期测试入口，不使用真实聊天数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import assert from 'node:assert/strict';
import { prepareTestBinary } from '../scripts/verify.mjs';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'companion-lifecycle-'));
const binDir = join(scratch, 'bin');
const dataDir = join(scratch, 'data');
const appDir = join(scratch, 'Applications');
const binary = join(binDir, 'codex-buddy');
const artifact = prepareTestBinary('release');
const source = artifact.binary;
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const checks = [];
const record = (text) => {
  checks.push(text);
  console.log(`PASS ${text}`);
};
function run(program, args, expected = 0) {
  const result = spawnSync(program, args, { cwd: tmpdir(), encoding: 'utf8', timeout: 25000 });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result.stdout;
}
const cli = (args, expected = 0) => run(binary, ['--data-dir', dataDir, ...args], expected);
const runtime = () => JSON.parse(readFileSync(join(dataDir, 'runtime.json')));
let blocker;
try {
  run(process.execPath, [
    join(root, 'scripts/install.mjs'),
    '--skip-build',
    '--bin-dir',
    binDir,
    '--data-dir',
    dataDir,
    '--app-dir',
    appDir,
  ]);
  assert.equal(hash(binary), hash(source));
  record('异目录安装及单文件版本检查');
  run('/usr/bin/codesign', ['--verify', '--strict', join(appDir, 'CodexBuddy.app')]);
  const appInfo = JSON.parse(
    run('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      join(appDir, 'CodexBuddy.app/Contents/Info.plist'),
    ]),
  );
  assert.equal(appInfo.LSUIElement, true);
  const appScript = run('/usr/bin/osadecompile', [
    join(appDir, 'CodexBuddy.app/Contents/Resources/Scripts/main.scpt'),
  ]);
  assert.match(appScript, /launch --no-open/);
  assert.match(appScript, /popout/);
  assert.match(appScript, /macOS 15/);
  assert.match(appScript, /does not contain/);
  record('双击启动器编译与签名有效；低于浮窗门槛时保留内嵌，其他弹出错误仍提示');
  const config = {
    cdpEndpoint: 'http://127.0.0.1:9',
    model: 'lifecycle-do-not-call',
    provider: 'codex',
  };
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config));
  cli(['start', '--port', '0', '--no-open']);
  const first = runtime();
  const html = await (await fetch(`http://127.0.0.1:${first.port}/`)).text();
  assert.match(html, /assets\/index-.*\.js/);
  cli(['start', '--no-open']);
  assert.equal(runtime().pid, first.pid);
  record('脱离源码目录提供内嵌网页、启动复用');
  const guardStart = Date.now();
  cli(['launch', '--app', binary, '--no-open'], 1);
  assert.ok(Date.now() - guardStart < 5000);
  assert.equal(runtime().pid, first.pid);
  assert.equal(JSON.parse(cli(['status'])).running, true);
  record('无连接的已有宿主立即提示，保留进程且不尝试第二次启动');
  {
    const before = hash(binary);
    cli(['update', '--from', source, '--sha256', '0'.repeat(64)], 1);
    assert.equal(hash(binary), before);
    assert.equal(runtime().pid, first.pid);
    record('错误 SHA 不覆盖程序或中断服务');
    cli(['update', '--from', source, '--sha256', hash(source)]);
    assert.notEqual(runtime().pid, first.pid);
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'config.json'))), config);
    assert.equal(JSON.parse(cli(['status'])).running, true);
    record('合法本地升级、服务恢复及配置保留');
    const broken = join(scratch, 'broken-companion');
    writeFileSync(
      broken,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-buddy 0.2.0"; exit 0; fi\nexit 3\n',
    );
    chmodSync(broken, 0o755);
    cli(['update', '--from', broken, '--sha256', hash(broken)], 1);
    assert.equal(hash(binary), before);
    assert.equal(JSON.parse(cli(['status'])).running, true);
    record('新版启动失败回滚并恢复服务');
  }
  run(process.execPath, [
    join(root, 'scripts/install.mjs'),
    '--skip-build',
    '--bin-dir',
    binDir,
    '--data-dir',
    dataDir,
    '--app-dir',
    appDir,
  ]);
  assert.equal(JSON.parse(cli(['status'])).running, true);
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'config.json'))), config);
  record('重复源码安装保留配置并恢复原端口服务');
  cli(['stop']);
  assert.equal(JSON.parse(cli(['status'])).running, false);
  assert.equal(existsSync(join(dataDir, 'runtime.json')), false);
  // Cold starts read persisted layout independently of the currently mounted host.
  for (const ui of [
    { width: 510, height: 600, material: 'matte' },
    { layoutMode: 'workbench', dockWidth: 380, splitRatio: 0.6, dockOpen: true },
    { layoutMode: 'workbench', dockWidth: 300, splitRatio: 0.4, dockOpen: false },
  ]) {
    writeFileSync(join(dataDir, 'panel.json'), JSON.stringify({ ui }));
    let previousPid;
    for (let boot = 0; boot < 2; boot += 1) {
      cli(['start', '--port', '0', '--no-open']);
      const active = runtime();
      assert.notEqual(active.pid, previousPid);
      previousPid = active.pid;
      const response = await fetch(`http://127.0.0.1:${active.port}/api/appearance`, {
        headers: { Authorization: `Bearer ${active.token}` },
      });
      assert.equal(response.status, 200);
      const saved = await response.json();
      for (const [key, value] of Object.entries(ui)) assert.equal(saved.ui[key], value, key);
      assert.equal(saved.ui.layoutMode, ui.layoutMode || 'capsule');
      assert.equal(saved.detached, false);
      cli(['stop']);
      assert.equal(existsSync(join(dataDir, 'runtime.json')), false);
    }
  }
  record('正式程序冷启动保留旧胶囊偏好、工作台展开意图及独立宽度/比例');
  rmSync(join(dataDir, 'panel.json'), { force: true });
  // Exercise real HTTP requests against a local stalled model, not a timer-only stub.
  const asyncExec = promisify(execFile);
  let arrived;
  const modelServer = createHttpServer(() => arrived?.());
  await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const modelUrl = `http://127.0.0.1:${modelServer.address().port}/v1`;
  const modelEnv = {
    ...process.env,
    CODEX_BUDDY_PROVIDER: 'api',
    CODEX_BUDDY_MODEL: 'fixture',
    CODEX_BUDDY_BASE_URL: modelUrl,
  };
  try {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        ...config,
        provider: 'api',
        baseUrl: modelUrl,
        stepwise: {
          protocol: 'chat_completions',
          timeoutMs: 30000,
          apiKeyEnv: 'BUDDY_TEST_UNUSED_KEY',
        },
      }),
    );
    writeFileSync(join(dataDir, 'secrets.json'), '{"apiKey":"fixture-only"}');
    for (const route of ['settings/test', 'settings/models']) {
      await asyncExec(binary, ['--data-dir', dataDir, 'start', '--port', '0', '--no-open'], {
        env: modelEnv,
        timeout: 15000,
      });
      const active = runtime();
      let arrivalTimer;
      const received = new Promise((resolve, reject) => {
        arrived = () => {
          clearTimeout(arrivalTimer);
          resolve();
        };
        arrivalTimer = setTimeout(() => reject(new Error('Model fixture was not reached')), 5000);
      });
      const pending = fetch(`http://127.0.0.1:${active.port}/api/${route}`, {
        method: route.endsWith('/test') ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${active.token}` },
        signal: AbortSignal.timeout(12000),
      })
        .then(async (response) => ({ status: response.status, body: await response.json() }))
        .catch((error) => ({ error: error.message }));
      await received;
      const beforeStop = Date.now();
      await asyncExec(binary, ['--data-dir', dataDir, 'stop'], { env: modelEnv, timeout: 10000 });
      assert.ok(Date.now() - beforeStop < 5000, 'Stop must not wait for the model timeout');
      assert.equal(existsSync(join(dataDir, 'runtime.json')), false);
      const response = await pending;
      assert.equal(response.status, 400, JSON.stringify(response));
      assert.match(response.body.message, /请求已取消/);
    }
    record('模型测试与模型列表请求进行中仍可及时退出并取消请求');
  } finally {
    modelServer.closeAllConnections();
    await new Promise((resolve) => modelServer.close(resolve));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config));
  }
  const migrationHome = join(scratch, 'migration-home');
  const legacyData = join(migrationHome, 'Library/Application Support/codex-companion');
  const migratedData = join(migrationHome, 'Library/Application Support/codex-buddy');
  mkdirSync(legacyData, { recursive: true });
  writeFileSync(join(legacyData, 'config.json'), JSON.stringify(config));
  writeFileSync(join(legacyData, 'secrets.json'), '{"apiKey":"fixture-only"}');
  const migrationEnv = { ...process.env, HOME: migrationHome };
  delete migrationEnv.CODEX_BUDDY_HOME;
  const migrated = spawnSync(
    process.execPath,
    [join(root, 'scripts/install.mjs'), '--skip-build', '--bin-dir', binDir, '--app-dir', appDir],
    { cwd: root, env: migrationEnv, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
  assert.equal(existsSync(legacyData), false);
  assert.deepEqual(JSON.parse(readFileSync(join(migratedData, 'config.json'))), config);
  assert.equal(
    readFileSync(join(migratedData, 'secrets.json'), 'utf8'),
    '{"apiKey":"fixture-only"}',
  );
  record('旧默认目录自动迁移，配置及密钥逐字保留');
  blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  cli(['serve', '--port', String(blocker.address().port)], 1);
  record('停止后清理运行信息及端口冲突报错');
  const output = join(root, 'target/reports/lifecycle.json');
  mkdirSync(join(root, 'target/reports'), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        artifact,
        passed: checks.length,
        checks,
        platform: process.platform,
        arch: process.arch,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\n${checks.length} lifecycle checks passed.`);
} finally {
  if (existsSync(binary)) spawnSync(binary, ['--data-dir', dataDir, 'stop'], { timeout: 10000 });
  if (blocker) await new Promise((resolve) => blocker.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
