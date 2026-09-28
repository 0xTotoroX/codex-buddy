import {
  nextHtml,
  attachNextEvents,
  clearPromptInteractionTimers,
  outlineHtml,
  attachOutlineEvents,
  alignOutlineNestedText,
} from '../../workspace/legacy-content.js';
/*
 * [INPUT]: 独立功能视图、外壳状态、交互和设置视图。
 * [OUTPUT]: 紧凑胶囊及唯一展开工作台的组合渲染，业务内容委托 workspace/legacy-content；侧栏收起复用胶囊并清理编排，宿主暂时让位保留节点。
 * [POS]: 视图组合层，设置请求由 codex/runtime/settings-sync 负责。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import {
  independentFeatures,
  renderFeatureShell,
  featurePlacement,
  featureTheme,
} from '../features.js';

import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  IS_POPOUT,
  POPOVER_ID,
  POPOUT,
  ROOT_ATTR,
} from '../../../shared/constants.js';
import {
  activePaneCue,
  capsuleBoundaryPoint,
  chatBusy,
  paneCueForTrack,
} from '../../../codex/context.js';
import { refreshOutline } from '../../../codex/outline.js';
import {
  animateViewTabSelection,
  cancelViewAnimation,
  deferRender,
  fabExpressionLabel,
  prefersReducedMotion,
  resolveFabExpression,
  statusStageHtml,
  switchView,
  usesOutlineExpression,
} from './shell.js';
import {
  applyMaterial,
  iconSvg,
  installThemeObserver,
  installTypographyObserver,
  syncTheme,
} from './panel-appearance.js';
import {
  applyPosition,
  captureViewScroll,
  installContentFadeTracking,
  restoreViewScroll,
  savedPosition,
  settleMorph,
  syncContentFade,
} from './geometry.js';
import { attachSettingsEvents, settingsHtml, statusTone } from './settings-view.js';
import {
  bindGlassPointerSurface,
  installEyeTracking,
  resetGlassPointer,
  syncEyeTracking,
} from './effects.js';
import {
  bindPanelWindowControls,
  panelWindowControls,
} from '../../../codex/runtime/presentation.js';
import {
  clamp,
  contextState,
  enabledViewOrder,
  escapeAttr,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizeText,
  outlineEnabled,
  outlineState,
  runtimeState,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseState,
} from '../../../codex/runtime/state.js';
import { forceRefreshStepwise, normalizePromptState } from '../../../codex/next.js';
import {
  installPanelDrag,
  installResize,
  installViewTabReorder,
  onFabClick,
  onFaceDoubleClick,
  onFaceSecondPress,
  onFabPointerDown,
  onGlassClick,
  onHeadFaceClick,
  onWorkbenchFaceClick,
  onKeyDown,
  onPanelWheel,
  onResize,
} from './interaction.js';
import { installStyle } from './install-styles.js';
import { pushDiagnostic } from '../../../codex/runtime/diagnostics.js';
import { reloadSettings, openSettings } from '../../../codex/runtime/settings-sync.js';

import { isWorkbench, syncWorkbench, setWorkbench, attachWorkbenchRoot } from '../legacy.js';
import { renderWorkbench } from '../../workspace/legacy.js';

function viewTabHtml(view) {
  const isNext = view === 'next';
  const active = shellState.activeTab === view;
  return `<button class="csw-icon" type="button" data-view="${view}" data-reorderable="true" data-active="${active}" role="tab" aria-selected="${active}" title="${isNext ? '下一步建议' : '回答大纲'}" aria-label="${isNext ? '下一步建议' : '回答大纲'}">${iconSvg(isNext ? 'next' : 'outline')}</button>`;
}

function sourceTrackHtml(
  paneCue = { direction: 'single', angle: null },
  trackHeight = CHIP_HEIGHT,
) {
  const angle =
    Number.isFinite(shellState.sourceCueAngle) && paneCue.direction !== 'single'
      ? shellState.sourceCueAngle
      : paneCue.angle;
  const cue = paneCueForTrack({ direction: paneCue.direction, angle }, trackHeight);
  return `<span class="csw-source-track" style="--csw-source-track-height:${trackHeight}px" aria-hidden="true"><span class="csw-source-dot" data-direction="${escapeAttr(cue.direction)}" style="--csw-source-x:${cue.x}px;--csw-source-y:${cue.y}px"></span></span>`;
}

function normalizeSourceCueDelta(fromAngle, toAngle) {
  return ((toAngle - fromAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

function cancelSourceCueAnimation() {
  if (!shellState.sourceCueAnimation) return;
  cancelAnimationFrame(shellState.sourceCueAnimation);
  shellState.sourceCueAnimation = 0;
}

function applySourceCueAngle(angle, direction) {
  shellState.sourceCueAngle = angle;
  [
    [shellState.fab?.querySelector('.csw-source-dot'), CHIP_HEIGHT],
    [shellState.panel?.querySelector('.csw-head-face .csw-source-dot'), 32],
  ].forEach(([dot, trackHeight]) => {
    if (!dot) return;
    dot.setAttribute('data-direction', direction);
    if (!Number.isFinite(angle)) return;
    const point = capsuleBoundaryPoint(angle, CHIP_WIDTH, trackHeight);
    dot.style.setProperty('--csw-source-x', `${point.x}px`);
    dot.style.setProperty('--csw-source-y', `${point.y}px`);
  });
}

function animateSourceCue(paneCue) {
  if (!isCurrentRuntime()) return;
  cancelSourceCueAnimation();
  if (paneCue.direction === 'single' || !Number.isFinite(paneCue.angle)) {
    applySourceCueAngle(null, 'single');
    return;
  }

  const targetAngle = paneCue.angle;
  if (!Number.isFinite(shellState.sourceCueAngle) || prefersReducedMotion()) {
    applySourceCueAngle(targetAngle, paneCue.direction);
    return;
  }

  const startAngle = shellState.sourceCueAngle;
  const delta = normalizeSourceCueDelta(startAngle, targetAngle);
  if (Math.abs(delta) < 0.001) {
    applySourceCueAngle(targetAngle, paneCue.direction);
    return;
  }

  const duration = 180 + Math.min(1, Math.abs(delta) / Math.PI) * 120;
  const generation = runtimeState.runtimeGeneration;
  const startedAt = performance.now();
  const tick = (now) => {
    if (!isCurrentRuntime(generation)) return;
    const progress = clamp((now - startedAt) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    applySourceCueAngle(startAngle + delta * eased, paneCue.direction);
    if (progress < 1) shellState.sourceCueAnimation = requestAnimationFrame(tick);
    else {
      shellState.sourceCueAnimation = 0;
      applySourceCueAngle(targetAngle, paneCue.direction);
    }
  };
  shellState.sourceCueAnimation = requestAnimationFrame(tick);
}

function statusToneForView(expression) {
  if (shellState.activeTab === 'outline') {
    if (outlineState.outlineStatus === 'pending') return 'busy';
    if (outlineState.outlineStatus === 'error') return 'error';
    if (outlineState.outlineItems.length) return 'ready';
    return 'idle';
  }
  if (shellState.activeTab === 'settings') {
    if (!runtimeState.settingsLoaded) return 'busy';
    if (/失败|错误|不可用/i.test(runtimeState.settingsStatus)) return 'error';
    if (outlineEnabled() && !stepwiseEnabled()) return 'ready';
    if (
      stepwiseEnabled() &&
      runtimeState.settings.baseUrlConfigured &&
      runtimeState.settings.model &&
      runtimeState.settings.apiKeyConfigured
    )
      return 'ready';
    return 'idle';
  }
  return statusTone(expression);
}

function refreshControlState() {
  if (shellState.activeTab === 'settings') {
    return { blocked: false, title: '重新读取设置' };
  }
  if (shellState.activeTab === 'outline') {
    const blocked = outlineState.outlineStatus === 'pending';
    return { blocked, title: blocked ? '等待回答完成' : '刷新大纲' };
  }
  const blocked = stepwiseState.bridgeStatus === 'pending' || chatBusy();
  return { blocked, title: blocked ? '等待回答完成' : '刷新建议' };
}

function refreshCurrentView() {
  if (shellState.activeTab === 'settings') return reloadSettings();
  if (shellState.activeTab === 'outline') return refreshOutline();
  if (!stepwiseEnabled()) return;
  return forceRefreshStepwise();
}

function renderFloat(options = {}) {
  if (!isCurrentRuntime()) return;
  if (
    !options.allowDuringTransition &&
    (shellState.viewTransitioning || shellState.morphAnimation)
  ) {
    deferRender();
    return;
  }
  if (independentFeatures()) {
    installStyle();
    installFloat();
    shellState.root.style.removeProperty('display');
    const docked = featurePlacement() === 'sidebar' && shellState.dockStatus === 'open';
    if (!docked && shellState.root.parentNode !== document.body)
      document.body.append(shellState.root);
    const theme = featureTheme();
    if (theme) {
      shellState.root.dataset.surfaceTheme = theme.theme;
      shellState.root.dataset.surfaceVariant = theme.liquidVariant;
    }
    syncTheme();
    shellState.root.dataset.hidden = 'false';
    shellState.fab.dataset.expression = resolveFabExpression(Date.now());
    if (docked || shellState.open) shellState.root.dataset.workbench = 'true';
    else delete shellState.root.dataset.workbench;
    delete shellState.root.dataset.dockVisible;
    delete shellState.root.dataset.dockSuspended;
    if (featurePlacement() === 'sidebar') shellState.open = docked;
    renderFeatureShell(onWorkbenchFaceClick);
    if (featurePlacement() === 'desktop') {
      shellState.open = false;
      shellState.root.style.display = 'none';
      return;
    }
    applyMaterial({ animate: false });
    applyPosition();
    installPanelDrag();
    if (!options.preserveMorph && !shellState.morphAnimation) settleMorph(shellState.open ? 1 : 0);
    syncEyeTracking();
    return;
  }
  shellState.activeTab = normalizeActiveTab();
  syncWorkbench();
  const suspendedDock = !IS_POPOUT && isWorkbench() && shellState.dockStatus === 'suspended';
  if (suspendedDock && shellState.root) {
    shellState.root.dataset.dockSuspended = 'true';
    return;
  }
  const compactDock = !IS_POPOUT && isWorkbench() && shellState.dockStatus !== 'open';
  if (compactDock) shellState.open = false;
  if (!compactDock && (IS_POPOUT || shellState.open || isWorkbench())) {
    installStyle();
    installFloat();
    attachWorkbenchRoot();
    syncTheme();
    normalizePromptState();
    delete shellState.root.dataset.dockSuspended;
    shellState.root.dataset.workbench = 'true';
    shellState.root.dataset.dockVisible = String(
      IS_POPOUT ||
        !isWorkbench() ||
        shellState.dockStatus === 'unsupported' ||
        shellState.dockStatus === 'open',
    );
    shellState.root.dataset.hidden = 'false';
    shellState.open = true;
    shellState.popover.dataset.open = 'true';
    applyPosition();
    settleMorph(1);
    renderWorkbench(nextHtml, attachNextEvents, clearPromptInteractionTimers);
    return;
  }
  if (shellState.root) {
    delete shellState.root.dataset.workbench;
    delete shellState.root.dataset.dockVisible;
  }
  shellState.workbenchLayoutCleanup?.();
  shellState.workbenchLayoutCleanup = null;
  const viewScroll = captureViewScroll();
  clearPromptInteractionTimers();
  shellState.viewReorderCleanup?.();
  shellState.viewReorderCleanup = null;
  cancelViewAnimation();
  installStyle();
  installFloat();
  if (!shellState.fab || !shellState.popover || !shellState.panel || !shellState.glass) return;
  attachWorkbenchRoot();
  shellState.root.dataset.dockSuspended = String(
    compactDock && shellState.dockStatus === 'suspended',
  );
  syncTheme();
  normalizePromptState();
  const expressionNow = Date.now();
  const outlineExpression = usesOutlineExpression(expressionNow);
  const expression = resolveFabExpression(expressionNow);
  const expressionCount = outlineExpression
    ? outlineState.outlineItems.length
    : stepwiseState.prompts.length;
  const expressionLabel = fabExpressionLabel(expression, outlineExpression);
  const featureLabel =
    stepwiseEnabled() && outlineEnabled() ? '悬浮球' : stepwiseEnabled() ? '下一步' : '回答大纲';
  const hidden = expression === 'hidden' && !IS_POPOUT;
  if (hidden) {
    settleMorph(0);
  }
  shellState.fabExpression = expression;
  shellState.fab.dataset.expression = expression;
  shellState.fab.dataset.count = String(expressionCount);
  const faceHint = IS_POPOUT
    ? '双击收回 Codex；拖动移动窗口'
    : runtimeState.settings?.popoutSupported === true
      ? '单击展开或收起；双击弹出到桌面；拖动移动'
      : '单击展开或收起；拖动移动';
  shellState.fab.title = `${featureLabel} · ${expressionLabel} · ${faceHint}`;
  shellState.fab.setAttribute(
    'aria-label',
    shellState.open
      ? '收起'
      : expressionCount > 0 && expression === 'ready'
        ? `${featureLabel} · ${expressionLabel} · ${expressionCount} ${outlineExpression ? '个章节' : '条'}`
        : `${featureLabel} · ${expressionLabel}`,
  );
  shellState.fab.setAttribute('aria-expanded', String(shellState.open));
  shellState.root.dataset.hidden = String(hidden);
  shellState.popover.dataset.open = shellState.open ? 'true' : 'false';
  shellState.popover.dataset.expression = expression;
  shellState.popover.dataset.view = shellState.activeTab;
  applyPosition();

  const refreshState = refreshControlState();
  const refreshBlocked = refreshState.blocked;
  const refreshTitle = refreshState.title;
  const headExpression = shellState.activeTab === 'settings' ? 'curious' : expression;
  const tone = statusToneForView(expression);
  const paneCue = activePaneCue();
  const viewTabs = enabledViewOrder().map(viewTabHtml).join('');
  shellState.featureCleanup?.();
  shellState.panel.innerHTML = `
      <div class="csw-head">
        <div class="csw-head-side csw-head-left">
          <div class="csw-tabs csw-view-tabs" role="tablist" aria-label="悬浮球视图">
            <span class="csw-view-indicator" aria-hidden="true"></span>
            ${viewTabs}
          </div>
        </div>
        <button class="csw-head-face" type="button" data-action="${IS_POPOUT ? 'panel-face' : 'collapse'}" data-expression="${escapeAttr(headExpression)}" data-tone="${tone}" title="${faceHint}" aria-label="${IS_POPOUT ? '拖动窗口' : '收起'}">${statusStageHtml()}${sourceTrackHtml(paneCue, 32)}</button>
        <div class="csw-head-side csw-head-right">
          ${panelWindowControls()}
          ${IS_POPOUT ? '' : `<button class="csw-icon" data-action="workbench" title="停靠工作台" aria-label="停靠工作台">${iconSvg('dock')}</button>`}
          <button class="csw-icon" type="button" data-action="refresh" title="${escapeAttr(refreshTitle)}" aria-label="${escapeAttr(refreshTitle)}" ${refreshBlocked ? 'disabled' : ''}>${iconSvg('refresh')}</button>
        </div>
      </div>
      <div class="csw-body" data-view-body="${shellState.activeTab}">
        <div class="csw-mouth-stage" data-mouth-stage="${shellState.activeTab}">${shellState.activeTab === 'settings' ? settingsHtml() : shellState.activeTab === 'outline' ? outlineHtml() : nextHtml()}</div>
      </div>
    `;
  if (shellState.activeTab === 'outline') alignOutlineNestedText();
  animateViewTabSelection(options.viewIndicatorFrom ?? shellState.activeTab, shellState.activeTab);
  animateSourceCue(paneCue);
  restoreViewScroll(viewScroll);
  installContentFadeTracking();
  shellState.panel.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      if (
        button.dataset.reorderable === 'true' &&
        performance.now() < shellState.suppressViewTabClickUntil
      ) {
        shellState.suppressViewTabClickUntil = 0;
        return;
      }
      const nextTab = button.dataset.view || 'next';
      if (nextTab === 'settings') {
        void openSettings();
        return;
      }
      if (nextTab === shellState.activeTab) return;
      void switchView(nextTab);
    });
  });
  shellState.panel
    .querySelector('[data-action="workbench"]')
    ?.addEventListener('click', () => setWorkbench(!isWorkbench()));
  const headFace = shellState.panel.querySelector('.csw-head-face');
  headFace?.addEventListener('click', onHeadFaceClick);
  bindGlassPointerSurface(headFace);
  shellState.panel
    .querySelector("[data-action='refresh']")
    ?.addEventListener('click', () => void refreshCurrentView());
  applyMaterial({ animate: false });

  if (shellState.activeTab === 'settings') attachSettingsEvents();
  else if (shellState.activeTab === 'outline') attachOutlineEvents();
  else attachNextEvents();
  bindPanelWindowControls();
  installViewTabReorder();
  installPanelDrag();
  syncEyeTracking();
  if (!options.preserveMorph && !shellState.morphAnimation) settleMorph(shellState.open ? 1 : 0);
  if (compactDock) shellState.fab.title = '单击展开侧栏；双击移到独立窗口';
}

function installFloat() {
  if (!isCurrentRuntime()) return;
  document.querySelectorAll?.(`[${ROOT_ATTR}="true"]`).forEach((node) => {
    if (node !== shellState.root) node.remove();
  });
  if (shellState.root && document.body.contains(shellState.root)) return;

  shellState.position = savedPosition();
  shellState.root = document.createElement('div');
  shellState.root.setAttribute(ROOT_ATTR, 'true');
  shellState.root.dataset.presentation = IS_POPOUT ? 'popout' : 'embedded';
  shellState.root.dataset.detached = String(!IS_POPOUT && shellState.detached);
  shellState.root.inert = !IS_POPOUT && shellState.detached;

  shellState.fab = document.createElement('button');
  shellState.fab.className = 'csw-fab';
  shellState.fab.type = 'button';
  shellState.fab.title = '下一步';
  shellState.fab.setAttribute('aria-controls', POPOVER_ID);
  shellState.fab.innerHTML = `${statusStageHtml()}${sourceTrackHtml()}`;

  shellState.popover = document.createElement('div');
  shellState.popover.className = 'csw-popover';
  shellState.popover.dataset.open = 'false';
  shellState.popover.dataset.morphing = 'false';
  shellState.popover.dataset.completionBeam = 'false';

  shellState.glass = document.createElement('div');
  shellState.glass.className = 'csw-glass';
  shellState.glass.setAttribute('aria-hidden', 'true');

  shellState.rim = document.createElement('div');
  shellState.rim.className = 'csw-rim';
  shellState.rim.setAttribute('aria-hidden', 'true');

  shellState.completionBeam = document.createElement('div');
  shellState.completionBeam.className = 'csw-completion-beam';
  shellState.completionBeam.setAttribute('aria-hidden', 'true');

  const materialLayer = document.createElement('div');
  materialLayer.className = 'csw-material-layer';
  materialLayer.setAttribute('aria-hidden', 'true');
  materialLayer.append(shellState.glass, shellState.rim);
  materialLayer.append(shellState.completionBeam);

  shellState.panel = document.createElement('section');
  shellState.panel.id = POPOVER_ID;
  shellState.panel.className = 'csw-panel';
  shellState.panel.setAttribute('role', 'dialog');
  shellState.panel.setAttribute('aria-label', '下一步建议与回答大纲');
  shellState.panel.setAttribute('aria-hidden', 'true');
  shellState.panel.inert = true;

  const resizeBottomLeft = document.createElement('span');
  resizeBottomLeft.className = 'csw-resize-handle';
  resizeBottomLeft.dataset.corner = 'bl';
  resizeBottomLeft.setAttribute('aria-hidden', 'true');
  const resizeBottomRight = document.createElement('span');
  resizeBottomRight.className = 'csw-resize-handle';
  resizeBottomRight.dataset.corner = 'br';
  resizeBottomRight.setAttribute('aria-hidden', 'true');

  shellState.popover.append(
    materialLayer,
    shellState.fab,
    shellState.panel,
    resizeBottomLeft,
    resizeBottomRight,
  );
  shellState.root.append(shellState.popover);
  document.body.appendChild(shellState.root);

  shellState.fab.addEventListener('pointerdown', onFabPointerDown);
  shellState.popover.addEventListener('pointerdown', onFaceSecondPress, true);
  shellState.popover.addEventListener('click', onFaceDoubleClick, true);
  shellState.fab.addEventListener('click', onFabClick);
  bindGlassPointerSurface(shellState.fab);
  shellState.panel.addEventListener('wheel', onPanelWheel, { passive: false });
  shellState.glass.addEventListener('click', onGlassClick);
  resetGlassPointer();
  shellState.keyHandler = onKeyDown;
  document.addEventListener('keydown', shellState.keyHandler, true);
  window.addEventListener('resize', onResize);
  installEyeTracking();
  installThemeObserver();
  installTypographyObserver();
  syncTheme();
  applyMaterial();
  installResize();
  applyPosition();
  settleMorph(0);
}

export { cancelSourceCueAnimation, clearPromptInteractionTimers, installFloat, renderFloat };
