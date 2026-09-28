/*
 * [INPUT]: 共享胶囊源码、esbuild 与现有 buildPanel。
 * [OUTPUT]: 原子发布开发资源快照，区分 CSS、逻辑与页面引导版本；测量几何与实验后端耗时。
 * [POS]: dev.mjs 的界面构建层；正式产物不加载开发快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
    board: [...document.querySelectorAll('[data-codex-buddy-features-root]')].map((node) => {
      const board = node.shadowRoot?.querySelector('.board-app');
      const tools = board?.querySelector('.board-tools')?.getBoundingClientRect();
      const heading = [...(board?.querySelectorAll('.stage-tabs,.column-heading') || [])]
        .map((node) => node.getBoundingClientRect())
        .find((rect) => rect.width && rect.height);
      return board && tools && heading
        ? [
            board.getBoundingClientRect().width,
            tools.y + tools.height / 2,
            heading.y + heading.height / 2,
            board.querySelectorAll('.board-toolbar').length,
          ]
        : [];
    }),
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
  const builder = join(root, 'scripts/dev-panel.mjs');
  if (resolve(root) !== resolve(import.meta.dirname, '..') && existsSync(builder)) {
    const source = await import(pathToFileURL(builder).href);
    return source.buildDevPanel(root, output);
  }
  const probe = `(${measurePanel.toString()})()`;
  const inputs = [
    ...filesUnder(root, 'ui/codex'),
    ...filesUnder(root, 'ui/surfaces'),
    ...filesUnder(root, 'ui/features'),
    ...filesUnder(root, 'ui/shared'),
    'ui/settings/api.ts',
  ];
  // Shadow roots own content CSS; its updates require a draft-safe remount.
  const contentStyle = (file) =>
    file.startsWith('ui/features/') ||
    file === 'ui/surfaces/workspace/content.css' ||
    file === 'ui/surfaces/edge/styles.css';
  const code = fingerprint(
    root,
    inputs.filter((file) => !file.endsWith('.css') || contentStyle(file)),
  );
  const styles = fingerprint(
    root,
    inputs.filter((file) => file.endsWith('.css') && !contentStyle(file)),
  );
  const html = readFileSync(join(root, 'ui/surfaces/desktop/legacy/index.html'), 'utf8');
  const boot = readFileSync(join(root, 'ui/surfaces/desktop/legacy/boot.js'), 'utf8');
  const page = hash(html + boot);
  const revision = hash(code + styles);
  const panel = await buildPanel(root, true);
  const style = await build({
    absWorkingDir: root,
    stdin: {
      contents:
        "import {installStyle} from './ui/surfaces/embedded/shell/install-styles.js'; installStyle(true);",
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
    if (window.__buddyFeatureFlush && !(await window.__buddyFeatureFlush())) return;
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
  const feature = await build({
    absWorkingDir: root,
    nodePaths: [resolve(import.meta.dirname, '../node_modules')],
    entryPoints: ['ui/surfaces/main.ts'],
    bundle: true,
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'iife',
    target: 'safari17',
    write: false,
    logLevel: 'silent',
  });
  const featureCode = feature.outputFiles[0].text;
  const featureRevision = hash(featureCode);
  const featureClient = `
;(() => {
    window.__buddyFeatureRevision = ${JSON.stringify(featureRevision)};
    let updating = false;
    setInterval(async () => {
      if (updating) return;
      updating = true;
      try {
        const boardHost = [...document.querySelectorAll('.csw-feature-content > div,.edge-view')].find(node => node.shadowRoot?.querySelector('.board-app'));
        const board = boardHost?.shadowRoot.querySelector('.board-app');
        const tools = board?.querySelector('.board-tools')?.getBoundingClientRect();
        const heading = [...(board?.querySelectorAll('.stage-tabs,.column-heading') || [])]
        .map(node => node.getBoundingClientRect()).find(rect => rect.width && rect.height);
        await fetch('/api/development', {method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessionStorage.getItem('companion-token')},body:JSON.stringify({
          surface: document.getElementById('edge-panel') ? 'edge' : 'desktop',
          native:true, revision:window.__buddyFeatureRevision, roots:1,
          board:board && tools && heading ? [[board.getBoundingClientRect().width,tools.y+tools.height/2,heading.y+heading.height/2,board.querySelectorAll('.board-toolbar').length]] : []
        })});
        const next = await (await fetch('/dev-state.json', {cache:'no-store'})).json();
        if (next.feature && next.feature !== window.__buddyFeatureRevision &&
            !document.querySelector('[data-arranging="true"]') &&
            await window.__buddyFeatureFlush?.()) location.reload();
      } catch (error) { console.warn('CodexBuddy 开发更新等待重试', error.message); }
      finally { updating = false; }
    }, 800);
  })();`;
  const snapshot = {
    revision,
    featureRevision,
    featureScript: featureCode + featureClient,
    featureHtml: readFileSync(join(root, 'ui/settings/feature.html'), 'utf8').replace(
      '../surfaces/main.ts',
      '/feature-dev.js',
    ),
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
