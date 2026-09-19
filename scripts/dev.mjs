/*
 * [INPUT]: 项目源码、Rust/Node 与独立开发数据目录。
 * [OUTPUT]: 一条命令启动设置页热更新、胶囊热加载及 Rust 编译后自动重启；显式 --restart-running 复用共享宿主准备，再恢复旧会话，启动错误传回 App。
 * [POS]: 开发编排；管理开发进程，显式启用时委托共享宿主启动策略，暂停并恢复安装版连接，不改写官方应用包。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  renameSync,
  watch,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { buildDevPanel, filesUnder, fingerprint } from './dev-panel.mjs';
import { startGateway, command, stopChild, until } from './dev-runtime.mjs';
import {
  findDevelopmentHost,
  hostSettingsDirectory,
  initializeData,
  pauseInstallation,
  restoreInstallation,
} from './dev-host.mjs';

const root = resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
  options: {
    'no-open': { type: 'boolean' },
    'restart-running': { type: 'boolean' },
    help: { type: 'boolean' },
    cdp: { type: 'string' },
    target: { type: 'string' },
  },
});
if (args.help) {
  console.log(
    'npm run dev [-- --no-open] [--restart-running] [--cdp PORT] [--target ID]：连接真实 Codex；保存自动更新，Ctrl+C 恢复安装版。',
  );
  process.exit(0);
}
const source = resolve(
  process.env.CODEX_BUDDY_HOME || join(homedir(), 'Library/Application Support/codex-buddy'),
);
const directory = join(root, 'target/dev');
const data = join(directory, 'real');
const journal = join(directory, 'paused-installation.json');
const binary = join(directory, 'bin/codex-buddy');
const snapshot = join(directory, 'panel.json');
const lock = join(directory, 'owner.json');
mkdirSync(join(directory, 'bin'), { recursive: true, mode: 0o700 });
mkdirSync(data, { recursive: true, mode: 0o700 });
if (existsSync(lock)) {
  const owner = JSON.parse(readFileSync(lock));
  let alive = false;
  try {
    process.kill(owner.pid, 0);
    alive = true;
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  if (alive) throw new Error('此项目已有开发进程，请在原终端继续或先按 Ctrl+C 退出。');
  rmSync(lock);
}
writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
const children = new Set();
const watchers = [];
let service,
  runtime,
  gateway,
  host,
  vite,
  httpServer,
  closing = false,
  rebuilding = false,
  canRestore = false;
let pendingNative = false,
  pendingPanel = false,
  timer;
const env = { ...process.env };
for (const key of ['CODEX_BUDDY_PANEL_TEST', 'CODEX_BUDDY_DEV_ASSETS']) delete env[key];
Object.assign(env, {
  CARGO_TARGET_DIR: join(root, 'target'),
  CODEX_BUDDY_HOME: data,
  CODEX_BUDDY_DEV_ASSETS: snapshot,
});
const options = { cwd: root, env };
const execute = (program, args) => command(program, args, options, children);
const token = randomUUID();
let nativeFingerprint;
const nativeInputs = () => [
  ...filesUnder(root, 'src'),
  ...filesUnder(root, '.cargo'),
  'build.rs',
  'Cargo.toml',
  'Cargo.lock',
];

async function api(path, body) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '开发后台请求失败');
  return result;
}
function assertBackendStopped() {
  if (existsSync(join(data, 'runtime.json'))) {
    const prior = JSON.parse(readFileSync(join(data, 'runtime.json')));
    try {
      process.kill(prior.pid, 0);
      throw new Error('开发数据目录仍有后台运行；请先关闭该开发后台，再启动。');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}
async function startService() {
  if (closing) return;
  assertBackendStopped();
  rmSync(join(data, 'runtime.json'), { force: true });
  rmSync(join(data, 'development.json'), { force: true });
  const log = join(directory, 'service.log');
  const { openSync, closeSync } = await import('node:fs');
  const fd = openSync(log, 'a', 0o600);
  service = spawn(binary, ['--data-dir', data, 'serve', '--port', '0'], {
    ...options,
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  let spawnError;
  service.on('error', (error) => {
    spawnError = error;
  });
  await until(async () => {
    if (closing) throw new Error('开发模式退出中');
    if (spawnError || service.exitCode !== null) throw new Error(`开发后台启动失败，请查看 ${log}`);
    try {
      runtime = JSON.parse(readFileSync(join(data, 'runtime.json')));
      return (await api('state')).connection.status === 'connected';
    } catch {
      return false;
    }
  }, `真实 Codex 连接超时，请查看 ${log}`);
  await until(async () => {
    if (closing) throw new Error('开发模式退出中');
    const report = await api('development');
    return report?.development === true || (report?.native === true && report.roots === 1);
  }, '真实 Codex 胶囊未完成安装');
}
async function rebuildNative() {
  const before = fingerprint(root, nativeInputs());
  if (before === nativeFingerprint && existsSync(binary)) return;
  console.log('正在编译 Rust；现有开发窗口保持运行…');
  await execute('cargo', ['build', '--locked']);
  if (closing) return;
  if (before !== fingerprint(root, nativeInputs())) {
    pendingNative = true;
    return;
  }
  const previous = binary + '.previous';
  if (existsSync(binary)) copyFileSync(binary, previous);
  copyFileSync(join(root, 'target/debug/codex-buddy'), binary + '.next');
  if (!service) {
    canRestore = true;
    await pauseInstallation(host, journal);
  }
  await stopChild(service);
  runtime = undefined;
  renameSync(binary + '.next', binary);
  try {
    await startService();
    nativeFingerprint = before;
    console.log('Rust 更新完成，开发胶囊已重新连接。');
  } catch (error) {
    await stopChild(service);
    if (!closing && existsSync(previous)) {
      copyFileSync(previous, binary);
      await startService();
      console.error('新版启动失败，已恢复上一版开发程序。');
    }
    throw error;
  }
}
async function flush() {
  if (rebuilding || closing) return;
  rebuilding = true;
  try {
    while (!closing && (pendingPanel || pendingNative)) {
      const panel = pendingPanel,
        native = pendingNative;
      pendingPanel = pendingNative = false;
      try {
        if (panel) {
          await buildDevPanel(root, snapshot);
          console.log('胶囊资源已更新（CSS 保留实例，逻辑重新加载）。');
        }
        if (native) await rebuildNative();
      } catch (error) {
        if (!closing) console.error(`更新失败，保留上次可用版本：${error.message}`);
      }
    }
  } finally {
    rebuilding = false;
  }
}
function changed(path) {
  if (path.endsWith('.md') || path.endsWith('.log')) return;
  if (path === 'ui/tokens.css' || path.startsWith('ui/panel/') || path.startsWith('ui/bridge/'))
    pendingPanel = true;
  if (
    path.startsWith('src/') ||
    path.startsWith('.cargo/') ||
    ['build.rs', 'Cargo.toml', 'Cargo.lock'].includes(path)
  )
    pendingNative = true;
  if (/^(scripts\/|package(-lock)?\.json)/.test(path))
    console.log('开发工具或依赖已变更，请 Ctrl+C 后重新运行 npm run dev。');
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}
async function cleanup() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  await Promise.allSettled([...children].map(stopChild));
  await stopChild(service);
  runtime = undefined;
  await vite?.close();
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await gateway?.close();
  if (canRestore) {
    try {
      await restoreInstallation(journal);
    } catch (error) {
      console.error(error.message);
    }
  }
  rmSync(join(directory, 'session.json'), { force: true });
  rmSync(lock, { force: true });
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => cleanup().then(() => process.exit(0)));
try {
  assertBackendStopped();
  host = await findDevelopmentHost(source, args, async () => {
    // Build before any host restart; use current source, not an older installed CLI.
    console.log('正在准备宿主启动器；将按「启动行为」设置处理没有调试连接的应用…');
    if (!existsSync(join(root, 'target/web/index.html')))
      await execute('npm', ['run', 'build:web']);
    await execute('cargo', ['build', '--locked']);
    if (closing) throw new Error('开发模式退出中');
    return command(
      join(root, 'target/debug/codex-buddy'),
      [
        '--data-dir',
        hostSettingsDirectory(source, data),
        'launch',
        '--host-only',
        '--restart-running',
        '--no-open',
      ],
      options,
      children,
      true,
    );
  });
  await restoreInstallation(journal, host);
  initializeData(source, data, host);
  gateway = await startGateway(token, () => runtime);
  await buildDevPanel(root, snapshot);
  if (!existsSync(join(root, 'target/web/index.html'))) await execute('npm', ['run', 'build:web']);
  await rebuildNative();
  if (closing) throw new Error('开发模式退出中');
  process.env.CODEX_BUDDY_DEV_API = gateway.origin;
  httpServer = createHttpServer((request, response) => vite.middlewares(request, response));
  vite = await createServer({
    configFile: join(root, 'ui/settings/vite.config.ts'),
    server: { middlewareMode: true, hmr: { server: httpServer } },
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  // Private machine-readable discovery for integration tests; no credentials in console output.
  writeFileSync(
    join(directory, 'session.json'),
    JSON.stringify({ url, token, endpoint: host.endpoint, runtime: data }),
    { mode: 0o600 },
  );
  console.log(
    `CodexBuddy · 开发版\n设置页开发服务：${url}\n真实 Codex · 默认内嵌；保存自动更新，Ctrl+C 退出并恢复安装版。\n开发配置：${data}`,
  );
  if (!args['no-open']) {
    const opener = spawn('open', [`${url}/#token=${encodeURIComponent(token)}`], {
      stdio: 'ignore',
    });
    opener.on('error', () => console.error('无法自动打开开发设置页。'));
  }
  for (const directory of ['ui', 'src', '.cargo', 'scripts']) {
    watchers.push(
      watch(join(root, directory), { recursive: true }, (_, name) => {
        if (name) changed(directory + '/' + name);
      }),
    );
  }
  watchers.push(
    watch(root, (_, name) => {
      if (name && !String(name).includes('/')) changed(String(name));
    }),
  );
} catch (error) {
  writeFileSync(
    join(directory, 'launcher-error.json'),
    JSON.stringify({ message: error.message }),
    { mode: 0o600 },
  );
  console.error(error.message);
  await cleanup();
  process.exitCode = 1;
}
