/*
 * [INPUT]: 工作台偏好、宿主占位适配、运行时通知。
 * [OUTPUT]: 停靠生命周期、独立宽度与分隔比例保存、与临时收起分离的用户开关偏好。
 * [POS]: 工作台布局控制器；不导入视图和业务模块。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { createDock } from '../host/dock.js';
import { IS_POPOUT, POPOUT } from '../runtime/constants.js';
import { clamp, shellState } from '../runtime/state.js';
import { emitSignal } from '../runtime/signals.js';
import { cancelMorphAnimations } from '../core/geometry.js';
import { cancelViewAnimation } from '../core/shell.js';
import { panelPreferences } from '../popout/transport.js';
import { rememberWorkbenchReading } from './reading.js';
let dock = null;
let syncing = false;
export const isWorkbench = () => shellState.layoutMode === 'workbench';
// 内嵌偏好由既有 desktop_status / observe_panel_ui 同步；不另开保存通道。
export function saveWorkbench() {
  if (IS_POPOUT) POPOUT.save(panelPreferences());
}
export function setWorkbench(enabled) {
  cancelMorphAnimations();
  cancelViewAnimation();
  shellState.viewTransitioning = false;
  shellState.dragCleanup?.();
  shellState.resizeCleanup?.();
  shellState.viewReorderCleanup?.();
  shellState.contentFadeCleanup?.();
  shellState.contentFadeCleanup = null;
  shellState.layoutMode = enabled ? 'workbench' : 'capsule';
  shellState.dockOpen = true;
  shellState.open = true;
  shellState.workbenchSettings = false;
  if (!enabled) stopWorkbench();
  else dock?.reopen();
  emitSignal('render', { allowDuringTransition: true });
  saveWorkbench();
}
export function closeWorkbench() {
  shellState.dockOpen = false;
  emitSignal('render', undefined);
  saveWorkbench();
}
export function syncWorkbench() {
  if (!isWorkbench()) {
    stopWorkbench();
    return;
  }
  if (IS_POPOUT) return;
  syncing = true;
  if (!dock)
    dock = createDock(
      (value) => {
        shellState.dockStatus = value.status;
        shellState.dockRect = value.rect;
        if (!syncing) emitSignal('render', undefined);
      },
      () => {
        shellState.dockOpen = true;
        dock.reopen();
        emitSignal('render', undefined);
        saveWorkbench();
      },
      () => {
        emitSignal('windowToggle', undefined);
      },
      () => setWorkbench(false),
      () => rememberWorkbenchReading(shellState.panel),
    );
  dock.update({
    width: clamp(shellState.dockWidth, 300, 460),
    open: shellState.dockOpen,
    detached: shellState.detached,
  });
  syncing = false;
}
export function attachWorkbenchRoot() {
  if (!IS_POPOUT) dock?.attachRoot(shellState.root);
}
export function stopWorkbench() {
  shellState.workbenchLayoutCleanup?.();
  shellState.workbenchLayoutCleanup = null;
  dock?.destroy();
  dock = null;
  shellState.dockRect = null;
  shellState.dockStatus = '';
}
