/*
 * [INPUT]: 工作台偏好、宿主占位适配、运行时通知。
 * [OUTPUT]: 停靠生命周期与独立偏好；位置切换与开合分离，共用胶囊恢复停靠，迁移前保存表情位置与阅读。
 * [POS]: 工作台布局控制器；不导入视图和业务模块。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { createDock } from '../host/dock.js';
import { IS_POPOUT, POPOUT } from '../runtime/constants.js';
import { clamp, shellState, runtimeState } from '../runtime/state.js';
import { emitSignal } from '../runtime/signals.js';
import { cancelMorphAnimations, settleMorph } from '../core/geometry.js';
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
export function setWorkbench(enabled, { expanded = false } = {}) {
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
  shellState.open = enabled || expanded || IS_POPOUT;
  shellState.workbenchSettings = false;
  if (!enabled) stopWorkbench();
  else dock?.reopen();
  emitSignal('render', { allowDuringTransition: true });
  if (!enabled && !IS_POPOUT) settleMorph(expanded ? 1 : 0, expanded ? 'panel' : 'chip');
  saveWorkbench();
}
export function openWorkbench() {
  shellState.dockOpen = true;
  dock?.reopen();
  emitSignal('render', undefined);
  if (shellState.dockStatus === 'space') dock?.showOptions(shellState.fab?.getBoundingClientRect());
  saveWorkbench();
}
export function closeWorkbench() {
  shellState.dockOpen = false;
  emitSignal('render', undefined);
  saveWorkbench();
}
export function syncWorkbench() {
  if (IS_POPOUT) return;
  if (!isWorkbench()) {
    if (dock) stopWorkbench();
    return;
  }
  syncing = true;
  if (!dock)
    dock = createDock(
      (value) => {
        shellState.dockStatus = value.status;
        shellState.dockRect = value.rect;
        if (!syncing) emitSignal('render', undefined);
      },
      () => {
        emitSignal('windowToggle', undefined);
      },
      () => setWorkbench(false, { expanded: true }),
      () => {
        rememberWorkbenchReading(shellState.panel);
        if (shellState.dockStatus === 'open') {
          const face = shellState.panel
            ?.querySelector('.csw-workbench-face')
            ?.getBoundingClientRect();
          if (face?.width) shellState.position = { x: face.left, y: face.top };
        }
      },
    );
  dock.update({
    width: clamp(shellState.dockWidth, 300, 460),
    open: shellState.dockOpen,
    detached: shellState.detached,
    popoutSupported: runtimeState.settings?.popoutSupported === true,
  });
  syncing = false;
}
export function attachWorkbenchRoot() {
  if (!IS_POPOUT) dock?.attachRoot(shellState.root);
}
export function stopWorkbench() {
  shellState.workbenchLayoutCleanup?.();
  shellState.workbenchLayoutCleanup = null;
  shellState.panel?.querySelector('.csw-workbench')?.remove();
  dock?.destroy();
  dock = null;
  shellState.dockRect = null;
  shellState.dockStatus = '';
}
