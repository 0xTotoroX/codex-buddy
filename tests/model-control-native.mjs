/*
 * [INPUT]: 已构建的 codex-buddy、真实模型控制页面和隔离 loopback fixture。
 * [OUTPUT]: target/reports/model-control-native 的跨桌面策略/几何/焦点/租约证据及可选截图。
 * [POS]: 只创建本工具合成窗口；不连接、读取或重启官方宿主。运行前 cargo build --locked。
 * [PROTOCOL]: 由集成任务同步 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, execFile, spawn } from 'node:child_process';
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
const appearance = {
  material: 'matte',
  liquidVariant: 'regular',
  fontOffset: 0,
  hostTheme: {
    theme: 'light',
    colors: {
      'surface-opaque': 'rgb(245, 239, 230)',
      text: 'rgb(30, 35, 40)',
      accent: 'rgb(172, 73, 201)',
    },
  },
};
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
      name: 'real Spaces and full-screen transitions',
      reason:
        'Native all-Spaces/full-screen flags and host-independent visibility are checked; actual Mission Control and full-screen transitions require manual acceptance',
    },
    ...(!environment.canPostEvents
      ? [
          {
            name: 'real mouse hover',
            reason:
              'CGPreflightPostEventAccess=false; native pointer messages are tested synthetically',
          },
        ]
      : []),
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
let hostPresence = { visible: false, focused: false };
let windowPolls = 0;
const envelope = () => ({ preferences: prefs, snapshot, revision });

// Probe code is served only by this synthetic backend, never added to a product page/build.
function probePage() {
  const send = window.ipc.postMessage.bind(window.ipc);
  window.heldScenes = [];
  let holdScenes = true;
  window.fixturePostMessage = (raw) => {
    if (holdScenes && JSON.parse(raw).action === 'scene-ready') window.heldScenes.push(raw);
    else send(raw);
  };
  window.releaseScenes = () => {
    holdScenes = false;
    for (const raw of window.heldScenes.splice(0)) send(raw);
  };
  const dispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = (event) => {
    if (window.deferNative && event.type === 'model-control-native') {
      window.delayedNative = event.detail;
      return true;
    }
    return dispatch(event);
  };

  let native = null,
    nativeEvents = 0,
    keyboardActivations = 0,
    busy = false,
    pointerDown = null,
    pointer = null;
  const errors = [];
  const motion = [];
  window.resetMotion = () => {
    motion.length = 0;
  };
  let lastFrame = 0;
  function frame(now) {
    if (window.recordMotion && native?.animating && lastFrame) {
      motion.push({ theme: native.theme, dt: now - lastFrame });
      if (motion.length > 1200) motion.shift();
    }
    lastFrame = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  window.addEventListener('model-control-pointer', (event) => {
    pointer = event.detail;
  });
  window.addEventListener('model-control-native', (event) => {
    if (event.detail.keyboard && !native?.keyboard) keyboardActivations++;
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
          heldScenes: window.heldScenes.length,
          delayedNative: window.delayedNative,
          clip: getComputedStyle(document.getElementById('surface')).clipPath,
          motion,
          keyboardActivations,
          errors,
          pointerDown,
          pointer,
          background: getComputedStyle(document.getElementById('surface')).backgroundColor,
          handleBackground: getComputedStyle(document.getElementById('surface')).backgroundColor,
          hasFocus: document.hasFocus(),
          active: document.activeElement?.id,
          path: location.pathname,
          viewport: [innerWidth, innerHeight],
          searchRect: document.getElementById('menu-button')?.getBoundingClientRect().toJSON(),
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
    if (path.endsWith('/window')) {
      windowPolls++;
      return json({ valid, preferences: prefs, reveal, appearance, host: hostPresence });
    }
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
    let source = readFileSync(join(root, files[path]), 'utf8');
    if (path === '/model-control/app.js') {
      // Wry's IPC object is immutable: fault-inject only the fixture's transport call.
      const call = 'window.ipc.postMessage(JSON.stringify(message))';
      assert.ok(source.includes(call));
      source = source.replace(call, 'window.fixturePostMessage(JSON.stringify(message))');
    }
    return response.end(source);
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
async function capture(name) {
  const info = windowInfo();
  const path = join(output, `${name}.png`);
  try {
    await new Promise((resolve, reject) =>
      execFile('screencapture', ['-x', '-l', String(info.kCGWindowNumber), path], (error) =>
        error ? reject(error) : resolve(),
      ),
    );
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
  await until(() => telemetry?.heldScenes > 0, 'initial scene laid out while presentation is held');
  assert.equal(telemetry.native.painted, false);
  assert.ok(!windowInfo() || windowInfo().kCGWindowAlpha === 0);
  await ipc({ action: 'scene-ready', revision: telemetry.native.sceneRevision - 1 });
  await delay(150);
  assert.equal(telemetry.native.painted, false);
  assert.ok(!windowInfo() || windowInfo().kCGWindowAlpha === 0);
  await command('window.releaseScenes()');
  await until(
    () =>
      telemetry?.native?.painted &&
      telemetry.native.shell.width === 10 &&
      telemetry.native.shell.height === 80,
    'initial compact',
  );
  assert.equal(telemetry.native.expanded, false);
  assert.equal(telemetry.native.keyboard, false);
  const initial = windowInfo();
  assert.equal(initial.kCGWindowBounds.Width, 480);
  assert.deepEqual(telemetry.viewport, [480, initial.kCGWindowBounds.Height]);
  check('initial painted compact shell has a prepared stable viewport', initial.kCGWindowBounds);
  check('initial presentation waits for current scene and rejects stale paint acknowledgements');
  assert.equal(telemetry.native.allSpaces, true);
  assert.equal(telemetry.native.fullScreenAuxiliary, true);
  const screen = telemetry.native.screen;
  check('all-Spaces panel starts without host focus or visibility', initial.kCGWindowBounds);
  for (const presence of [
    { visible: true, focused: true },
    { visible: true, focused: false },
    { visible: false, focused: false },
    null,
  ]) {
    hostPresence = presence;
    const before = windowPolls;
    await until(() => windowPolls > before + 1, 'host presence consumed');
    assert.ok(windowInfo(), 'Host presence must not hide the display control');
    assert.equal(telemetry.native.screen, screen);
    assert.equal(telemetry.native.keyboard, false);
    assert.equal(telemetry.native.expanded, false);
  }
  await ipc({ action: 'focus' });
  await until(() => telemetry.native.keyboard && telemetry.native.expanded, 'focus without host');
  check(
    'host hide, blur and disconnect preserve display placement; explicit focus remains available',
  );
  await ipc({ action: 'collapse' });
  await until(() => !telemetry.native.expanded && !telemetry.native.animating, 'restore compact');
  // Re-arm hover after the explicit collapse before testing pointer entry.
  await command(
    "window.dispatchEvent(new CustomEvent('model-control-pointer',{detail:{inside:false,buttons:0,hoverSuppressed:false}}))",
  );
  hostPresence = { visible: true, focused: true };

  if (environment.canPostEvents) {
    const bounds = windowInfo().kCGWindowBounds;
    execFileSync(inputProbe, [
      'move',
      String(bounds.X + telemetry.native.compactX + 5),
      String(bounds.Y + telemetry.native.compactY + 40),
    ]);
  } else {
    await command(
      "window.dispatchEvent(new CustomEvent('model-control-pointer',{detail:{inside:true,buttons:0,hoverSuppressed:false}}))",
    );
  }
  await until(
    () => telemetry.native.expanded && telemetry.native.animating,
    'unfold starts immediately',
  );
  assert.ok(telemetry.native.unfold > 0 && telemetry.native.unfold < 1);
  const intermediate = windowInfo().kCGWindowBounds;
  assert.equal(intermediate.Width, 480);
  assert.ok(telemetry.native.shell.width > 10 && telemetry.native.shell.width < 480);
  assert.ok(Math.abs(telemetry.native.shell.x + telemetry.native.shell.width - 480) < 0.001);
  await capture('unfold-middle');
  check('native contour unfolds against a fixed screen edge inside a stable window');
  await until(() => telemetry.native.expanded && !telemetry.native.animating, 'unfold settles');
  assert.equal(telemetry.native.keyboard, false);
  assert.equal(
    JSON.parse(execFileSync(inputProbe, ['state'], { encoding: 'utf8' })).frontmost,
    environment.frontmost,
  );
  check(
    environment.canPostEvents
      ? 'real native hover expands without stealing focus'
      : 'synthetic native pointer message expands without stealing focus',
  );
  await capture('expanded');
  const stableBounds = windowInfo().kCGWindowBounds;
  await command('window.deferNative = true');
  await ipc({ action: 'collapse' });
  await until(
    () =>
      telemetry.delayedNative &&
      !telemetry.delayedNative.animating &&
      !telemetry.delayedNative.expanded,
    'native collapse while JS geometry is delayed',
  );
  assert.equal(telemetry.native.expanded, true, 'page has not received the collapse');
  assert.equal(telemetry.delayedNative.shell.width, 10);
  assert.deepEqual(windowInfo().kCGWindowBounds, stableBounds);
  assert.equal(telemetry.clip, 'none');
  await capture('delayed-webview-native-compact');
  await command(
    "window.deferNative = false; window.dispatchEvent(new CustomEvent('model-control-native',{detail:window.delayedNative}))",
  );
  await until(() => !telemetry.native.expanded, 'deliver held native geometry');
  check('native contour collapses independently while WebView geometry delivery is withheld');
  await ipc({ action: 'expand' });
  await until(
    () => telemetry.native.expanded && !telemetry.native.animating,
    'restore after delayed delivery',
  );

  await ipc({ action: 'collapse' });
  await until(
    () =>
      !telemetry.native.expanded && telemetry.native.animating && telemetry.native.unfold < 0.85,
    'reverse while collapsing',
  );
  assert.ok(telemetry.native.unfold > 0);
  await ipc({ action: 'expand' });
  await until(() => telemetry.native.expanded && telemetry.native.animating, 'reverse toward open');
  assert.ok(telemetry.native.unfold > 0 && telemetry.native.unfold < 1);
  await until(() => telemetry.native.expanded && !telemetry.native.animating, 'reversal settles');
  check('native unfold reverses before collapse completes');

  assert.equal(telemetry.native.keyboard, false);
  if (environment.canPostEvents) {
    const bounds = windowInfo().kCGWindowBounds,
      search = telemetry.searchRect;
    execFileSync(inputProbe, [
      'click',
      String(bounds.X + search.x + search.width / 2),
      String(bounds.Y + search.y + search.height / 2),
    ]);
  } else {
    await command("document.getElementById('menu-button').click()");
  }
  await until(
    () => telemetry.native.keyboard && telemetry.hasFocus,
    'explicit first-click keyboard focus',
  );
  check(
    environment.canPostEvents
      ? 'real first menu click acquires key focus'
      : 'synthetic menu click acquires key focus (real first click not verified)',
    { native: telemetry.native, pointerDown: telemetry.pointerDown, hasFocus: telemetry.hasFocus },
  );
  const events = telemetry.keyboardActivations;
  await delay(2200);
  assert.equal(
    telemetry.keyboardActivations,
    events,
    'unchanged backend polling must not refocus the page',
  );
  check('unchanged polls do not repeatedly acquire keyboard focus', {
    keyboardActivations: events,
  });

  await ipc({ action: 'collapse' });
  await until(
    () => !telemetry.native.expanded && !telemetry.native.animating && !telemetry.native.keyboard,
    'collapse',
  );
  assert.equal(windowInfo().kCGWindowBounds.Width, 480);
  assert.equal(telemetry.native.shell.width, 10);
  check('collapse retains prepared viewport and shrinks only the native contour');
  await command("document.getElementById('panel').dispatchEvent(new PointerEvent('pointerleave'))");
  prefs.keepOpen = true;
  revision++;
  await until(
    () => telemetry.native.expanded && !telemetry.native.animating && telemetry.native.keepOpen,
    'keepOpen preference',
  );
  await ipc({ action: 'collapse' });
  await until(
    () => !prefs.keepOpen && !telemetry.native.expanded && !telemetry.native.animating,
    'explicit collapse overrides keepOpen',
  );
  check('explicit collapse persists keepOpen=false');

  await ipc({ action: 'edge', edge: 'left' });
  await until(() => prefs.edge === 'left' && telemetry.native.edge === 'left', 'left edge');
  await capture('left-compact');
  check('left compact', windowInfo().kCGWindowBounds);
  await ipc({ action: 'edge', edge: 'top' });
  await until(() => prefs.edge === 'top' && telemetry.native.edge === 'top', 'top edge');
  const top = windowInfo().kCGWindowBounds;
  assert.equal(telemetry.native.shell.width, telemetry.native.compactWidth);
  assert.equal(telemetry.native.shell.height, telemetry.native.compactHeight);
  assert.ok(
    Math.abs(telemetry.native.shell.y + telemetry.native.shell.height - top.Height) < 0.001,
  );
  if (telemetry.native.notchWidth > 0)
    assert(telemetry.native.shell.width >= telemetry.native.notchWidth + 20);
  await capture('top-compact');
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
  await until(
    () => telemetry.native.expanded && !telemetry.native.animating && telemetry.native.keyboard,
    'subsequent reveal',
  );
  check('subsequent reveal expands with keyboard focus');
  await capture('top-expanded');
  // Material reparenting can send a real pointerleave while the pointer is outside.
  // Keep the screenshot subject open; collapse behavior is exercised above.
  await command("document.getElementById('keep-open').click()");
  await until(() => telemetry.native.keepOpen && prefs.keepOpen, 'pin material screenshots');
  // Workbench changes do not replace the control's own default.
  Object.assign(appearance, { material: 'native-glass', liquidVariant: 'clear' });
  await until(
    () => telemetry.native.appearance?.material === 'native-glass',
    'workbench appearance',
  );
  assert.equal(telemetry.native.effectiveMaterial, 'black');
  for (const material of ['black', 'matte']) {
    prefs.theme = material;
    for (const hostTheme of ['light', 'dark', 'light']) {
      appearance.hostTheme.theme = hostTheme;
      await until(
        () =>
          telemetry.native.theme === material &&
          telemetry.native.appearance?.hostTheme?.theme === hostTheme &&
          telemetry.native.nativeDark === (material === 'black' || hostTheme === 'dark'),
        'Codex native theme with pure-black exception',
      );
    }
  }
  await command('window.resetMotion(); window.recordMotion = true');
  for (const [theme, variant, style] of [
    ['black', 'regular', null],
    ['matte', 'regular', null],
    ['frosted', 'regular', 'frosted-hud-active'],
    ['native-glass', 'regular', 'regular'],
    ['native-glass', 'clear', 'clear'],
    ['black', 'regular', null],
  ]) {
    Object.assign(prefs, { theme, liquidVariant: variant });
    await until(
      () =>
        telemetry.native.theme === theme &&
        telemetry.native.liquidVariant === variant &&
        !telemetry.native.animating,
      `theme ${theme}/${variant}`,
    );
    const fallback = theme === 'native-glass' && !telemetry.native.nativeGlassAvailable;
    const effective = fallback ? 'matte' : theme;
    assert.equal(telemetry.native.effectiveMaterial, effective);
    const backed = ['frosted', 'native-glass'].includes(effective);
    assert.equal(telemetry.native.nativeBackdrop, backed);
    assert.equal(telemetry.native.backdropStyle, fallback ? null : style);
    const bounds = windowInfo().kCGWindowBounds;
    assert.ok(
      bounds.Width >= telemetry.native.layoutWidth &&
        bounds.Width <= telemetry.native.layoutWidth + 1,
    );
    assert.deepEqual(telemetry.viewport, [bounds.Width, bounds.Height]);
    if (fallback)
      report.skipped.push({
        name: `native glass ${variant}`,
        reason: 'NSGlassEffectView unavailable; matte fallback verified',
      });
    assert.equal(
      telemetry.native.nativeDark,
      theme === 'black' || appearance.hostTheme.theme === 'dark',
    );
    if (theme === 'black') assert.equal(telemetry.background, 'rgb(0, 0, 0)');
    else if (effective === 'frosted') assert.equal(telemetry.background, 'rgba(0, 0, 0, 0)');
    else if (effective === 'native-glass')
      assert.notEqual(telemetry.background, 'rgba(0, 0, 0, 0)');
    assert.ok(telemetry.viewport[1] < 320);
    check(`independent theme ${theme}/${variant}`, telemetry.native);
    await capture(`theme-${theme}-${variant}`);
    const expandedBackground = telemetry.background;
    await ipc({ action: 'collapse' });
    await until(
      () => !telemetry.native.expanded && !telemetry.native.animating,
      'compact material',
    );
    assert.equal(telemetry.native.nativeBackdrop, backed);
    assert.equal(telemetry.native.backdropStyle, fallback ? null : style);
    assert.equal(telemetry.handleBackground, expandedBackground);
    assert.equal(Math.min(telemetry.native.shell.width, telemetry.native.shell.height), 10);
    await capture(`compact-${theme}-${variant}`);
    check(`compact retains ${theme}/${variant} material`);
    await ipc({ action: 'expand', keyboard: true });
    await until(
      () => telemetry.native.expanded && !telemetry.native.animating,
      'restore expanded material',
    );
  }
  await command("location.href='https://example.invalid/blocked-navigation'");
  await delay(500);
  assert.equal(telemetry.path, '/model-control');
  check('external top-level navigation denied');
  report.motion = Object.fromEntries(
    ['black', 'matte', 'frosted', 'native-glass'].map((theme) => {
      const samples = telemetry.motion
        .filter((s) => s.theme === theme)
        .map((s) => s.dt)
        .sort((a, b) => a - b);
      return [
        theme,
        {
          samples: samples.length,
          p95: samples[Math.floor(samples.length * 0.95)],
          max: samples.at(-1),
        },
      ];
    }),
  );
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
