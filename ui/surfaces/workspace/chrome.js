/* [INPUT]: Presentation kind and the shared eyes/icon templates.
 * [OUTPUT]: Original workbench header, unchanged across business features.
 * [POS]: Shared shell markup; no business state or placement policy.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { statusStageHtml } from '../embedded/shell/shell.js';
import { iconSvg } from '../../shared/icons/index.js';
export function workbenchHeadHtml(desktop = false) {
  const label = desktop ? '双击收回 Codex' : '单击收起 · 双击弹出到桌面';
  return `<header class="csw-head csw-workbench-head"><button type="button" class="csw-head-face csw-workbench-face" aria-label="${label}" title="${label}">${statusStageHtml()}</button><span class="csw-workbench-source"></span><div class="csw-workbench-controls"></div></header>`;
}
export function workbenchSettingsHtml() {
  return `<button class="csw-icon" data-workbench-settings aria-label="设置" title="在浏览器中打开设置">${iconSvg('settings')}</button>`;
}
