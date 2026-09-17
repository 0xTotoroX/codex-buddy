/*
 * [INPUT]: 运行尺寸常量、分层 styles/*.css、弹出 native.css 与内嵌 glass/lab.css。
 * [OUTPUT]: installStyle 按共享变量、布局、内容、控件、材质、动画、原生覆盖与工作台布局的顺序安装胶囊样式。
 * [POS]: 胶囊样式装配层，通过版本标记复用或替换样式节点；开发时 force 原位更新。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import sharedTokens from '../../tokens.css';
import tokensCss from './styles/tokens.css';
import layoutCss from './styles/layout.css';
import contentCss from './styles/content.css';
import controlsCss from './styles/controls.css';
import materialsCss from './styles/materials.css';
import motionCss from './styles/motion.css';
import workbenchCss from '../workbench/styles.css';
import nativeCss from '../popout/native.css';
import embeddedGlassCss from '../glass/lab.css';

import {
  CHIP_HEIGHT,
  CHIP_RADIUS,
  CHIP_WIDTH,
  COMPLETION_BEAM_MS,
  DEFAULT_FONT,
  PANEL_HEIGHT,
  PANEL_RADIUS,
  PANEL_WIDTH,
  ROOT_ATTR,
  SCRIPT_VERSION,
  STYLE_ID,
  VIEW_INDICATOR_MS,
} from '../runtime/constants.js';

export function installStyle(force = false) {
  const existing = document.getElementById(STYLE_ID);
  if (!force && existing?.dataset.codexStepwiseStyleVersion === SCRIPT_VERSION) return;
  existing?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.dataset.codexStepwiseStyleVersion = SCRIPT_VERSION;
  style.textContent =
    `[${ROOT_ATTR}="true"] {--csw-default-panel-width:${PANEL_WIDTH}px;
--csw-default-panel-height:${PANEL_HEIGHT}px;
--csw-default-default-font:${DEFAULT_FONT}px;
--csw-default-chip-radius:${CHIP_RADIUS}px;
--csw-default-chip-height:${CHIP_HEIGHT}px;
--csw-default-chip-left:${Math.max(0, (PANEL_WIDTH - CHIP_WIDTH) / 2)}px;
--csw-default-chip-width:${CHIP_WIDTH}px;
--csw-default-completion-beam-ms:${COMPLETION_BEAM_MS}ms;
--csw-default-panel-radius:${PANEL_RADIUS}px;
--csw-default-view-indicator-ms:${VIEW_INDICATOR_MS}ms;}` +
    sharedTokens +
    tokensCss +
    layoutCss +
    contentCss +
    controlsCss +
    materialsCss +
    motionCss +
    nativeCss +
    embeddedGlassCss +
    workbenchCss;
  document.head.appendChild(style);
}
