/* [INPUT]: Presentation kind and the shared eyes/icon templates.
 * [OUTPUT]: Original workbench header, unchanged across business features.
 * [POS]: Shared shell markup; no business state or placement policy.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { iconSvg } from '../../shared/icons/index.js';
import { statusStageHtml } from '../embedded/shell/shell.js';
export function workbenchHeadHtml(desktop = false) {
  const label = desktop ? '双击收回 Codex' : '单击收起 · 双击弹出到桌面';
  return `<header class="csw-head csw-workbench-head"><button type="button" class="csw-head-face csw-workbench-face" aria-label="${label}" title="${label}">${statusStageHtml()}</button><span class="csw-workbench-source"></span><div class="csw-workbench-controls">${desktop ? '' : settingsEntryHtml()}</div></header>`;
}

export function bindWorkbenchSettings(root, open) {
  root.querySelector('[data-settings-entry]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    open();
  });
}

export function settingsEntryHtml() {
  return `<button type="button" class="csw-icon csw-settings-entry" data-settings-entry aria-label="打开设置" title="打开设置">${iconSvg('settings')}</button>`;
}
