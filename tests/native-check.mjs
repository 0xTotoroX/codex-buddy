/*
 * [INPUT]: 编译后的系统窗口、合成投影；完整验收另需 Swift 背景窗口和 macOS 屏幕录制权限。
 * [OUTPUT]: target/reports/native 中的背景验收；--appearance-only 将免截图的宿主强调色同步、主题与传统磨砂 HUDWindow/Active 状态、液态 Regular/Clear 切换及拒绝收起回读检查写入 native-appearance。
 * [POS]: 原生合成验收；仅启动自有测试窗口，临时数据不使用真实宿主或模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { prepareTestBinary } from '../scripts/verify.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fixtureSettings, fixtureTypography } from './fixtures.mjs';
import { buildPanel } from '../scripts/build-panel.mjs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
if (process.platform !== 'darwin')
  throw Error('Native backdrop acceptance requires macOS and Screen Recording permission.');
const root = resolve(import.meta.dirname, '..');
const artifact = prepareTestBinary();
const appearanceOnly = process.argv.includes('--appearance-only');
const dir = mkdtempSync(join(tmpdir(), 'buddy-native-'));
const output = root + '/target/reports/' + (appearanceOnly ? 'native-appearance' : 'native');
mkdirSync(output, { recursive: true });
rmSync(join(output, 'report.json'), { force: true });
const helper = join(dir, 'native-probe');
if (!appearanceOnly) execFileSync('swiftc', [join(root, 'tests/native-probe.swift'), '-o', helper]);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const settings = fixtureSettings;
let ui = {
  open: true,
  width: 404,
  height: 420,
  activeTab: 'next',
  material: 'frosted',
  fontOffset: 0,
  labelOnly: false,
  promptClickMode: 'fill',
  viewOrder: ['next', 'outline'],
};
let state = {
  preferences: { detached: true, alwaysOnTop: true, ui },
  ready: true,
  snapshot: {
    instanceId: 'fixture',
    context: { sessionId: 'synthetic' },
    answerHash: 'one',
    viewToken: 'one',
    promptToken: 'one',
    outlineToken: 'one',
    prompts: [],
    outlineItems: [],
    outlineStatus: 'ready',
    outlineError: '',
    bridgeStatus: 'manual-ready',
    bridgeError: '',
    scanBusy: false,
    scanStatus: 'ready',
    theme: 'light',
    hostTypography: fixtureTypography,
    settings,
    sourceLabel: 'CodexBuddy · 合成测试',
  },
};
let commands = [],
  telemetry = null;
const events = [];
const requests = [];
const script = await buildPanel();
function probePage() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const panel = window.__companionFloatingPanel;
      const current = panel?.state;
      const response = await fetch('/probe', {
        method: 'POST',
        body: JSON.stringify({
          sentAt: Date.now(),
          visibility: document.visibilityState,
          active: current?.runtimeActive,
          open: current?.open,
          material: current?.material,
          viewport: [innerWidth, innerHeight],
          activeTab: current?.activeTab,
          glassStyleButton: Boolean(document.querySelector('[data-action=glass-style]')),
          materialLabel: document.querySelector('[data-material-value]')?.textContent,
          nativeGlassStyle: window.__companionNativeGlassStyle,
          theme: current?.theme,
          sourceTheme: current?.remoteSource?.theme,
          accentColor:
            current?.root && getComputedStyle(current.root).getPropertyValue('--csw-accent').trim(),
          nativeDark: matchMedia('(prefers-color-scheme: dark)').matches,
          errors: window.probeErrors,
          native: window.__companionNativeBackdrop,
          nativeGlassAvailable: window.__companionNativeGlass,
          effectiveMaterial: current?.popover?.dataset.effectiveMaterial,
          nativeDataset: document.documentElement.dataset.nativeBackdrop,
          headHeight: document.querySelector('.csw-head')?.getBoundingClientRect().height,
          eyeBox:
            document.querySelector('.csw-fab-eye') &&
            getComputedStyle(document.querySelector('.csw-fab-eye')).boxSizing,
          rect: current?.glass?.getBoundingClientRect(),
          animations: current?.glass?.getAnimations().filter((a) => a.playState === 'running')
            .length,
        }),
      });
      for (const cmd of await response.json()) {
        if (cmd.kind === 'tab') document.querySelector('button[data-view="settings"]')?.click();
        if (cmd.kind === 'open') panel.setOpen(cmd.value);
        if (cmd.kind === 'viewport')
          window.__companionPopout.native({
            kind: 'size',
            width: cmd.width,
            height: cmd.height,
            id: 0,
          });
        if (cmd.kind === 'stale-backdrop')
          window.__companionPopout.native({
            kind: 'backdrop',
            material: 'matte',
            viewportWidth: 9999,
            viewportHeight: 9999,
          });
        if (cmd.kind === 'material') panel.setMaterial(cmd.value);
        if (cmd.kind === 'liquid-variant')
          document.querySelector('[data-action=liquid-variant]')?.click();
        if (cmd.kind === 'cycle-material')
          document.querySelector('[data-action=material]')?.click();
        if (cmd.kind === 'close') window.ipc.postMessage(JSON.stringify({ kind: 'close' }));
      }
    } finally {
      busy = false;
    }
  }, 80);
}
const probe = `(${probePage.toString()})();`;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  requests.push({ at: Date.now(), path: req.url, theme: state.snapshot.theme });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/panel') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      readFileSync(root + '/ui/panel/popout/index.html', 'utf8').replace(
        '</head>',
        `<script>window.probeErrors=[];window.addEventListener('error',e=>window.probeErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.probeErrors.push(String(e.reason)));</script><script src="/probe.js" defer></script></head>`,
      ),
    );
    return;
  }
  if (req.url === '/panel.js' || req.url === '/panel-boot.js' || req.url === '/probe.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      req.url === '/panel.js'
        ? script
        : req.url === '/probe.js'
          ? probe
          : readFileSync(root + '/ui/panel/popout/boot.js'),
    );
    return;
  }
  if (req.url === '/probe') {
    telemetry = data;
    events.push(data);
    res.end(JSON.stringify(commands.splice(0)));
    return;
  }
  if (req.url === '/api/panel/request') {
    res.end(JSON.stringify({ settings }));
    return;
  }
  if (req.url === '/api/panel/preferences') {
    if (data.ui) ui = state.preferences.ui = data.ui;
    res.end('{}');
    return;
  }
  if (req.url === '/api/panel/state') {
    res.end(JSON.stringify(state));
    return;
  }
  res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
writeFileSync(
  dir + '/runtime.json',
  JSON.stringify({
    pid: process.pid,
    port: server.address().port,
    token: 'synthetic-native-token',
    version: '0.3.0',
    executable: artifact.binary,
  }),
);
writeFileSync(
  dir + '/panel.json',
  JSON.stringify({ detached: true, alwaysOnTop: true, ui, position: { x: 220, y: 250 } }),
);
writeFileSync(dir + '/color', 'red');
const background = appearanceOnly ? null : spawn(helper, ['board', dir + '/color']);
await delay(500);
const panel = spawn(artifact.binary, ['--data-dir', dir, 'panel-window', '--lease', 'synthetic']);
let log = '';
panel.stderr.on('data', (c) => (log += c));
panel.stdout.on('data', (c) => (log += c));
async function waitFor(fn, label) {
  for (let i = 0; i < 160; i++) {
    if (fn()) return;
    if (panel.exitCode !== null) throw Error('window exited ' + log);
    await delay(100);
  }
  throw Error(label + JSON.stringify(telemetry) + log);
}
function windows() {
  return JSON.parse(execFileSync(helper, ['windows', String(panel.pid)], { encoding: 'utf8' }));
}
function capture(name) {
  const bounds = windows()
    .filter((w) => w.kCGWindowBounds.Width > 0 && w.kCGWindowBounds.Height > 0)
    .sort(
      (a, b) =>
        b.kCGWindowBounds.Width * b.kCGWindowBounds.Height -
        a.kCGWindowBounds.Width * a.kCGWindowBounds.Height,
    )[0]?.kCGWindowBounds;
  if (!bounds) throw Error('no window ' + JSON.stringify(windows()));
  const file = output + '/' + name + '.png';
  // Preserve the transparent window gutter when reviewing rounded shadow clipping.
  if (name.endsWith('frosted-gray')) {
    execFileSync('screencapture', [
      '-x',
      '-R' + [bounds.X, bounds.Y, bounds.Width, bounds.Height].join(','),
      output + '/' + name + '-with-shadow.png',
    ]);
  }
  execFileSync('screencapture', [
    '-x',
    '-R' + [bounds.X + 12, bounds.Y + 12, bounds.Width - 24, bounds.Height - 24].join(','),
    file,
  ]);
  return { file, rgb: JSON.parse(execFileSync(helper, ['sample', file], { encoding: 'utf8' })) };
}
try {
  await waitFor(
    () => telemetry?.active && telemetry?.sourceTheme && telemetry?.rect?.width > 300,
    'no native panel',
  );
  // 未获焦点的窗口也要保持同步；跨过本机复现过的后台暂停时间再切换主题。
  const idleStart = Date.now();
  await delay(12000);
  await waitFor(() => telemetry?.sentAt >= idleStart + 11000, 'background projection suspended');
  const backgroundCheck = { idleMs: Date.now() - idleStart, visibility: telemetry.visibility };
  for (const color of ['rgb(48, 164, 108)', 'rgb(172, 73, 201)']) {
    state.snapshot.accentColor = color;
    await waitFor(() => telemetry?.accentColor === color, 'native host accent sync');
  }
  delete state.snapshot.accentColor;
  await waitFor(() => telemetry?.accentColor !== 'rgb(172, 73, 201)', 'native accent fallback');
  const themeChecks = [];
  // 宿主投影明暗不得覆盖系统窗口；网页前景跟随 WebKit 的系统颜色方案。
  for (const material of ['frosted', 'matte', 'native-glass']) {
    commands.push({ kind: 'material', value: material });
    for (const theme of ['light', 'dark', 'light']) {
      const changedAt = Date.now();
      state.snapshot.theme = theme;
      await waitFor(
        () =>
          telemetry?.sentAt >= changedAt &&
          telemetry?.material === material &&
          telemetry?.sourceTheme === theme &&
          telemetry.theme === (telemetry.nativeDark ? 'dark' : 'light'),
        'native appearance mismatch: ' + material + ' ' + theme,
      );
      themeChecks.push({
        material,
        theme,
        nativeDark: telemetry.nativeDark,
        syncMs: Date.now() - changedAt,
      });
    }
  }
  const geometryChecks = [];
  commands.push({ kind: 'material', value: 'matte' });
  commands.push({ kind: 'tab', value: 'settings' });
  await waitFor(
    () => telemetry?.material === 'matte' && telemetry?.activeTab === 'settings',
    'material controls',
  );
  if (telemetry.glassStyleButton) throw Error('Obsolete glass style control remains');
  const materialChecks = [];
  for (const material of ['frosted', 'native-glass', 'matte', 'frosted', 'native-glass', 'matte']) {
    commands.push({ kind: 'cycle-material' });
    const style = material === 'frosted' ? 'frosted-hud-active' : 'regular';
    const effective =
      material === 'frosted'
        ? 'native-frosted'
        : material === 'native-glass' && telemetry.nativeGlassAvailable
          ? 'native-glass'
          : 'matte';
    await waitFor(
      () =>
        telemetry?.material === material &&
        telemetry?.effectiveMaterial === effective &&
        (material === 'matte' ||
          (material === 'native-glass' && !telemetry.nativeGlassAvailable) ||
          telemetry.nativeGlassStyle === style),
      'material mapping: ' + material,
    );
    commands.push({ kind: 'stale-backdrop' });
    await delay(200);
    if (
      material !== 'matte' &&
      telemetry.nativeGlassAvailable &&
      telemetry.nativeGlassStyle !== style
    )
      throw Error('Stale viewport message replaced native material');
    materialChecks.push({
      material,
      effective,
      actual: telemetry.nativeGlassStyle,
      label: telemetry.materialLabel,
      rect: telemetry.rect,
    });
  }
  commands.push({ kind: 'material', value: 'native-glass' });
  await waitFor(() => telemetry?.material === 'native-glass', 'liquid variant controls');
  if (telemetry.nativeGlassAvailable) {
    for (const variant of ['clear', 'regular']) {
      commands.push({ kind: 'liquid-variant' });
      await waitFor(
        () => telemetry?.open === true && telemetry.nativeGlassStyle === variant,
        'expanded native ' + variant,
      );
      materialChecks.push({
        material: 'native-glass',
        variant,
        actual: telemetry.nativeGlassStyle,
      });
    }
  }
  // Reparenting the WebView must preserve its viewport while rejecting collapse and switching materials.
  for (const material of ['native-glass', 'matte', 'frosted', 'native-glass']) {
    commands.push({ kind: 'material', value: material });
    await waitFor(() => telemetry?.material === material, 'native material selection');
    const effective =
      material === 'frosted'
        ? 'native-frosted'
        : material === 'native-glass' && telemetry.nativeGlassAvailable
          ? 'native-glass'
          : 'matte';
    await waitFor(() => telemetry?.effectiveMaterial === effective, 'native capability fallback');
    commands.push({ kind: 'open', value: false });
    await delay(500);
    await waitFor(
      () => telemetry?.open === true && telemetry?.rect?.width > 390 && !telemetry.animations,
      'popout must ignore collapse',
    );
    const expanded = telemetry.rect;
    const expandedStyle = telemetry.nativeGlassStyle;
    for (const [width, height] of [
      [524, 504],
      [428, 444],
    ]) {
      commands.push({ kind: 'viewport', width, height });
      await waitFor(
        () =>
          telemetry?.viewport?.[0] === width &&
          telemetry?.viewport?.[1] === height &&
          Math.abs(telemetry?.rect?.width - width + 24) < 1 &&
          Math.abs(telemetry?.rect?.height - height + 24) < 1,
        'native viewport resize ' + material,
      );
    }
    geometryChecks.push({
      material,
      effective,
      ignoresCollapse: true,
      expanded,
      expandedStyle,
      resized: telemetry.rect,
    });
  }
  if (telemetry.headHeight !== 48 || telemetry.eyeBox !== 'border-box')
    throw Error('WebKit capsule baseline differs from embedded layout');
  if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
  if (appearanceOnly) {
    writeFileSync(
      output + '/report.json',
      JSON.stringify(
        {
          artifact,
          scope: 'appearance-only',
          backgroundCheck,
          themeChecks,
          materialChecks,
          geometryChecks,
          telemetry,
          log,
        },
        null,
        2,
      ),
    );
    rmSync(join(output, 'failure.json'), { force: true });
    console.log(
      JSON.stringify(
        {
          artifact,
          scope: 'appearance-only',
          backgroundCheck,
          themeChecks,
          materialChecks,
          geometryChecks,
          output,
        },
        null,
        2,
      ),
    );
  } else {
    const results = [];
    for (const theme of [telemetry.nativeDark ? 'dark' : 'light']) {
      await waitFor(() => telemetry?.theme === theme, 'theme');
      for (const material of ['frosted', 'matte', 'native-glass']) {
        commands.push({ kind: 'material', value: material });
        await waitFor(() => telemetry?.material === material, 'material');
        await delay(350);
        writeFileSync(dir + '/color', 'gray');
        await delay(350);
        const gray = capture(theme + '-' + material + '-gray');
        writeFileSync(dir + '/color', 'red');
        await delay(350);
        const red = capture(theme + '-' + material + '-red');
        writeFileSync(dir + '/color', 'blue');
        const begin = Date.now();
        await delay(180);
        const blue = capture(theme + '-' + material + '-blue');
        results.push({ theme, material, gray, red, blue, elapsedMs: Date.now() - begin });
      }
    }
    commands.push({ kind: 'open', value: false });
    await delay(500);
    await waitFor(
      () => telemetry?.open === true && telemetry?.rect?.width > 390 && !telemetry.animations,
      'popout stays expanded',
    );
    const expanded = capture('expanded-after-collapse-request');
    for (const r of results) {
      const delta = Math.hypot(...r.red.rgb.map((v, i) => v - r.blue.rgb[i]));
      if (r.material === 'matte' ? delta > 0.02 : delta < 0.08)
        throw Error(
          'Backdrop color check failed: ' + r.theme + ' ' + r.material + ' delta=' + delta,
        );
    }
    const appearanceDifferences = [];
    for (const theme of ['light', 'dark']) {
      const rows = results.filter((r) => r.theme === theme);
      for (let i = 0; i < rows.length; i++)
        for (let j = i + 1; j < rows.length; j++) {
          const a = [...rows[i].red.rgb, ...rows[i].blue.rgb],
            b = [...rows[j].red.rgb, ...rows[j].blue.rgb];
          const delta = Math.hypot(...a.map((v, k) => v - b[k]));
          appearanceDifferences.push({ theme, pair: [rows[i].material, rows[j].material], delta });
          if (delta < 0.025)
            throw Error(
              'Native appearances are indistinguishable: ' +
                JSON.stringify(appearanceDifferences.at(-1)),
            );
        }
    }
    if (telemetry.native !== true || telemetry.nativeDataset !== 'true')
      throw Error('Native backdrop capability is absent');
    if (telemetry.headHeight !== 48 || telemetry.eyeBox !== 'border-box')
      throw Error('WebKit capsule baseline differs from embedded layout');
    if (telemetry.errors.length) throw Error(telemetry.errors.join('\n'));
    writeFileSync(
      output + '/report.json',
      JSON.stringify(
        {
          artifact,
          backgroundCheck,
          themeChecks,
          materialChecks,
          results,
          appearanceDifferences,
          expanded,
          telemetry,
          events: events.length,
          log,
        },
        null,
        2,
      ),
    );
    rmSync(join(output, 'failure.json'), { force: true });
    console.log(
      JSON.stringify(
        {
          artifact,
          results: results.map((x) => ({
            theme: x.theme,
            material: x.material,
            gray: x.gray.rgb,
            red: x.red.rgb,
            blue: x.blue.rgb,
            elapsedMs: x.elapsedMs,
          })),
          errors: telemetry.errors,
          output,
        },
        null,
        2,
      ),
    );
  }
} catch (e) {
  console.error(e);
  writeFileSync(
    output + '/failure.json',
    JSON.stringify(
      { telemetry, log, dir, requests: requests.slice(-80), events: events.slice(-20) },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  panel.kill();
  background?.kill();
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
