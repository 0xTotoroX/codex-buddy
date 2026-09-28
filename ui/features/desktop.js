/* [INPUT]: Feature lease and the original native window IPC.
 * [OUTPUT]: Existing desktop chrome/material and spatial enter/return transitions.
 * [POS]: Desktop surface adapter; all task/model actions stay in FeatureView.
 * [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { mountFeature } from './mount';
import { installStyle } from '../panel/core/install-styles.js';
import { workbenchHeadHtml, workbenchSettingsHtml } from '../panel/workbench/chrome.js';
import { iconSvg } from '../panel/icons/index.js';
/** @param {import('./types').Request} request */
export function startDesktop(request, id, owner) {
  installStyle();
  document.documentElement.dataset.nativeBackdrop = 'true';
  const root = document.getElementById('root');
  root.setAttribute('data-companion-stepwise-root', 'true');
  root.dataset.workbench = 'true';
  root.style.cssText =
    '--csw-default-chip-width:84px;--csw-default-chip-height:36px;--csw-default-panel-radius:24px;position:fixed;inset:12px;width:auto;height:auto;pointer-events:auto;';
  root.innerHTML = `<div class="csw-popover" data-open="true" data-morphing="false" style="position:absolute;inset:0;width:100%;height:100%"><div class="csw-glass" style="inset:0;width:100%;height:100%;border-radius:24px"></div><section class="csw-panel" style="inset:0;width:100%;height:100%;border-radius:24px"><div class="csw-workbench">${workbenchHeadHtml(true)}<div class="csw-feature-content"></div></div></section><div class="csw-resize-handle" style="position:absolute;right:0;bottom:0;width:20px;height:20px;pointer-events:auto" aria-label="调整窗口大小"></div></div>`;
  root.querySelector('.csw-workbench-controls').innerHTML =
    `<button class="csw-icon" data-pin aria-label="取消窗口置顶" aria-pressed="true">${iconSvg('pin')}</button>${workbenchSettingsHtml()}`;
  let entry,
    mounted,
    starting = false,
    shown = false,
    stopped = false,
    moving = false;
  let returning = null,
    presented = null,
    resizeTimer = 0,
    polling = false,
    failures = 0;
  const native = (message) => window.ipc?.postMessage(JSON.stringify(message));
  const call = (op, data = {}) => request({ op, id, owner, ...data });
  function error(e) {
    let message = root.querySelector('[role="alert"]');
    if (!message) {
      message = document.createElement('p');
      message.setAttribute('role', 'alert');
      root.querySelector('.csw-workbench').append(message);
    }
    message.textContent = String(e);
  }
  async function show() {
    if (shown || starting) return;
    starting = true;
    const { anchor } = await call('anchor');
    moving = true;
    return new Promise((resolve, reject) => {
      presented = async () => {
        try {
          if (entry.pending?.owner === owner) await call('ready');
          shown = true;
          starting = false;
          resolve();
          void poll();
        } catch (e) {
          starting = false;
          reject(e);
        }
      };
      native({ kind: 'show', anchor });
      if (!window.ipc) void presented();
    });
  }
  async function handoff() {
    if (returning) return returning.promise;
    const { anchor } = await call('anchor');
    moving = true;
    let finish;
    const promise = new Promise((resolve, reject) => {
      finish = (ok) => (ok ? resolve() : reject(Error('窗口返回未完成，保留原位置')));
    });
    const timeout = setTimeout(() => {
      native({ kind: 'cancel-return' });
      finish(false);
      returning = null;
    }, 1500);
    returning = {
      promise,
      finish: (ok) => {
        clearTimeout(timeout);
        finish(ok);
        returning = null;
      },
    };
    native({ kind: 'return', anchor });
    if (!window.ipc) returning.finish(true);
    return promise;
  }
  function recover() {
    if (moving) native({ kind: 'cancel-return' });
    moving = false;
    void call('cancel-move').catch(() => {});
  }
  async function dock() {
    if (!entry || entry.pending || moving) return;
    // Omit source owner so the normal handoff waits for the return animation.
    await request({ op: 'move', id, placement: entry.returnPlacement || 'overlay' });
    await poll();
  }
  Object.assign(window, {
    __companionPopout: {
      presented: () => presented?.(),
      returned: (ok) => returning?.finish(ok),
      motionFinished: () => {
        moving = false;
      },
      resized: () => {},
      moved: () => {},
      dock,
    },
    __companionFloatingPanel: { nativeGestureEnded: () => {} },
  });
  const head = root.querySelector('.csw-workbench-head');
  head
    .querySelector('.csw-workbench-face')
    .addEventListener('dblclick', () => void dock().catch(error));
  root.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      void dock().catch(error);
    }
  });
  head.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('[data-workbench-settings],[data-pin]')) return;
    const x = event.clientX,
      y = event.clientY;
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
    };
    const move = (e) => {
      if (Math.hypot(e.clientX - x, e.clientY - y) >= 5) {
        cleanup();
        native({ kind: 'drag' });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup, { once: true });
  });
  root
    .querySelector('.csw-resize-handle')
    .addEventListener('pointerdown', () => native({ kind: 'resize', corner: 'br' }));
  head
    .querySelector('[data-workbench-settings]')
    .addEventListener('click', () => void call('settings').catch(error));
  head.querySelector('[data-pin]').addEventListener('click', (event) => {
    const button = event.currentTarget,
      value = button.getAttribute('aria-pressed') !== 'true';
    native({ kind: 'pin', value });
    button.setAttribute('aria-pressed', String(value));
    button.setAttribute('aria-label', value ? '取消窗口置顶' : '窗口置顶');
  });
  function appearance(value) {
    const theme = value.surface?.theme || 'matte';
    const black = theme === 'black';
    const popover = root.querySelector('.csw-popover');
    root.dataset.material = black ? 'matte' : theme;
    root.dataset.theme = black ? 'dark' : value.theme || 'light';
    root.dataset.liquidVariant = value.surface?.liquidVariant || 'regular';
    popover.dataset.effectiveMaterial = theme === 'frosted' ? 'native-frosted' : theme;
    for (const [key, color] of Object.entries(value.colors || {}))
      root.style.setProperty(`--csw-${key}`, String(color));
    if (black) {
      root.style.setProperty('--csw-surface-opaque', '#000');
      root.style.setProperty('--csw-text', '#eee');
    }
    native({
      kind: 'backdrop',
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      hidden: false,
      x: 12,
      y: 12,
      width: innerWidth - 24,
      height: innerHeight - 24,
      radius: 24,
      material: black ? 'matte' : theme,
      theme: root.dataset.theme,
      liquidVariant: root.dataset.liquidVariant,
      open: true,
    });
  }
  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const state = await request({ op: 'state' });
      entry = state.features.find((item) => item.id === id);
      if (!entry || !((entry.owner === owner && entry.open) || entry.pending?.owner === owner)) {
        stopped = true;
        mounted?.dispose();
        native({ kind: 'close' });
        return;
      }
      if (state.appearance)
        appearance({ ...state.appearance, surface: state.appearance.themes.desktop });
      if (entry.pending?.owner === owner && !entry.pending.ready) return;
      if (!mounted) {
        native({ kind: 'size', width: entry.size[0] + 24, height: entry.size[1] + 24, id: 0 });
        mounted = mountFeature(
          root.querySelector('.csw-feature-content'),
          entry,
          owner,
          'desktop',
          request,
          () => void poll(),
          { ready: show, handoff, failed: recover },
        );
        if (entry.owner === owner) void show().catch(error);
      } else mounted.update(entry);
      failures = 0;
    } catch (e) {
      error(e);
      if (++failures >= 3) {
        stopped = true;
        native({ kind: 'close' });
      }
    } finally {
      polling = false;
    }
  }
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (entry?.owner === owner && !moving && !entry.pending)
        void call('save', { size: [innerWidth - 24, innerHeight - 24] }).catch(error);
      void poll();
    }, 350);
  });
  void poll();
  const timer = setInterval(() => {
    if (stopped) clearInterval(timer);
    else void poll();
  }, 400);
}
