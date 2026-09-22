/*
 * [INPUT]: Git worktrees、Rust/Node、来源选择器与独立开发数据目录。
 * [OUTPUT]: 一条命令启动设置页热更新、胶囊热加载及 Rust/模型控制资源编译后自动重启；显式 --restart-running 复用共享宿主准备，再恢复旧会话，启动错误传回 App。
 * [POS]: 持久开发编排与设置入口；持有目标租约并串行交接 worktree，管理开发进程，显式启用时委托共享宿主启动策略，暂停并恢复安装版连接，不改写官方应用包。
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
  sourcePreference,
  worktrees,
  selectSource,
  readRecord,
  claimLease,
  claimTarget,
  sourceSwitcher,
} from './dev-sources.mjs';
import {
  findDevelopmentHost,
  hostSettingsDirectory,
  initializeData,
  pauseInstallation,
  restoreInstallation,
} from './dev-host.mjs';

const controllerRoot = resolve(import.meta.dirname, '..');
const controllerDirectory = join(controllerRoot, 'target/dev');
const preference = sourcePreference(controllerRoot);
let root = controllerRoot;
const { values: args } = parseArgs({
  options: {
    'no-open': { type: 'boolean' },
    'restart-running': { type: 'boolean' },
    help: { type: 'boolean' },
    cdp: { type: 'string' },
    target: { type: 'string' },
    source: { type: 'string' },
  },
});
if (args.help) {
  console.log(
    'npm run dev [-- --no-open] [--restart-running] [--cdp PORT] [--target ID] [--source WORKTREE_PATH]：连接真实 Codex；保存自动更新，Ctrl+C 恢复安装版。',
  );
  process.exit(0);
}
const source = resolve(
  process.env.CODEX_BUDDY_HOME || join(homedir(), 'Library/Application Support/codex-buddy'),
);
const lock = join(controllerDirectory, 'owner.json');
const releaseController = claimLease(lock, { root: controllerRoot });
const journal = join(controllerDirectory, 'paused-installation.json');
let directory, data, binary, snapshot, options, env;
let releaseSource = () => {},
  releaseTarget = () => {};
function context(path) {
  const directory = join(path, 'target/dev');
  const data = join(directory, 'real');
  const snapshot = join(directory, 'panel.json');
  mkdirSync(join(directory, 'bin'), { recursive: true, mode: 0o700 });
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: join(path, 'target'),
    CODEX_BUDDY_HOME: data,
    CODEX_BUDDY_DEV_ASSETS: snapshot,
  };
  delete env.CODEX_BUDDY_PANEL_TEST;
  return {
    root: path,
    directory,
    data,
    binary: join(directory, 'bin/codex-buddy'),
    snapshot,
    env,
    options: { cwd: path, env },
  };
}
function useContext(value) {
  ({ root, directory, data, binary, snapshot, options, env } = value);
}
useContext(context(root));
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
const execute = (program, args) => command(program, args, options, children);
const token = randomUUID();
let nativeFingerprint, switcher, settingsUrl, switchTask;
let buildError = '';
let sourceEpoch = randomUUID();
const injectedSettings = readFileSync(join(controllerRoot, 'ui/settings/dev-sources.js'), 'utf8');
const nativeInputs = (root) => [
  ...filesUnder(root, 'src'),
  ...filesUnder(root, 'ui/model-control'),
  'ui/tokens.css',
  'ui/panel/icons/index.js',
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
    let state;
    try {
      runtime = JSON.parse(readFileSync(join(data, 'runtime.json')));
      state = await api('state');
    } catch {
      return false;
    }
    if (state.connection.status !== 'connected') return false;
    if (state.connection.endpoint !== host.endpoint || state.connection.targetId !== host.target.id)
      throw new Error('开发后台连接了不同的宿主目标，停止此次交接。');
    return true;
  }, `真实 Codex 连接超时，请查看 ${log}`);
  await until(async () => {
    if (closing) throw new Error('开发模式退出中');
    const report = await api('development');
    return (
      (report?.development === true || report?.native === true) &&
      report?.roots === 1 &&
      report?.revision === readRecord(snapshot)?.revision
    );
  }, '真实 Codex 胶囊未完成安装');
}
async function rebuildNative() {
  const before = fingerprint(root, nativeInputs(root));
  if (before === nativeFingerprint && existsSync(binary)) return;
  console.log('正在编译 Rust；现有开发窗口保持运行…');
  await execute('cargo', ['build', '--locked']);
  if (closing) return;
  if (before !== fingerprint(root, nativeInputs(root))) {
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
  if (switcher?.state().busy || rebuilding || closing) return;
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
        buildError = '';
      } catch (error) {
        buildError = error.message;
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
    path.startsWith('ui/model-control/') ||
    ['ui/tokens.css', 'ui/panel/icons/index.js'].includes(path) ||
    path.startsWith('.cargo/') ||
    ['build.rs', 'Cargo.toml', 'Cargo.lock'].includes(path)
  )
    pendingNative = true;
  if (/^(scripts\/|package(-lock)?\.json)/.test(path))
    console.log('开发工具或依赖已变更，请 Ctrl+C 后重新运行 npm run dev。');
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}
function startWatchers() {
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
}
function stopWatchers() {
  clearTimeout(timer);
  for (const watcher of watchers.splice(0)) watcher.close();
  pendingNative = pendingPanel = false;
}
async function startSettings() {
  vite = await createServer({
    configFile: join(root, 'ui/settings/vite.config.ts'),
    plugins: [
      {
        name: 'buddy-dev-source',
        transformIndexHtml: () => [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children: `(() => {
            const epoch = ${JSON.stringify(sourceEpoch)};
            const original = window.fetch.bind(window);
            window.fetch = (input, init) => {
              const request = new Request(input, init), url = new URL(request.url);
              if (url.origin === location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/dev/sources') {
                const headers = new Headers(request.headers); headers.set('X-Codex-Buddy-Source', epoch);
                return original(new Request(request, { headers }));
              }
              return original(request);
            };
          })();`,
          },
          { tag: 'script', attrs: { type: 'module', src: '/__buddy_dev.js' }, injectTo: 'body' },
        ],
      },
    ],
    server: { middlewareMode: true, hmr: { server: httpServer } },
  });
}
// The settings listener and its token remain stable while Vite and the backend change.
async function proxySettings(req, res) {
  const port = req.socket.localPort;
  if (
    ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host) ||
    (req.headers.origin &&
      ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin))
  ) {
    res.writeHead(403).end();
    return;
  }
  const { request } = await import('node:http');
  const upstream = request(
    gateway.origin + req.url,
    {
      method: req.method,
      headers: { ...req.headers, host: new URL(gateway.origin).host, origin: gateway.origin },
    },
    (reply) => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}
function saveSession() {
  const record = JSON.stringify({
    url: settingsUrl,
    token,
    endpoint: host.endpoint,
    runtime: data,
    source: root,
    controller: controllerRoot,
    sourceEpoch,
  });
  for (const destination of new Set([directory, controllerDirectory]))
    writeFileSync(join(destination, 'session.json'), record, { mode: 0o600 });
}
async function sourceStatus() {
  const choices = worktrees(controllerRoot);
  let loaded = false,
    connected = false;
  if (runtime && !switcher.state().busy) {
    try {
      connected = (await api('state')).connection.status === 'connected';
      const report = connected && (await api('development'));
      loaded = report?.revision === readRecord(snapshot)?.revision && report?.roots === 1;
    } catch {}
  }
  return {
    ...switcher.state(),
    buildError,
    sources: choices,
    controller: controllerRoot,
    active: root,
    connected,
    loaded,
    resource: readRecord(snapshot)?.revision?.slice(0, 12) || '',
  };
}
function createSourceSwitcher() {
  return sourceSwitcher({
    initial: root,
    async prepare(path) {
      const selected = selectSource(controllerRoot, path);
      const release =
        selected.path === controllerRoot
          ? () => {}
          : claimLease(join(selected.path, 'target/dev/owner.json'), {
              root: selected.path,
              controller: controllerRoot,
            });
      const next = context(selected.path);
      const previous = {
        ...context(root),
        fingerprint: nativeFingerprint,
        release: releaseSource,
        sourceEpoch,
      };
      try {
        const prior = readRecord(join(next.data, 'runtime.json'));
        if (prior) {
          let alive = true;
          try {
            process.kill(prior.pid, 0);
          } catch (e) {
            if (e.code === 'ESRCH') alive = false;
          }
          if (alive) throw new Error('目标 worktree 的后台仍在运行，请先从原会话正常退出。');
        }
        const before = fingerprint(next.root, nativeInputs(next.root));
        await buildDevPanel(next.root, next.snapshot);
        await command('npm', ['run', 'build:web'], next.options, children);
        await command('cargo', ['build', '--locked'], next.options, children);
        if (closing) throw new Error('开发会话正在退出');
        if (before !== fingerprint(next.root, nativeInputs(next.root)))
          throw new Error('编译期间目标源码已变化，请重新切换。');
        await buildDevPanel(next.root, next.snapshot);
        copyFileSync(join(next.root, 'target/debug/codex-buddy'), next.binary);
        initializeData(source, next.data, host);
        return {
          next,
          previous,
          fingerprint: before,
          release,
          dispose: (accepted) => {
            if (!accepted) release();
          },
        };
      } catch (error) {
        release();
        throw error;
      }
    },
    async activate({ next, fingerprint: compiled }) {
      stopWatchers();
      await stopChild(service);
      runtime = undefined;
      await vite?.close();
      vite = undefined;
      useContext(next);
      nativeFingerprint = compiled;
      await startService();
      await startSettings();
    },
    async rollback({ previous }) {
      stopWatchers();
      await stopChild(service);
      runtime = undefined;
      await vite?.close();
      vite = undefined;
      useContext(previous);
      nativeFingerprint = previous.fingerprint;
      sourceEpoch = previous.sourceEpoch;
      if (closing) return;
      writeFileSync(preference, JSON.stringify({ path: previous.root }), { mode: 0o600 });
      await startService();
      await startSettings();
      saveSession();
      startWatchers();
    },
    async commit({ next, previous, release }) {
      if (closing) throw new Error('开发会话正在退出');
      sourceEpoch = randomUUID();
      saveSession();
      startWatchers();
      writeFileSync(preference, JSON.stringify({ path: next.root }), { mode: 0o600 });
      if (previous.directory !== controllerDirectory)
        rmSync(join(previous.directory, 'session.json'), { force: true });
      previous.release();
      releaseSource = release;
      buildError = '';
      pendingPanel = pendingNative = true;
      console.log(`开发来源已切换：${next.root}；Codex 保持运行。`);
    },
  });
}
async function cleanup() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  await Promise.allSettled([...children].map(stopChild));
  await switchTask?.catch(() => {});
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
  rmSync(join(controllerDirectory, 'session.json'), { force: true });
  releaseSource();
  releaseTarget();
  releaseController();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => cleanup().then(() => process.exit(0)));
try {
  const remembered = args.source
    ? resolve(args.source)
    : readRecord(preference)?.path || controllerRoot;
  const selected =
    remembered === controllerRoot
      ? { path: controllerRoot }
      : selectSource(controllerRoot, remembered);
  if (selected.path !== controllerRoot)
    releaseSource = claimLease(join(selected.path, 'target/dev/owner.json'), {
      root: selected.path,
      controller: controllerRoot,
    });
  useContext(context(selected.path));
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
  releaseTarget = claimTarget(host, controllerRoot);
  await restoreInstallation(journal, host);
  initializeData(source, data, host);
  switcher = createSourceSwitcher();
  gateway = await startGateway(token, () => runtime, {
    status: sourceStatus,
    epoch: () => sourceEpoch,
    busy: () => switcher.state().busy,
    switch: async (path) => {
      if (closing || rebuilding) throw new Error('开发后台正在编译或退出，请稍后再切换。');
      try {
        if (switcher.state().busy) throw new Error('正在切换来源，请等待完成。');
        switchTask = switcher.switch(path);
        await switchTask;
      } finally {
        void flush();
      }
    },
  });
  await buildDevPanel(root, snapshot);
  if (!existsSync(join(root, 'target/web/index.html'))) await execute('npm', ['run', 'build:web']);
  await rebuildNative();
  if (closing) throw new Error('开发模式退出中');
  process.env.CODEX_BUDDY_DEV_API = gateway.origin;
  httpServer = createHttpServer((request, response) => {
    if (request.url === '/__buddy_dev.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      response.end(injectedSettings);
    } else if (request.url?.startsWith('/api/')) {
      proxySettings(request, response);
    } else if (vite) vite.middlewares(request, response);
    else {
      response.writeHead(503).end('开发设置页正在切换，请稍后刷新。');
    }
  });
  await startSettings();
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const url = (settingsUrl = `http://127.0.0.1:${httpServer.address().port}`);
  saveSession();
  if (args.source) writeFileSync(preference, JSON.stringify({ path: root }), { mode: 0o600 });
  console.log(
    `CodexBuddy · 开发版\n设置页开发服务：${url}\n真实 Codex · 默认内嵌；保存自动更新，Ctrl+C 退出并恢复安装版。\n开发配置：${data}`,
  );
  if (!args['no-open']) {
    const opener = spawn('open', [`${url}/#token=${encodeURIComponent(token)}`], {
      stdio: 'ignore',
    });
    opener.on('error', () => console.error('无法自动打开开发设置页。'));
  }
  startWatchers();
} catch (error) {
  writeFileSync(
    join(controllerDirectory, 'launcher-error.json'),
    JSON.stringify({ message: error.message }),
    { mode: 0o600 },
  );
  console.error(error.message);
  await cleanup();
  process.exitCode = 1;
}
