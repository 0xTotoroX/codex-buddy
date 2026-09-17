/*
 * [INPUT]: 原生窗口桥接、窗口偏好与远端命令身份。
 * [OUTPUT]: 保留最新请求且所有展开视图共用的窗口尺寸（工作台最低 440）/拖动、三材质及 liquidVariant 偏好投影和受限远端操作。
 * [POS]: 窗口通信底层，不读取宿主正文或渲染业务视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { HEIGHT_KEY, IS_POPOUT, POPOUT, WIDTH_KEY } from '../runtime/constants.js';
import { shellState, storage } from '../runtime/state.js';

function panelPreferences() {
  return {
    open: IS_POPOUT || shellState.open,
    activeTab: shellState.activeTab,
    layoutMode: shellState.layoutMode,
    dockWidth: shellState.dockWidth,
    splitRatio: shellState.splitRatio,
    dockOpen: shellState.dockOpen,
    width: shellState.width,
    height: shellState.height,
    material: shellState.material,
    liquidVariant: shellState.liquidVariant,
    fontOffset: shellState.fontOffset,
    labelOnly: shellState.labelOnly,
    promptClickMode: shellState.promptClickMode,
    viewOrder: shellState.viewOrder.slice(),
  };
}

async function remotePanelAction(kind, fields = {}) {
  if (!shellState.remoteSource) {
    POPOUT.notice('Codex 尚未连接。');
    return false;
  }
  const command = {
    kind,
    instanceId: shellState.remoteSource.instanceId,
    viewToken: shellState.remoteSource.viewToken,
    context: shellState.remoteSource.context,
    promptToken: shellState.remoteSource.promptToken,
    outlineToken: shellState.remoteSource.outlineToken,
    ...fields,
  };
  try {
    let result = await POPOUT.request('command', { command });
    if (result.needsConfirmation && (await confirmPanelAppend())) {
      result = await POPOUT.request('command', {
        command: { ...command, append: true, draftFingerprint: result.draftFingerprint },
      });
    }
    if (!result.ok && !result.needsConfirmation)
      POPOUT.notice(result.message || '操作失败，请重试。');
    return result.ok === true;
  } catch (error) {
    POPOUT.notice(error.message);
    return false;
  }
}

function confirmPanelAppend() {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'csw-popout-confirm';
    dialog.innerHTML =
      '<p>输入框已有草稿。保留草稿并追加这条建议？</p><div><button type="button" data-cancel>取消</button><button type="button" data-append>保留并追加</button></div>';
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-append]').addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** @type {Promise<void> | null} */
let nativeSizeTask = null;
/** @type {[number, number] | null} */
let requestedNativeSize = null;

function sizeNativePanel(expanded) {
  if (!IS_POPOUT) return Promise.resolve();
  if (shellState.layoutMode === 'workbench') shellState.height = Math.max(440, shellState.height);
  requestedNativeSize = [shellState.width + 24, shellState.height + 24];
  if (!nativeSizeTask) {
    shellState.nativeSizeChanging = true;
    nativeSizeTask = (async () => {
      try {
        while (requestedNativeSize) {
          const size = requestedNativeSize;
          requestedNativeSize = null;
          await POPOUT.size(...size);
        }
      } finally {
        shellState.nativeSizeChanging = false;
        nativeSizeTask = null;
      }
    })();
  }
  return nativeSizeTask;
}

function nativePanelDrag(event, source) {
  const x = event.clientX,
    y = event.clientY;
  const move = (next) => {
    if (Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
    cleanup();
    if (source === 'fab') shellState.suppressFabClick = true;
    else shellState.suppressHeadFaceClick = true;
    POPOUT.native({ kind: 'drag' });
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', cleanup);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', cleanup, { once: true });
}

function nativeGestureEnded() {
  if (shellState.popover?.dataset.resizing === 'true') {
    shellState.popover.removeAttribute('data-resizing');
    storage.set(WIDTH_KEY, String(shellState.width));
    storage.set(HEIGHT_KEY, String(shellState.height));
    POPOUT.save(panelPreferences());
  }
  setTimeout(() => {
    shellState.suppressFabClick = false;
    shellState.suppressHeadFaceClick = false;
  }, 300);
}

export {
  nativeGestureEnded,
  nativePanelDrag,
  panelPreferences,
  remotePanelAction,
  sizeNativePanel,
};
