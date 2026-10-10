/* [INPUT]: Presentation kind and the shared eyes/icon templates.
 * [OUTPUT]: Shared header spacing, desktop window actions and a separate pin slot.
 * [POS]: Shared shell markup; no business state or placement policy.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { windowControlsHtml } from './window-controls.js';
export function workbenchHeadHtml(desktop = false) {
  const label = desktop ? '双击收回 Codex' : '单击收起 · 双击弹出到桌面';
  return `<header class="csw-head csw-workbench-head" data-window="${desktop ? 'desktop' : 'embedded'}"><button hidden tabindex="-1" type="button" class="csw-head-face csw-workbench-face" aria-label="${label}" title="${label}"></button>${desktop ? windowControlsHtml() : ''}<span class="csw-workbench-source"></span><div class="csw-workbench-controls"></div></header>`;
}
