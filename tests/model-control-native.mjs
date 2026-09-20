/*
 * [INPUT]: 已构建的 codex-buddy、真实模型控制页面和隔离 loopback fixture。
 * [OUTPUT]: target/reports/model-control-native 的几何/焦点/租约证据及可选截图。
 * [POS]: 只创建本工具合成窗口；不连接、读取或重启官方宿主。运行前 cargo build --locked。
 * [PROTOCOL]: 由集成任务同步 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

if (process.platform !== 'darwin') throw Error('Native model-control acceptance requires macOS');
const root = resolve(import.meta.dirname, '..');
const binaryIndex = process.argv.indexOf('--binary');
const binary =
  binaryIndex < 0 ? join(root, 'target/debug/codex-buddy') : resolve(process.argv[binaryIndex + 1]);
const dir = mkdtempSync(join(tmpdir(), 'buddy-model-control-'));
const output = join(root, 'target/reports/model-control-native');
mkdirSync(output, { recursive: true });
const geometryProbe = join(dir, 'geometry-probe');
const inputProbe = join(dir, 'input-probe');
execFileSync('swiftc', [join(root, 'tests/native-probe.swift'), '-o', geometryProbe]);
execFileSync('swiftc', [join(root, 'tests/model-control-probe.swift'), '-o', inputProbe]);
const environment = JSON.parse(execFileSync(inputProbe, ['state'], { encoding: 'utf8' }));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const prefs = {
  enabled: true,
  edge: 'right',
  position: 0.5,
  screen: '',
  keepOpen: false,
  modelColumnWidth: 144,
  pinned: ['fixture-a'],
  presets: [],
};
const snapshot = {
  status: 'ready',
  target: { id: 'native-fixture', title: '原生控窗 · 合成任务' },
  revision: 'fixture-1',
  generating: false,
  current: { model: 'fixture-a', reasoning: 'high', speed: 'standard' },
  models: [
    { id: 'fixture-a', label: 'Fixture Alpha', reasoning: ['low', 'medium', 'high'], fast: true },
    { id: 'fixture-b', label: 'Fixture Beta', reasoning: ['medium', 'high'], fast: false },
  ],
};
const appearance = { material: 'matte', liquidVariant: 'regular', fontOffset: 0 };
let valid = true,
  reveal = 5,
  revision = 1,
  telemetry = null,
  queue = [],
  sequence = 0;
let child,
  stderr = '',
  commandResult = new Map();
const report = {
  environment,
  checks: [],
  skipped: [
    {
      name: 'real mouse hover',
      reason: 'Hover is exercised through DOM pointerenter; no native pointer move is performed',
    },
    {
      name: 'global shortcut dispatch and toggle',
      reason: 'Carbon registration is observed; real keyboard dispatch is not exercised',
    },
    ...(!environment.canPostEvents
      ? [
          {
            name: 'real mouse first click',
            reason: 'CGPreflightPostEventAccess=false; no permission is requested',
          },
        ]
      : []),
    ...(!environment.screens.some((s) => s.notchWidth > 0)
      ? [
          {
            name: 'physical notch on native hardware',
            reason: 'Connected screens have no hardware notch; geometry has separate Rust coverage',
          },
        ]
      : []),
  ],
  screenshots: [],
  errors: [],
};
const envelope = () => ({ preferences: prefs, snapshot, revision });

// Probe code is served only by this synthetic backend, never added to a product page/build.
function probePage() {
  let native = null,
    nativeEvents = 0,
    busy = false,
    pointerDown = null;
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  window.addEventListener('model-control-native', (event) => {
    native = event.detail;
    nativeEvents++;
  });
  window.addEventListener(
    'pointerdown',
    (event) => {
      pointerDown = { trusted: event.isTrusted, target: event.target?.id };
    },
    true,
  );
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/native-probe', {
        method: 'POST',
        body: JSON.stringify({
          native,
          nativeEvents,
          errors,
          pointerDown,
          hasFocus: document.hasFocus(),
          active: document.activeElement?.id,
          path: location.pathname,
          viewport: [innerWidth, innerHeight],
          searchRect: document.getElementById('search')?.getBoundingClientRect().toJSON(),
        }),
      });
      for (const command of await response.json()) {
        let result;
        try {
          result = { value: await (0, eval)(command.code) };
        } catch (error) {
          result = { error: String(error) };
        }
        await fetch('/native-result', {
          method: 'POST',
          body: JSON.stringify({ id: command.id, ...result }),
        });
      }
    } finally {
      busy = false;
    }
  }, 80);
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  let body = '';
  for await (const chunk of request) body += chunk;
  const json = (value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  if (path === '/native-probe') {
    telemetry = JSON.parse(body);
    return json(queue.splice(0));
  }
  if (path === '/native-result') {
    const result = JSON.parse(body);
    commandResult.set(result.id, result);
    return json({});
  }
  if (path.startsWith('/api/')) {
    if (request.headers.authorization !== 'Bearer native-fixture-token') return json({}, 401);
    if (path.endsWith('/window')) return json({ valid, preferences: prefs, reveal, appearance });
    if (path.endsWith('/preferences')) {
      Object.assign(prefs, JSON.parse(body).patch);
      revision++;
    }
    if (path.endsWith('/close')) {
      valid = false;
      prefs.enabled = false;
    }
    return json(envelope());
  }
  if (path === '/model-control') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    return response.end(
      readFileSync(join(root, 'ui/model-control/index.html'), 'utf8').replace(
        '</head>',
        `<script>(${probePage.toString()})()</script></head>`,
      ),
    );
  }
  const files = {
    '/model-control/tokens.css': 'ui/tokens.css',
    '/model-control/app.js': 'ui/model-control/app.js',
    '/model-control/view.js': 'ui/model-control/view.js',
    '/model-control/styles.css': 'ui/model-control/styles.css',
    '/model-control/icons.js': 'ui/panel/icons/index.js',
  };
  if (files[path]) {
    response.writeHead(200, {
      'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript',
    });
    return response.end(readFileSync(join(root, files[path])));
  }
  response.writeHead(404);
  response.end();
});

async function until(predicate, label, timeout = 9000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (predicate()) return;
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw Error(`${label}: child exited ${child.exitCode}: ${stderr}`);
    await delay(60);
  }
  throw Error(`${label}: timed out; ${JSON.stringify(telemetry)}; ${stderr}`);
}
async function command(code) {
  const id = ++sequence;
  queue.push({ id, code });
  await until(() => commandResult.has(id), 'probe command');
  const result = commandResult.get(id);
  commandResult.delete(id);
  if (result.error) throw Error(result.error);
  return result.value;
}
const ipc = (value) => command(`window.ipc.postMessage(${JSON.stringify(JSON.stringify(value))})`);
function windowInfo() {
  const rows = JSON.parse(
    execFileSync(geometryProbe, ['windows', String(child.pid)], { encoding: 'utf8' }),
  );
  return rows
    .filter((row) => row.kCGWindowLayer === 25)
    .sort(
      (a, b) =>
        b.kCGWindowBounds.Width * b.kCGWindowBounds.Height -
        a.kCGWindowBounds.Width * a.kCGWindowBounds.Height,
    )[0];
}
function capture(name) {
  const info = windowInfo();
  const path = join(output, `${name}.png`);
  try {
    execFileSync('screencapture', ['-x', '-l', String(info.kCGWindowNumber), path], {
      stdio: 'pipe',
    });
    report.screenshots.push(path);
  } catch {
    report.screenshots.push({ name, unavailable: 'Window screenshot unavailable' });
  }
}
function check(name, detail = telemetry?.native) {
  report.checks.push({ name, status: 'passed', detail });
}
function start() {
  telemetry = null;
  child = spawn(
    binary,
    ['--data-dir', dir, 'model-control-window', '--lease', 'native-fixture-lease'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
}
async function exited(label) {
  await Promise.race([
    once(child, 'exit'),
    delay(7000).then(() => {
      throw Error(`${label}: process did not exit`);
    }),
  ]);
  assert.equal(child.exitCode, 0, stderr);
  check(label, { exitCode: child.exitCode });
}

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  writeFileSync(
    join(dir, 'runtime.json'),
    JSON.stringify({
      pid: process.pid,
      port: server.address().port,
      token: 'native-fixture-token',
      version: 'fixture',
      executable: binary,
    }),
  );
  start();
  await until(
    () => telemetry?.native?.width === 32 && telemetry.native.height === 80,
    'initial compact',
  );
  assert.equal(telemetry.native.expanded, false);
  assert.equal(telemetry.native.keyboard, false);
  const initial = windowInfo();
  assert.equal(initial.kCGWindowBounds.Width, 32);
  assert.equal(initial.kCGWindowBounds.Height, 80);
  check('initial reveal baseline is compact', initial.kCGWindowBounds);

  await command(
    "document.getElementById('handle').dispatchEvent(new PointerEvent('pointerenter'))",
  );
  await until(() => telemetry.native.expanded, '250ms hover expansion');
  assert.equal(telemetry.native.keyboard, false);
  assert.equal(
    JSON.parse(execFileSync(inputProbe, ['state'], { encoding: 'utf8' })).frontmost,
    environment.frontmost,
  );
  check('DOM hover expands without taking native keyboard or foreground app');
  capture('expanded');

  if (environment.canPostEvents) {
    const bounds = windowInfo().kCGWindowBounds,
      search = telemetry.searchRect;
    execFileSync(inputProbe, [
      'click',
      String(bounds.X + search.x + search.width / 2),
      String(bounds.Y + search.y + search.height / 2),
    ]);
  } else {
    await command(
      "document.getElementById('search').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))",
    );
  }
  await until(
    () => telemetry.native.keyboard && telemetry.hasFocus,
    'explicit first-click keyboard focus',
  );
  check(
    environment.canPostEvents
      ? 'real first click acquires key focus'
      : 'synthetic pointerdown acquires key focus (event posting unavailable)',
    { native: telemetry.native, pointerDown: telemetry.pointerDown, hasFocus: telemetry.hasFocus },
  );
  const events = telemetry.nativeEvents;
  await delay(2200);
  assert.equal(
    telemetry.nativeEvents,
    events,
    'unchanged backend polling must not refocus the page',
  );
  check('unchanged polls emit no repeated focus event', { nativeEvents: events });

  await ipc({ action: 'collapse' });
  await until(() => !telemetry.native.expanded && !telemetry.native.keyboard, 'collapse');
  assert.equal(windowInfo().kCGWindowBounds.Width, 32);
  check('collapse shrinks actual WindowServer bounds');
  await command("document.getElementById('panel').dispatchEvent(new PointerEvent('pointerleave'))");
  prefs.keepOpen = true;
  revision++;
  await until(() => telemetry.native.expanded && telemetry.native.keepOpen, 'keepOpen preference');
  await ipc({ action: 'collapse' });
  await until(
    () => !prefs.keepOpen && !telemetry.native.expanded,
    'explicit collapse overrides keepOpen',
  );
  check('explicit collapse persists keepOpen=false');

  await ipc({ action: 'edge', edge: 'left' });
  await until(() => prefs.edge === 'left' && telemetry.native.edge === 'left', 'left edge');
  capture('left-compact');
  check('left compact', windowInfo().kCGWindowBounds);
  await ipc({ action: 'edge', edge: 'top' });
  await until(() => prefs.edge === 'top' && telemetry.native.edge === 'top', 'top edge');
  const top = windowInfo().kCGWindowBounds;
  assert.equal(top.Width, telemetry.native.compactWidth);
  assert.equal(top.Height, telemetry.native.compactHeight);
  if (telemetry.native.notchWidth > 0) assert(top.Width >= telemetry.native.notchWidth + 64);
  capture('top-compact');
  check('physical notch dock or unnotched top fallback', { bounds: top, native: telemetry.native });
  const saved = prefs.screen;
  await delay(1300);
  assert.equal(prefs.screen, saved);
  await ipc({ action: 'position', delta: 0.1 });
  await until(
    () => prefs.screen !== '' && prefs.position === 0.6,
    'explicit drag saves display UUID',
  );
  check('only explicit drag persists display identity', { screen: prefs.screen });

  reveal++;
  await until(() => telemetry.native.expanded && telemetry.native.keyboard, 'subsequent reveal');
  check('subsequent reveal expands with keyboard focus');
  capture('top-expanded');
  // Material reparenting can send a real pointerleave while the pointer is outside.
  // Keep the screenshot subject open; collapse behavior is exercised above.
  await command("document.getElementById('keep-open').click()");
  await until(() => telemetry.native.keepOpen && prefs.keepOpen, 'pin material screenshots');
  for (const [material, variant, style] of [
    ['matte', 'regular', null],
    ['frosted', 'regular', 'frosted-hud-active'],
    ['native-glass', 'regular', 'regular'],
    ['native-glass', 'clear', 'clear'],
    ['matte', 'regular', null],
  ]) {
    Object.assign(appearance, { material, liquidVariant: variant });
    await until(
      () =>
        telemetry.native.appearance?.material === material &&
        telemetry.native.appearance.liquidVariant === variant,
      `native material ${material}/${variant}`,
    );
    const fallback = material === 'native-glass' && !telemetry.native.nativeGlassAvailable;
    assert.equal(telemetry.native.effectiveMaterial, fallback ? 'matte' : material);
    assert.equal(telemetry.native.nativeBackdrop, !fallback && material !== 'matte');
    assert.equal(telemetry.native.backdropStyle, fallback ? null : style);
    assert.equal(windowInfo().kCGWindowBounds.Width, 480);
    assert.deepEqual(
      telemetry.viewport,
      [480, 640],
      'switching AppKit carrier preserves full WebView viewport',
    );
    if (fallback)
      report.skipped.push({
        name: `native glass ${variant}`,
        reason: 'NSGlassEffectView unavailable; matte fallback was verified',
      });
    check(`shared native material ${material}/${variant}`, telemetry.native);
    capture(`theme-${material}-${variant}`);
  }
  await command("location.href='https://example.invalid/blocked-navigation'");
  await delay(500);
  assert.equal(telemetry.path, '/model-control');
  check('external top-level navigation denied');
  report.errors = telemetry.errors;
  assert.deepEqual(telemetry.errors, []);
  valid = false;
  await exited('invalid lease exits');

  valid = true;
  prefs.keepOpen = false;
  start();
  await until(() => telemetry?.native, 'backend-loss fixture startup');
  server.close();
  server.closeAllConnections();
  await exited('backend disappearance exits');
  report.status = report.skipped.length ? 'passed_with_skips' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  report.stderr = stderr;
  report.lastTelemetry = telemetry;
  if (child?.exitCode === null)
    report.failureWindows = JSON.parse(
      execFileSync(geometryProbe, ['windows', String(child.pid)], { encoding: 'utf8' }),
    );
  throw error;
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM'); // Only our fixture child.
  server.close();
  server.closeAllConnections();
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  rmSync(dir, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      status: report.status,
      report: join(output, 'report.json'),
      checks: report.checks.length,
      skipped: report.skipped,
    }),
  );
}
