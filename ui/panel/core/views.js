/*
 * [INPUT]: 独立功能视图、外壳状态、交互和设置视图。
 * [OUTPUT]: 紧凑胶囊及唯一展开工作台的组合渲染与建议预览；未知停靠宿主保留紧凑入口。
 * [POS]: 视图组合层，设置请求由 runtime/settings-sync 负责。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  FRIENDLY_BRIDGE_ERRORS,
  IS_POPOUT,
  POPOVER_ID,
  POPOUT,
  PROMPT_CLICK_DELAY_MS,
  PROMPT_PREVIEW_SWITCH_MS,
  ROOT_ATTR,
} from '../runtime/constants.js';
import { activePaneCue, capsuleBoundaryPoint, chatBusy, paneCueForTrack } from '../host/context.js';
import {
  alignOutlineNestedText,
  attachOutlineEvents,
  outlineHtml,
  refreshOutline,
} from '../outline.js';
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
  themeIcon,
  themeLabel,
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
import { bindPanelWindowControls, panelWindowControls } from '../runtime/presentation.js';
import {
  clamp,
  contextState,
  enabledViewOrder,
  escapeAttr,
  escapeHtml,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizePromptClickMode,
  normalizeText,
  outlineEnabled,
  outlineState,
  runtimeState,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseState,
} from '../runtime/state.js';
import {
  fillComposer,
  forceRefreshStepwise,
  labelForPrompt,
  normalizePromptState,
  summaryForPrompt,
} from '../stepwise.js';
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
  onKeyDown,
  onPanelWheel,
  onResize,
} from './interaction.js';
import { installStyle } from './install-styles.js';
import { pushDiagnostic } from '../runtime/diagnostics.js';
import { reloadSettings } from '../runtime/settings-sync.js';
import { toggleCodexTheme } from '../host/host-appearance.js';

import {
  isWorkbench,
  syncWorkbench,
  setWorkbench,
  attachWorkbenchRoot,
} from '../workbench/layout.js';
import { renderWorkbench } from '../workbench/view.js';

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

function bridgeErrorPresentation(error = stepwiseState.bridgeError) {
  const text = normalizeText(error);
  const match = FRIENDLY_BRIDGE_ERRORS.find((item) => item.pattern.test(text));
  return (
    match || {
      title: '生成失败，稍后重试',
      message: '',
    }
  );
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
  shellState.activeTab = normalizeActiveTab();
  syncWorkbench();
  const unsupportedDock = !IS_POPOUT && isWorkbench() && shellState.dockStatus === 'unsupported';
  if (unsupportedDock) shellState.open = false;
  if (!unsupportedDock && (IS_POPOUT || shellState.open || isWorkbench())) {
    installStyle();
    installFloat();
    attachWorkbenchRoot();
    syncTheme();
    normalizePromptState();
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
  const viewScroll = captureViewScroll();
  clearPromptInteractionTimers();
  shellState.viewReorderCleanup?.();
  shellState.viewReorderCleanup = null;
  cancelViewAnimation();
  installStyle();
  installFloat();
  if (!shellState.fab || !shellState.popover || !shellState.panel || !shellState.glass) return;
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
          <button class="csw-icon" type="button" data-action="theme" title="${escapeAttr(themeLabel())}" aria-label="${escapeAttr(themeLabel())}">${themeIcon()}</button>
          <button class="csw-icon" type="button" data-view="settings" data-active="${shellState.activeTab === 'settings'}" aria-pressed="${shellState.activeTab === 'settings'}" title="设置" aria-label="设置">${iconSvg('settings')}</button>
        </div>
      </div>
      ${isWorkbench() ? '<p class="csw-dock-warning" role="status">当前页面暂不支持停靠，请切回胶囊或弹出。</p>' : ''}
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
  shellState.panel
    .querySelector("[data-action='theme']")
    ?.addEventListener('click', IS_POPOUT ? () => POPOUT.toggleTheme() : toggleCodexTheme);
  applyMaterial({ animate: false });

  if (shellState.activeTab === 'settings') attachSettingsEvents();
  else if (shellState.activeTab === 'outline') attachOutlineEvents();
  else attachNextEvents();
  bindPanelWindowControls();
  installViewTabReorder();
  installPanelDrag();
  syncEyeTracking();
  if (!options.preserveMorph && !shellState.morphAnimation) settleMorph(shellState.open ? 1 : 0);
}

function nextProgressState() {
  if (stepwiseState.bridgeStatus === 'pending') {
    return {
      title: '正在生成建议',
    };
  }
  if (stepwiseGenerationMode() === 'manual') return null;
  if (
    contextState.scanStatus === 'assistant-changed' ||
    contextState.scanStatus === 'assistant-settling'
  ) {
    return {
      title: '正在整理回答',
    };
  }
  if (contextState.scanStatus === 'not-ready' && contextState.scanBusy) {
    return {
      title: '等待回答完成',
    };
  }
  return null;
}

function nextHtml() {
  const progress = nextProgressState();
  if (progress) {
    return `<div class="csw-progress" aria-label="${progress.title}">
        <span class="csw-progress-ring" aria-hidden="true"></span>
        <span class="csw-progress-copy">
          <span class="csw-progress-title">${progress.title}</span>
        </span>
      </div>`;
  }
  if (!stepwiseState.prompts.length) {
    const empty = nextEmptyState();
    return `<div class="csw-empty" data-state="${escapeAttr(('state' in empty ? empty.state : '') || 'idle')}">
        <div class="csw-empty-title">${escapeHtml(empty.title)}</div>
      </div>`;
  }
  const previewIndex = clamp(
    Number(shellState.promptPreviewIndex) || 0,
    0,
    stepwiseState.prompts.length - 1,
  );
  const previewItem = stepwiseState.prompts[previewIndex];
  shellState.promptPreviewIndex = previewIndex;
  return `<div class="csw-next-layout">
      <div class="csw-list" data-label-only="${shellState.labelOnly}" aria-label="下一步建议">${stepwiseState.prompts
        .map(
          (item, index) => `
        <button class="csw-row" type="button" data-index="${index}" data-preview-active="${index === previewIndex}" aria-current="${index === previewIndex ? 'true' : 'false'}">
          <span class="csw-row-copy">
            <span class="csw-row-label">${escapeHtml(item.label || labelForPrompt(item.prompt))}</span>
            ${shellState.labelOnly ? '' : `<span class="csw-row-prompt">${escapeHtml(item.summary || summaryForPrompt(item.prompt))}</span>`}
          </span>
          <span class="csw-row-arrow" aria-hidden="true">${iconSvg('chevron-right')}</span>
        </button>
      `,
        )
        .join('')}</div>
      <section class="csw-prompt-preview" data-preview-index="${previewIndex}" aria-label="建议完整内容">
        <div class="csw-prompt-preview-scroll" tabindex="0">
          <div class="csw-prompt-preview-content">
            <span class="csw-prompt-preview-kicker">${previewIndex + 1} / ${stepwiseState.prompts.length}</span>
            <span class="csw-prompt-preview-title">${escapeHtml(previewItem.label || labelForPrompt(previewItem.prompt))}</span>
            <span class="csw-prompt-preview-body">${escapeHtml(previewItem.prompt)}</span>
          </div>
        </div>
      </section>
    </div>`;
}

function nextEmptyState() {
  if (stepwiseState.bridgeError || stepwiseState.bridgeStatus === 'failed')
    return bridgeErrorPresentation();
  if (stepwiseState.bridgeStatus === 'ok') {
    return {
      title: '暂无建议',
      message: '',
    };
  }
  if (stepwiseState.bridgeStatus === 'disabled') {
    return {
      title: '功能已关闭',
      message: '',
    };
  }
  if (stepwiseGenerationMode() === 'manual') {
    return {
      title: '当前为手动模式',
      message: '',
      state: 'manual',
    };
  }
  return {
    title: '等待回答完成',
    message: '',
  };
}

function attachNextEvents(root = shellState.panel) {
  root.querySelectorAll('.csw-row').forEach((button) => {
    button.addEventListener('pointerenter', () => schedulePromptPreview(button));
    button.addEventListener('pointerleave', cancelScheduledPromptPreview);
    button.addEventListener('focus', () => showPromptPreview(button, true));
    button.addEventListener('click', (event) => {
      if (event.detail >= 2) {
        event.preventDefault();
        if (shellState.promptClickTimer) window.clearTimeout(shellState.promptClickTimer);
        shellState.promptClickTimer = 0;
        showPromptPreview(button, true);
        selectPrompt(button, promptClickSubmits(event.detail));
        return;
      }

      if (shellState.promptClickTimer) window.clearTimeout(shellState.promptClickTimer);
      const generation = runtimeState.runtimeGeneration;
      shellState.promptClickTimer = window.setTimeout(() => {
        shellState.promptClickTimer = 0;
        if (!isCurrentRuntime(generation) || !button.isConnected) return;
        showPromptPreview(button, true);
        selectPrompt(button, promptClickSubmits(1));
      }, PROMPT_CLICK_DELAY_MS);
    });
    button.addEventListener('dblclick', (event) => event.preventDefault());
  });
}

function clearPromptInteractionTimers() {
  if (shellState.promptPreviewTimer) window.clearTimeout(shellState.promptPreviewTimer);
  if (shellState.promptClickTimer) window.clearTimeout(shellState.promptClickTimer);
  shellState.promptPreviewTimer = 0;
  shellState.promptClickTimer = 0;
}

function schedulePromptPreview(button) {
  if (shellState.promptPreviewTimer) window.clearTimeout(shellState.promptPreviewTimer);
  shellState.promptPreviewTimer = 0;
  showPromptPreview(button);
}

function cancelScheduledPromptPreview() {
  if (shellState.promptPreviewTimer) window.clearTimeout(shellState.promptPreviewTimer);
  shellState.promptPreviewTimer = 0;
}

function showPromptPreview(button, immediate = false) {
  const index = Number(button.dataset.index);
  const item = stepwiseState.prompts[index];
  const preview = shellState.panel?.querySelector('.csw-prompt-preview');
  if (!item?.prompt || !preview) return;

  if (Number(preview.dataset.previewIndex) === index) {
    shellState.panel.querySelectorAll('.csw-row').forEach((row) => {
      const active = row === button;
      row.dataset.previewActive = String(active);
      row.setAttribute('aria-current', active ? 'true' : 'false');
    });
    preview.removeAttribute('data-switching');
    return;
  }

  const applyPreview = () => {
    if (!button.isConnected || !preview.isConnected) return;
    shellState.panel.querySelectorAll('.csw-row').forEach((row) => {
      const active = row === button;
      row.dataset.previewActive = String(active);
      row.setAttribute('aria-current', active ? 'true' : 'false');
    });
    const title = preview.querySelector('.csw-prompt-preview-title');
    const kicker = preview.querySelector('.csw-prompt-preview-kicker');
    const body = preview.querySelector('.csw-prompt-preview-body');
    const scroll = preview.querySelector('.csw-prompt-preview-scroll');
    if (kicker) kicker.textContent = `${index + 1} / ${stepwiseState.prompts.length}`;
    if (title) title.textContent = item.label || labelForPrompt(item.prompt);
    if (body) body.textContent = item.prompt;
    if (scroll) scroll.scrollTop = 0;
    preview.dataset.previewIndex = String(index);
    shellState.promptPreviewIndex = index;
    syncContentFade();
    window.requestAnimationFrame(() => {
      preview.removeAttribute('data-switching');
      if (preview.isConnected) syncContentFade();
    });
  };

  if (immediate) {
    if (shellState.promptPreviewTimer) window.clearTimeout(shellState.promptPreviewTimer);
    shellState.promptPreviewTimer = 0;
    preview.removeAttribute('data-switching');
    applyPreview();
    return;
  }
  const generation = runtimeState.runtimeGeneration;
  shellState.promptPreviewTimer = window.setTimeout(() => {
    shellState.promptPreviewTimer = 0;
    if (!isCurrentRuntime(generation) || !button.matches(':hover, :focus, :focus-within')) return;
    preview.dataset.switching = 'true';
    applyPreview();
  }, PROMPT_PREVIEW_SWITCH_MS);
}

function selectPrompt(button, submit) {
  const item = stepwiseState.prompts[Number(button.dataset.index)];
  if (!item?.prompt) return;
  pushDiagnostic('prompt:select', {
    submit,
    clickMode: shellState.promptClickMode,
    index: Number(button.dataset.index),
  });
  fillComposer(item.prompt, submit);
}

function promptClickSubmits(clickDetail, value = shellState.promptClickMode) {
  const mode = normalizePromptClickMode(value);
  if (mode === 'direct') return true;
  if (mode === 'fill') return false;
  return clickDetail >= 2;
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
