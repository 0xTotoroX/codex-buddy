/*
 * [INPUT]: 临时源码路径、进程锁与启动器脚本生成函数。
 * [OUTPUT]: 开发入口唤起/重连/失败边界、失效进程与 shell 转义回归；可选合成原生窗口焦点验收。
 * [POS]: 独立 Node 验收，不连接宿主或启动实际开发后台。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { test } from 'node:test';
import { existsSync, copyFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  hasDevelopmentOwner,
  terminalScript,
  revealDevelopment,
  launcherSource,
} from '../scripts/dev-launcher.mjs';

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

async function developmentFixture(t, handler) {
  const root = mkdtempSync(join(tmpdir(), 'buddy-reveal-'));
  const data = join(root, 'target/dev/real');
  mkdirSync(data, { recursive: true });
  const requests = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: body ? JSON.parse(body) : undefined });
    handler(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    join(data, 'runtime.json'),
    JSON.stringify({ port: server.address().port, token: 'fixture-token' }),
  );
  writeFileSync(
    join(data, 'config.json'),
    JSON.stringify({ cdpEndpoint: 'http://127.0.0.1:9231', targetId: 'original-window' }),
  );
  return { root, requests };
}

test('reopening reveals the connected workbench without reconnecting or opening a panel', async (t) => {
  const { root, requests } = await developmentFixture(t, (req, res) => {
    res.end(
      JSON.stringify(
        req.url === '/api/state' ? { connection: { status: 'connected' } } : { ok: true },
      ),
    );
  });
  await revealDevelopment(root, { timeout: 500, interval: 5 });
  await revealDevelopment(root, { timeout: 500, interval: 5 });
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/state', '/api/development/reveal', '/api/state', '/api/development/reveal'],
  );
});

test('disconnected development reconnects the original target once, then reveals', async (t) => {
  let connected = false;
  const { root, requests } = await developmentFixture(t, (req, res) => {
    if (req.url === '/api/connect') connected = true;
    res.end(
      JSON.stringify(
        req.url === '/api/state'
          ? { connection: { status: connected ? 'connected' : 'disconnected' } }
          : { ok: true },
      ),
    );
  });
  await revealDevelopment(root, { timeout: 500, interval: 5 });
  assert.deepEqual(
    requests.filter((r) => r.path === '/api/connect'),
    [
      {
        path: '/api/connect',
        body: { endpoint: 'http://127.0.0.1:9231', targetId: 'original-window' },
      },
    ],
  );
  assert.equal(requests.at(-1).path, '/api/development/reveal');
});

test('failed reconnect is bounded and does not restart a host or select another target', async (t) => {
  const { root, requests } = await developmentFixture(t, (req, res) => {
    if (req.url === '/api/connect') res.statusCode = 400;
    res.end(JSON.stringify({ connection: { status: 'disconnected' } }));
  });
  await assert.rejects(revealDevelopment(root, { timeout: 100, interval: 5 }), /尚未就绪/);
  assert.equal(requests.filter((r) => r.path === '/api/connect').length, 1);
  assert.ok(requests.every((r) => ['/api/state', '/api/connect'].includes(r.path)));
});

test('a failed terminal startup is reported without waiting for the full readiness timeout', async (t) => {
  const { root, requests } = await developmentFixture(t, (_, res) => res.end('{}'));
  writeFileSync(join(root, 'target/dev/launcher-error.json'), JSON.stringify({ failed: true }));
  await assert.rejects(revealDevelopment(root, { checkStartupError: true }), /启动失败/);
  assert.equal(requests.length, 0);
  writeFileSync(
    join(root, 'target/dev/launcher-error.json'),
    JSON.stringify({ message: '没有找到可调试的真实 Codex' }),
  );
  await assert.rejects(
    revealDevelopment(root, { checkStartupError: true }),
    /没有找到可调试的真实 Codex/,
  );
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

test(
  'Dev App terminal entry opts into the shared host policy',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'buddy-app-policy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const directory of ['scripts', 'target/dev', 'node_modules/vite'])
      mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, 'node_modules/vite/package.json'), '{}');
    for (const name of ['dev-launcher.mjs', 'dev-host.mjs', 'launcher.mjs'])
      copyFileSync(new URL('../scripts/' + name, import.meta.url), join(root, 'scripts', name));
    writeFileSync(
      join(root, 'scripts/dev.mjs'),
      'console.log(JSON.stringify(process.argv.slice(2)))',
    );
    const { stdout } = await promisify(execFile)(process.execPath, [
      realpathSync(join(root, 'scripts/dev-launcher.mjs')),
      '--run',
    ]);
    assert.deepEqual(JSON.parse(stdout), ['--no-open', '--restart-running']);
  },
);

// Explicit opt-in: this check briefly takes foreground focus using only synthetic windows.
test(
  'native launcher shows in Dock and cooperatively activates an existing window',
  {
    skip: process.platform !== 'darwin' || process.env.CODEX_BUDDY_NATIVE_LAUNCHER_TEST !== '1',
    timeout: 30000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'buddy-launcher-native-'));
    const swift = join(root, 'probe.swift');
    const probe = join(root, 'probe');
    const app = join(root, 'Launcher Test.app');
    let native;
    let launcherPid;
    try {
      writeFileSync(
        swift,
        `import AppKit
if CommandLine.arguments.count > 1 {
    let app = NSWorkspace.shared.frontmostApplication
    let found = NSRunningApplication.runningApplications(withBundleIdentifier: CommandLine.arguments[1]).first
    print(String(data: try! JSONSerialization.data(withJSONObject: ["front": app?.processIdentifier ?? 0, "pid": found?.processIdentifier ?? 0, "policy": found?.activationPolicy.rawValue ?? -1]), encoding: .utf8)!)
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let observer = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: app, queue: .main) { _ in
        try! Data("active".utf8).write(to: URL(fileURLWithPath: ${JSON.stringify(join(root, 'activated'))}))
    }
    let window = NSWindow(contentRect: NSRect(x:100,y:100,width:300,height:180), styleMask:[.titled], backing:.buffered, defer:false)
    window.title = "CodexBuddy launcher test"
    window.makeKeyAndOrderFront(nil)
    try! Data("ready".utf8).write(to: URL(fileURLWithPath: ${JSON.stringify(join(root, 'ready'))}))
    app.run()
}`,
      );
      const run = promisify(execFile);
      await run('swiftc', [swift, '-o', probe]);
      native = spawn(probe, [], { stdio: 'ignore' });
      await once(native, 'spawn');
      const compiled = spawnSync('/usr/bin/osacompile', ['-o', app, '-'], {
        input: launcherSource('/bin/sleep 2; /bin/echo ' + native.pid),
        encoding: 'utf8',
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      await run('/usr/bin/plutil', [
        '-replace',
        'CFBundleIdentifier',
        '-string',
        'local.codex-buddy.launcher-test',
        join(app, 'Contents/Info.plist'),
      ]);
      await run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
      const inspect = async () =>
        JSON.parse((await run(probe, ['local.codex-buddy.launcher-test'])).stdout);
      for (let i = 0; i < 100 && !existsSync(join(root, 'ready')); i++) await delay(20);
      assert.ok(existsSync(join(root, 'ready')));
      rmSync(join(root, 'activated'), { force: true });
      const opened = run('/usr/bin/open', ['-W', app], { timeout: 12000 });
      opened.catch(() => {});
      let during;
      for (let i = 0; i < 20; i++) {
        during = await inspect();
        if (during.pid) {
          launcherPid = during.pid;
          break;
        }
        await delay(50);
      }
      assert.ok(launcherPid);
      assert.equal(during.policy, 0, 'regular applications participate in Dock');
      await opened;
      launcherPid = undefined;
      for (let i = 0; i < 100 && !existsSync(join(root, 'activated')); i++) await delay(20);
      assert.equal(
        readFileSync(join(root, 'activated'), 'utf8'),
        'active',
        'target actually received foreground activation',
      );
    } finally {
      native?.kill();
      if (launcherPid) {
        try {
          process.kill(launcherPid, 'SIGTERM');
        } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
