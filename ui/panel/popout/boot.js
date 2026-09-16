/*
 * [INPUT]: 带令牌和租约的启动链接、本机 panel API 与 Wry IPC。
 * [OUTPUT]: window.__companionPopout、投影同步、原生背景几何/材质/收放状态、系统明暗切换结果及受限请求/手势桥接。
 * [POS]: 系统窗口页面引导层，复用共享胶囊而不采集聊天正文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token') || sessionStorage.getItem('companion-popout-token');
  const lease = params.get('lease') || sessionStorage.getItem('companion-popout-lease');
  if (token) sessionStorage.setItem('companion-popout-token', token);
  if (lease) sessionStorage.setItem('companion-popout-lease', lease);
  history.replaceState(null, '', '/panel');
  document.documentElement.dataset.presentation = 'popout';
  const pendingSizes = new Map();
  let sizeSequence = 0;
  let started = false;
  let stopped = false;
  let saveTimer = 0;
  let moveTimer = 0;
  let noticeTimer = 0;
  let themePending = false;
  let lastSaved = '';
  let failures = 0;
  let revision;
  let webRevision;
  let saving = Promise.resolve();
  let lastPosition = '';

  async function request(path, input = {}) {
    const response = await fetch(`/api/panel/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lease, ...input }),
      signal: AbortSignal.timeout(path === 'request' ? 310000 : 8000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '浮窗连接中断');
    return result;
  }
  function native(message) {
    window.ipc?.postMessage(JSON.stringify(message));
  }
  // Only geometry follows DOM/animation changes. The desktop backdrop is composited by AppKit.
  if (window.__companionNativeBackdrop) {
    document.documentElement.dataset.nativeBackdrop = 'true';
    let frame = 0;
    let lastGeometry = '';
    function syncBackdrop() {
      const panel = window.__companionFloatingPanel?.state;
      const glass = panel?.glass;
      const rect = glass?.getBoundingClientRect();
      const style = glass && getComputedStyle(glass);
      const geometry = JSON.stringify({
        kind: 'backdrop',
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        hidden: !rect || !panel.runtimeActive,
        x: rect?.x,
        y: rect?.y,
        width: rect?.width,
        height: rect?.height,
        radius: style ? parseFloat(style.borderTopLeftRadius) : 0,
        material: panel?.material,
        liquidVariant: panel?.liquidVariant === 'clear' ? 'clear' : 'regular',
        open: panel?.open !== false,
      });
      if (geometry !== lastGeometry) {
        lastGeometry = geometry;
        window.ipc.postMessage(geometry);
      }
      if (!frame && glass?.getAnimations().some((animation) => animation.playState === 'running')) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          syncBackdrop();
        });
      }
    }
    // AppKit must receive appearance/visibility changes even when WebKit pauses frames.
    // Frames only sample geometry during an animation; mutations publish immediately.
    new MutationObserver(syncBackdrop).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    window.addEventListener('resize', syncBackdrop);
    syncBackdrop();
  }
  function notice(message) {
    const target = document.getElementById('popout-notice');
    if (target) target.textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (target) target.textContent = '';
    }, 5000);
  }
  async function size(width, height) {
    if (!window.ipc || (window.innerWidth === width && window.innerHeight === height)) return;
    const id = ++sizeSequence;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingSizes.delete(id);
        resolve();
      }, 800);
      pendingSizes.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      native({ kind: 'size', id, width, height });
    });
  }
  async function save(ui) {
    const fingerprint = JSON.stringify(ui);
    if (!started || fingerprint === lastSaved) return;
    const result = await request('preferences', { ui, expectedRevision: revision });
    revision = result.revision;
    lastSaved = fingerprint;
  }
  async function dock() {
    if (stopped) return;
    clearTimeout(saveTimer);
    try {
      await request('dock', { ui: window.__companionFloatingPanel?.panelPreferences() });
      stopped = true;
      native({ kind: 'close' });
      if (!window.ipc) document.body.dataset.docked = 'true';
    } catch (error) {
      notice(error.message);
    }
  }
  async function poll() {
    if (stopped) return;
    try {
      await saving;
      const result = await request('state');
      if (revision !== undefined && result.preferences.revision < revision) {
        setTimeout(poll, 400);
        return;
      }
      revision = result.preferences.revision;
      if (webRevision !== result.preferences.webRevision) {
        webRevision = result.preferences.webRevision;
        clearTimeout(saveTimer);
        lastSaved = JSON.stringify(result.preferences.ui);
        native({ kind: 'pin', value: result.preferences.alwaysOnTop });
        const position = JSON.stringify(result.preferences.position);
        if (position !== lastPosition && result.preferences.position)
          native({ kind: 'position', ...result.preferences.position });
        lastPosition = position;
      }
      failures = 0;
      const panel = window.__companionFloatingPanel;
      if (panel?.state.runtimeActive) {
        if (!started) {
          await panel.receivePanelState(result, true);
          await request('ready');
          started = true;
          lastSaved = JSON.stringify(panel.panelPreferences());
          native({ kind: 'pin', value: result.preferences.alwaysOnTop });
          native({ kind: 'show' });
        } else {
          if (!result.ready && !result.preferences.detached) {
            stopped = true;
            native({ kind: 'close' });
            return;
          }
          await panel.receivePanelState(result, false);
        }
      }
    } catch (error) {
      failures += 1;
      window.__companionFloatingPanel?.panelDisconnected(error.message);
      if (failures >= 3) {
        stopped = true;
        native({ kind: 'close' });
        notice(error.message);
      }
    }
    if (!stopped) setTimeout(poll, 400);
  }

  window.__companionPopout = {
    request,
    native,
    toggleTheme() {
      if (themePending) return;
      if (!window.ipc) {
        notice('请在 macOS 弹出窗口中切换系统明暗。');
        return;
      }
      themePending = true;
      native({ kind: 'system-theme', dark: !matchMedia('(prefers-color-scheme: dark)').matches });
    },
    themeResult(error) {
      themePending = false;
      if (error) notice(error);
    },
    notice,
    size,
    dock,
    resized(id) {
      pendingSizes.get(id)?.();
      pendingSizes.delete(id);
    },
    moved(position) {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => request('preferences', { position }).catch(() => {}), 350);
    },
    save(ui) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saving = saving.then(() => save(ui)).catch((error) => notice(error.message));
      }, 250);
    },
    async pin(value) {
      await request('preferences', { alwaysOnTop: value });
      native({ kind: 'pin', value });
    },
  };
  window.__companionHostRequest = (raw) => {
    const input = JSON.parse(raw);
    request('request', { request: input })
      .then((value) => window.__companionDesktop?.complete(input.id, value))
      .catch((error) => window.__companionDesktop?.complete(input.id, { error: error.message }));
  };
  setTimeout(poll, 0);
})();
