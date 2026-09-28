/* [INPUT]: Shared main-window lease, feature owners and the original native window IPC.
 * [OUTPUT]: Existing desktop chrome/material and spatial enter/return transitions.
 * [POS]: Desktop surface adapter; all task/model actions stay in FeatureView.
 * [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { mountFeature } from './mount';
import { installFeatureLayout } from './layout';
import { installStyle } from '../panel/core/install-styles.js';
import { workbenchHeadHtml, workbenchSettingsHtml } from '../panel/workbench/chrome.js';
import { iconSvg } from '../panel/icons/index.js';
/** @param {import('./types').Request} request */
export function startDesktop(request, lease) {
  installStyle();
  document.documentElement.dataset.nativeBackdrop = 'true';
  const root = document.getElementById('root');
  root.setAttribute('data-companion-stepwise-root', 'true');
  root.dataset.workbench = 'true';
  root.style.cssText =
    '--csw-default-chip-width:84px;--csw-default-chip-height:36px;--csw-default-panel-radius:24px;position:fixed;inset:12px;width:auto;height:auto;pointer-events:auto;';
  root.innerHTML = `<div class="csw-popover" data-open="true" data-morphing="false" style="position:absolute;inset:0;width:100%;height:100%"><div class="csw-glass" style="inset:0;width:100%;height:100%;border-radius:24px"></div><section class="csw-panel" style="inset:0;width:100%;height:100%;border-radius:24px"><div class="csw-workbench">${workbenchHeadHtml(true)}</div></section><div class="csw-resize-handle" data-corner="bl" style="position:absolute;left:0;bottom:0;width:20px;height:20px;pointer-events:auto" aria-label="从左下角调整窗口大小"></div><div class="csw-resize-handle" data-corner="br" style="position:absolute;right:0;bottom:0;width:20px;height:20px;pointer-events:auto" aria-label="从右下角调整窗口大小"></div></div>`;
  root.querySelector('.csw-workbench-controls').innerHTML =
    `<button class="csw-icon" data-pin aria-label="取消窗口置顶" aria-pressed="true">${iconSvg('pin')}</button>${workbenchSettingsHtml()}`;
  const mounts = new Map();
  let state,
    selected = '',
    pinned,
    sized = false,
    showing = null,
    returnMotion = null;
  let shown = false,
    stopped = false,
    moving = false;
  let returning = null,
    presented = null,
    resizeTimer = 0,
    polling = false,
    failures = 0;
  const native = (message) => window.ipc?.postMessage(JSON.stringify(message));
  const call = (op, data = {}) => request({ op: `main-${op}`, lease, ...data });
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
    if (shown) return;
    if (showing) return showing;
    showing = (async () => {
      const { anchor } = await call('anchor');
      moving = true;
      await new Promise((resolve) => {
        presented = () => {
          shown = true;
          resolve();
        };
        native({ kind: 'show', anchor });
        if (!window.ipc) presented();
      });
    })();
    return showing;
  }
  async function handoff() {
    if (!state.pendingPlacement || state.pendingPlacement === 'desktop') return;
    if (returnMotion) return returnMotion;
    returnMotion = returnWindow();
    return returnMotion;
  }
  async function returnWindow() {
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
  function recover(id, owner, pendingOwner) {
    const current = state?.features.find((e) => e.id === id)?.pending;
    if (current && current.owner !== pendingOwner) return;
    if (moving || returnMotion) native({ kind: 'cancel-return' });
    moving = false;
    returnMotion = null;
    void request({ op: 'cancel-move', id, owner, pendingOwner }).catch(() => {});
  }
  async function dock() {
    if (!state || state.pendingPlacement || moving) return;
    await request({ op: 'main-placement', placement: state.returnPlacement || 'sidebar' });
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
    .querySelectorAll('.csw-resize-handle')
    .forEach((handle) =>
      handle.addEventListener('pointerdown', () =>
        native({ kind: 'resize', corner: handle.dataset.corner }),
      ),
    );
  head
    .querySelector('[data-workbench-settings]')
    .addEventListener('click', () => void call('settings').catch(error));
  head.querySelector('[data-pin]').addEventListener('click', (event) => {
    const button = event.currentTarget,
      value = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    void call('pin', { value })
      .then(() => {
        native({ kind: 'pin', value });
      })
      .catch(error)
      .finally(() => {
        button.disabled = false;
      });
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
  const composition = installFeatureLayout(root.querySelector('.csw-workbench'), {
    save: async (placement, layout) => {
      const item = [...mounts.values()].find((item) => item.active);
      if (item)
        await request({ op: 'layout', id: item.id, owner: item.entry.owner, placement, layout });
    },
    error,
  });
  function renderContent() {
    const items = [...mounts.values()];
    for (const item of items)
      item.node.inert = !item.active || document.documentElement.dataset.buddyReloading === 'true';
    composition.update(
      items,
      'desktop',
      state.layouts?.desktop,
      state.legacyLayouts?.desktop,
      selected,
      state.features.find((entry) => entry.id === selected)?.reveal,
    );
  }
  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const [next, windowState] = await Promise.all([request({ op: 'state' }), call('window')]);
      const groupCommitted = !!state?.pendingPlacement && !next.pendingPlacement;
      if (next.activeFeature && next.activeFeature !== state?.activeFeature)
        selected = next.activeFeature;
      state = next;
      if (!windowState.valid) {
        stopped = true;
        composition.destroy();
        for (const item of mounts.values()) item.mount.dispose();
        native({ kind: 'close' });
        return;
      }
      if (!state.pendingPlacement && returnMotion) {
        native({ kind: 'cancel-return' });
        returnMotion = null;
        moving = false;
      }
      if (state.appearance)
        appearance({ ...state.appearance, surface: state.appearance.themes.desktop });
      const pin = head.querySelector('[data-pin]');
      if (pinned !== (windowState.alwaysOnTop !== false)) {
        pinned = windowState.alwaysOnTop !== false;
        native({ kind: 'pin', value: pinned });
      }
      pin.setAttribute('aria-pressed', String(windowState.alwaysOnTop !== false));
      pin.setAttribute(
        'aria-label',
        windowState.alwaysOnTop !== false ? '取消窗口置顶' : '窗口置顶',
      );
      if (!sized) {
        const size = state.mainWindow?.size || [840, 620];
        native({ kind: 'size', width: size[0] + 24, height: size[1] + 24, id: 0 });
        sized = true;
      }
      const wanted = new Set();
      for (const entry of state.features) {
        const candidates = [
          ...(entry.open && entry.placement === 'desktop' ? [{ owner: entry.owner }] : []),
          ...(entry.pending?.placement === 'desktop' && entry.pending.ready ? [entry.pending] : []),
        ];
        for (const candidate of candidates) {
          const owner = candidate.owner,
            key = `${entry.id}:${owner}`;
          wanted.add(key);
          let item = mounts.get(key);
          if (!item) {
            const node = document.createElement('div');
            node.style.cssText = 'height:100%;min-height:0';
            item = { node, id: entry.id, entry, mount: null, active: false, reveal: entry.reveal };
            mounts.set(key, item);
            item.mount = mountFeature(node, entry, owner, 'desktop', request, () => void poll(), {
              ready: async () => {
                await show();
                await request({ op: 'ready', id: entry.id, owner });
              },
              handoff,
              failed: (pendingOwner) => recover(entry.id, owner, pendingOwner),
            });
          } else item.mount.update(entry);
          item.entry = entry;
          item.active = entry.open && entry.owner === owner;
          if (!groupCommitted && item.active && item.reveal !== entry.reveal) {
            selected = entry.id;
            if (shown && !moving) native({ kind: 'reveal' });
          }
          item.reveal = entry.reveal;
          if (item.active) void show().catch(error);
        }
      }
      for (const [key, item] of mounts)
        if (!wanted.has(key)) {
          item.mount.dispose();
          mounts.delete(key);
        }
      renderContent();
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
      if (state && !moving && !state.pendingPlacement)
        void call('size', { size: [innerWidth - 24, innerHeight - 24] }).catch(error);
      void poll();
    }, 350);
  });
  void poll();
  const timer = setInterval(() => {
    if (stopped) clearInterval(timer);
    else void poll();
  }, 400);
}
