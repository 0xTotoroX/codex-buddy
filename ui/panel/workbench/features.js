/* [INPUT]: Feature metadata, task transport, existing shell placement commands.
 * [OUTPUT]: Pilot feature selector and container-independent board mount.
 * [POS]: Presentation composition; no task mutations or chat parsing.
 * [PROTOCOL]: Keep workbench/AGENTS.md in sync. */
import { revealFeature } from './feature-host.js';
import { mountBoard } from '../../board/embed';
import { IS_POPOUT, POPOUT } from '../runtime/constants.js';
import { shellState, runtimeState, bridgeCall } from '../runtime/state.js';
import { emitSignal } from '../runtime/signals.js';
import { setWorkbench, saveWorkbench } from './layout.js';
export const featureViews = [
  { id: 'workbench', title: '工作台', context: 'chat' },
  { id: 'outline', title: '大纲', context: 'chat' },
  { id: 'board', title: '看板', context: 'tasks' },
];
/** @type {import("../../board/api").TaskRequest} */
const taskRequest = async (path, body) => {
  const result = IS_POPOUT
    ? await POPOUT.taskRequest(path, body)
    : await bridgeCall(`/${path}`, body);
  if (result.error) throw new Error(result.error);
  return result;
};
export function installFeatureControls(root) {
  const toolbar = document.createElement('div');
  toolbar.className = 'csw-feature-controls';
  toolbar.innerHTML = `<label>功能 <select aria-label="显示功能">${featureViews.map((f) => `<option value="${f.id}">${f.title}</option>`).join('')}</select></label><label>显示于 <select aria-label="功能显示位置"><option value="sidebar">侧栏</option><option value="overlay">页面浮层</option><option value="desktop">桌面窗口</option></select></label>`;
  root.querySelector('.csw-workbench-head').after(toolbar);
  if (!IS_POPOUT) {
    const launch = document.createElement('select');
    launch.setAttribute('aria-label', '独立打开功能');
    launch.innerHTML =
      '<option value="">独立打开…</option><option value="outline">大纲</option><option value="board">看板</option><option value="next">下一步</option><option value="model">模型快切</option>';
    launch.onchange = () => {
      const id = launch.value;
      launch.value = '';
      if (id) void revealFeature(id).catch((e) => alert(String(e)));
    };
    toolbar.append(launch);
  }
  /** @type {HTMLSelectElement} */ (
    toolbar.querySelector('select[aria-label="显示功能"]')
  ).onchange = (event) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    shellState.feature = value === 'outline' || value === 'board' ? value : 'workbench';
    emitSignal('render', undefined);
    saveWorkbench();
  };
  /** @type {HTMLSelectElement} */ (
    toolbar.querySelector('select[aria-label="功能显示位置"]')
  ).onchange = (event) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    if (IS_POPOUT) {
      if (value !== 'desktop') {
        shellState.layoutMode = value === 'sidebar' ? 'workbench' : 'capsule';
        shellState.dockOpen = true;
        emitSignal('windowToggle', { expand: true });
      }
    } else if (value === 'desktop') emitSignal('windowToggle', undefined);
    else setWorkbench(value === 'sidebar', { expanded: true });
    if (root.isConnected) updateFeatureControls(root);
  };
}
export function updateFeatureControls(root) {
  root.dataset.feature = shellState.feature;
  root.querySelector('[aria-label="显示功能"]').value = shellState.feature;
  const placement = root.querySelector('[aria-label="功能显示位置"]');
  placement.value = IS_POPOUT
    ? 'desktop'
    : shellState.layoutMode === 'workbench'
      ? 'sidebar'
      : 'overlay';
  placement.querySelector('[value="desktop"]').disabled =
    !IS_POPOUT && runtimeState.settings?.popoutSupported !== true;
  const show = shellState.feature === 'board';
  let mount = root.querySelector('.csw-board-mount');
  if (show && !mount) {
    mount = document.createElement('div');
    mount.className = 'csw-board-mount';
    root.append(mount);
    const dispose = mountBoard(mount, taskRequest, shellState.taskView);
    shellState.featureCleanup = () => {
      dispose();
      shellState.featureCleanup = null;
    };
  }
  if (mount) {
    mount.hidden = !show;
    mount.inert = !show;
  }
  root.querySelector('.csw-workbench-panes').hidden = show || shellState.workbenchSettings;
}
