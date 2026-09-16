/*
 * [INPUT]: 共享胶囊源码、esbuild 与现有 buildPanel。
 * [OUTPUT]: 原子发布开发资源快照，区分 CSS、逻辑与页面引导版本；测量几何与实验后端耗时。
 * [POS]: dev.mjs 的界面构建层；正式产物不加载开发快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildPanel } from './build-panel.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
export function filesUnder(root, directory) {
  return readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.md'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}
export function fingerprint(root, files) {
  return hash(files.map((file) => file + '\0' + readFileSync(join(root, file))).join('\0'));
}

// Geometry only: never expose conversation text through development telemetry.
function measurePanel() {
  const p = window.__companionFloatingPanel;
  if (!p) return null;
  const selectors = [
    '.csw-glass',
    '.csw-head',
    '.csw-head-face',
    '.csw-head-face .csw-fab-eye',
    '.csw-model-value',
    '.csw-control-row',
    '.csw-body',
  ];
  const base = document.querySelector('.csw-popover')?.getBoundingClientRect();
  const glass = window.__codexBuddyGlassLab?.status();
  return {
    glass: glass
      ? {
          selected: glass.selected,
          backend: glass.backend,
          phase: glass.phase,
          ms: glass.ms,
          frames: glass.frames,
        }
      : null,
    revision: window.__buddyDev?.revision,
    instance: p.instanceId,
    development: p.development === true,
    roots: document.querySelectorAll('[data-companion-stepwise-root="true"]').length,
    styles: document.querySelectorAll('#companion-stepwise-panel-style').length,
    styleBytes: document.getElementById('companion-stepwise-panel-style')?.textContent.length,
    native: Boolean(window.__companionNativeBackdrop),
    nativeGlass: Boolean(window.__companionNativeGlass),
    material: document.querySelector('.csw-popover')?.getAttribute('data-effective-material'),
    layout: selectors.map((selector) => {
      const e = document.querySelector(selector);
      if (!e) return [];
      const r = e.getBoundingClientRect(),
        c = getComputedStyle(e);
      return [
        r.x - base.x,
        r.y - base.y,
        r.width,
        r.height,
        parseFloat(c.fontSize),
        c.boxSizing === 'border-box' ? 1 : 0,
      ];
    }),
  };
}

export async function buildDevPanel(root, output) {
  const probe = `(${measurePanel.toString()})()`;
  const inputs = [
    ...filesUnder(root, 'ui/panel'),
    ...filesUnder(root, 'ui/bridge'),
    'ui/tokens.css',
  ];
  const code = fingerprint(
    root,
    inputs.filter((file) => !file.endsWith('.css')),
  );
  const styles = fingerprint(
    root,
    inputs.filter((file) => file.endsWith('.css')),
  );
  const html = readFileSync(join(root, 'ui/panel/popout/index.html'), 'utf8');
  const boot = readFileSync(join(root, 'ui/panel/popout/boot.js'), 'utf8');
  const page = hash(html + boot);
  const revision = hash(code + styles);
  const panel = await buildPanel(root, true);
  const style = await build({
    absWorkingDir: root,
    stdin: {
      contents:
        "import {installStyle} from './ui/panel/core/install-styles.js'; installStyle(true);",
      resolveDir: root,
    },
    bundle: true,
    define: { CODEX_BUDDY_DEVELOPMENT: 'true' },
    loader: { '.css': 'text' },
    format: 'iife',
    target: 'safari17',
    write: false,
    logLevel: 'silent',
  });
  const script = `window.__buddyDevUpdate = (async () => {
    const next = ${JSON.stringify({ code, styles, revision, page })};
    const previous = window.__buddyDev;
    const old = window.__companionFloatingPanel;
    if (previous?.code === next.code && old?.state.runtimeActive) {
      if (previous.styles !== next.styles) { ${style.outputFiles[0].text} }
      window.__buddyDev = next;
      return;
    }
    const ui = old?.panelPreferences();
    const detached = old?.state.detached;
    ${panel}
    const current = window.__companionFloatingPanel;
    await current?.start();
    if (window.__companionPopout && current) {
      await current.receivePanelState(await window.__companionPopout.request('state'), true);
    } else if (ui && current) {
      current.syncPanelPreferences(ui, 1, detached);
    }
    window.__buddyDev = next;
    document.documentElement.dataset.buddyDevelopment = 'true';
  })();`;
  const client = `(() => {
    if (window.__buddyDevWatching) return;
    window.__buddyDevWatching = true;
    let pending = false;
    setInterval(async () => {
      if (pending || !window.__buddyDev) return;
      pending = true;
      try {
        const state = window.__companionFloatingPanel?.state;
        if (state?.runtimeActive) await fetch('/api/development', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('companion-popout-token') },
          body: JSON.stringify(${probe}),
        });
        const next = await (await fetch('/dev-state.json')).json();
        if (next.page !== window.__buddyDev.page) { location.reload(); return; }
        if (next.revision !== window.__buddyDev.revision) await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/panel.js';
          script.onload = () => { script.remove(); Promise.resolve(window.__buddyDevUpdate).then(resolve, reject); };
          script.onerror = () => { script.remove(); reject(new Error('开发资源加载失败')); };
          document.head.append(script);
        });
      } catch (error) { console.warn('CodexBuddy 开发更新等待重试', error.message); }
      finally { pending = false; }
    }, 500);
  })();`;
  const snapshot = {
    revision,
    page,
    script,
    boot,
    client,
    probe,
    html: html
      .replace('<title>CodexBuddy</title>', '<title>CodexBuddy · 开发版</title>')
      .replace('</head>', '<script src="/dev-client.js" defer></script></head>')
      .replace(
        '<body>',
        '<body><span style="position:fixed;top:1px;left:14px;font:9px system-ui;color:#888;pointer-events:none;z-index:2147483647">开发版</span>',
      ),
  };
  const temporary = output + '.next';
  writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
  renameSync(temporary, output);
  return snapshot;
}
