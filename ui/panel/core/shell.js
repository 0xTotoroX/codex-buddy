/*
 * [INPUT]: 外壳与功能状态、窗口尺寸通信。
 * [OUTPUT]: 共享表情模板、表情状态派生、完成光效与视图过渡。
 * [POS]: 外壳状态表现层，不识别宿主页面或发起设置请求。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  COMPLETION_BEAM_MS,
  IS_POPOUT,
  VIEW_SLIDE_DISTANCE,
  VIEW_SLIDE_MS,
} from '../runtime/constants.js';
import {
  contextState,
  isCurrentRuntime,
  normalizeActiveTab,
  outlineEnabled,
  outlineState,
  runtimeEnabled,
  runtimeState,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseState,
  viewNavigationOrder,
} from '../runtime/state.js';
import { emitSignal } from '../runtime/signals.js';
import { sizeNativePanel } from '../popout/transport.js';

function faceEyeHtml() {
  return `<span class="csw-fab-eye"><svg class="csw-fab-happy-arc" viewBox="0 0 18 12" aria-hidden="true" focusable="false"><path d="M1.5 9 C4.6 3.2 13.4 3.2 16.5 9"></path></svg></span>`;
}

function faceHtml() {
  return `
      <span class="csw-fab-face" aria-hidden="true">
        ${faceEyeHtml()}
        ${faceEyeHtml()}
      </span>
    `;
}

function statusStageHtml() {
  return `<span class="csw-status-stage">${faceHtml()}</span>`;
}

function expressionError() {
  const settings = runtimeState.settings;
  const configurationMissing =
    settings?.enabled === true &&
    (!settings.baseUrlConfigured || !settings.model || !settings.apiKeyConfigured);
  return (
    configurationMissing ||
    stepwiseState.bridgeStatus === 'failed' ||
    (stepwiseState.bridgeStatus === 'disabled' && Boolean(stepwiseState.bridgeError)) ||
    contextState.scanStatus === 'manual-refresh-no-assistant'
  );
}

function stepwiseWaitingForManualRefresh(settings = runtimeState.settings) {
  return (
    stepwiseEnabled(settings) &&
    stepwiseGenerationMode(settings) === 'manual' &&
    stepwiseState.bridgeStatus !== 'pending' &&
    stepwiseState.bridgeStatus !== 'ok' &&
    !stepwiseState.prompts.length &&
    !expressionError()
  );
}

function resolveStepwiseExpression(now = Date.now()) {
  if (!stepwiseEnabled()) return 'hidden';
  if (stepwiseState.bridgeStatus === 'pending') return 'generating';
  if (expressionError()) return 'error';
  if (stepwiseGenerationMode() === 'manual') {
    if (stepwiseState.bridgeStatus === 'disabled') return 'hidden';
    if (stepwiseState.prompts.length) return 'ready';
    if (stepwiseState.bridgeStatus === 'ok') return 'empty';
    return 'idle';
  }
  if (contextState.scanBusy) return 'answering';
  if (shellState.surpriseUntil > now) return 'surprise';
  if (
    contextState.scanStatus === 'assistant-changed' ||
    contextState.scanStatus === 'assistant-settling'
  ) {
    return 'answering';
  }
  if (stepwiseState.bridgeStatus === 'disabled') return 'hidden';
  if (stepwiseState.prompts.length) return 'ready';
  if (stepwiseState.bridgeStatus === 'ok') return 'empty';
  return 'idle';
}

function resolveOutlineExpression(now = Date.now()) {
  if (!outlineEnabled()) return 'hidden';
  if (outlineState.outlineStatus === 'pending') return 'answering';
  if (contextState.scanBusy) return 'answering';
  if (shellState.surpriseUntil > now) return 'surprise';
  if (outlineState.outlineStatus === 'error') return 'error';
  if (outlineState.outlineItems.length) return 'ready';
  if (outlineState.outlineStatus === 'empty') return 'empty';
  return 'idle';
}

function usesOutlineExpression(now = Date.now()) {
  const stepwiseExpression = resolveStepwiseExpression(now);
  return (
    outlineEnabled() &&
    (shellState.activeTab === 'outline' ||
      stepwiseExpression === 'hidden' ||
      stepwiseWaitingForManualRefresh())
  );
}

function resolveFabExpression(now = Date.now()) {
  if (!runtimeEnabled()) return 'hidden';
  return usesOutlineExpression(now)
    ? resolveOutlineExpression(now)
    : resolveStepwiseExpression(now);
}

function fabExpressionLabel(expression, outlineExpression = usesOutlineExpression()) {
  if (outlineExpression) {
    return (
      {
        idle: '空闲',
        answering: '回答中',
        surprise: '正在整理回答',
        generating: '正在整理大纲',
        ready: '大纲已准备',
        empty: '暂无大纲',
        error: '生成失败',
        curious: '查看设置',
        hidden: '已关闭',
      }[expression] || '空闲'
    );
  }
  return (
    {
      idle: '空闲',
      answering: '回答中',
      surprise: '正在整理回答',
      generating: '正在生成建议',
      ready: '建议已准备',
      empty: '暂无建议',
      error: '生成失败',
      curious: '查看设置',
      hidden: '已关闭',
    }[expression] || '空闲'
  );
}

function scheduleExpressionRefresh(delay) {
  if (!isCurrentRuntime()) return;
  if (shellState.expressionTimer) window.clearTimeout(shellState.expressionTimer);
  const generation = runtimeState.runtimeGeneration;
  const timer = window.setTimeout(() => {
    if (shellState.expressionTimer === timer) shellState.expressionTimer = 0;
    if (isCurrentRuntime(generation)) emitSignal('render', undefined);
  }, delay);
  shellState.expressionTimer = timer;
}

function clearCompletionBeam() {
  if (shellState.completionBeamTimer) window.clearTimeout(shellState.completionBeamTimer);
  shellState.completionBeamTimer = 0;
  if (shellState.popover) shellState.popover.dataset.completionBeam = 'false';
}

function triggerCompletionBeam(promptCount) {
  clearCompletionBeam();
  if (promptCount < 1 || prefersReducedMotion() || !shellState.popover) return;
  shellState.popover.dataset.completionBeam = 'true';
  const timer = window.setTimeout(() => {
    if (shellState.completionBeamTimer !== timer) return;
    shellState.completionBeamTimer = 0;
    if (shellState.popover) shellState.popover.dataset.completionBeam = 'false';
  }, COMPLETION_BEAM_MS);
  shellState.completionBeamTimer = timer;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

function cancelViewAnimation() {
  cancelViewStageAnimation();
  cancelViewIndicatorAnimation();
}

function cancelViewStageAnimation() {
  const transition = shellState.viewAnimation;
  shellState.viewAnimation = null;
  if (!transition) return;
  transition.animations?.forEach((animation) => animation.cancel());
  transition.finish?.();
}

function cancelViewIndicatorAnimation() {
  if (shellState.viewIndicatorFrame) window.cancelAnimationFrame(shellState.viewIndicatorFrame);
  shellState.viewIndicatorFrame = 0;
}

function deferRender() {
  shellState.pendingRender = true;
}

function flushDeferredRender() {
  if (!shellState.pendingRender || !isCurrentRuntime()) return false;
  if (shellState.viewTransitioning || shellState.morphAnimation) return false;
  shellState.pendingRender = false;
  emitSignal('render', { preserveMorph: true, allowDuringTransition: true });
  return true;
}

function viewSlideDirection(fromTab, targetTab) {
  const order = viewNavigationOrder();
  const fromIndex = order.indexOf(fromTab);
  const targetIndex = order.indexOf(targetTab);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return 1;
  return targetIndex > fromIndex ? 1 : -1;
}

function captureViewStage() {
  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  const stage = body?.querySelector(':scope > .csw-mouth-stage');
  if (!body || !stage) return null;
  return {
    node: stage.cloneNode(true),
    scrollTop: body.scrollTop,
  };
}

function animateViewSlide(snapshot, direction) {
  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  const incoming = body?.querySelector(':scope > .csw-mouth-stage');
  if (
    !snapshot?.node ||
    !body ||
    !incoming ||
    prefersReducedMotion() ||
    typeof incoming.animate !== 'function'
  ) {
    return Promise.resolve();
  }

  cancelViewStageAnimation();
  const layer = document.createElement('div');
  const outgoing = snapshot.node;
  layer.className = 'csw-view-transition-layer';
  outgoing.classList.add('csw-view-transition-copy');
  outgoing.style.top = `${2 - snapshot.scrollTop}px`;
  layer.appendChild(outgoing);
  body.appendChild(layer);
  body.dataset.viewTransition = 'true';

  const distance = VIEW_SLIDE_DISTANCE * direction;
  const options = {
    duration: VIEW_SLIDE_MS,
    easing: 'cubic-bezier(.2, .72, .2, 1)',
    fill: 'forwards',
  };
  const outgoingAnimation = outgoing.animate(
    [
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      { opacity: 0.08, transform: `translate3d(${-distance}px, 0, 0)` },
    ],
    options,
  );
  const incomingAnimation = incoming.animate(
    [
      { opacity: 0.42, transform: `translate3d(${distance}px, 0, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    options,
  );
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    body.removeAttribute('data-view-transition');
    layer.remove();
  };
  let resolveCompletion;
  let settled = false;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const transition = {
    animations: [outgoingAnimation, incomingAnimation],
    cleanup,
    fallbackTimer: 0,
    finish: () => {
      if (settled) return;
      settled = true;
      if (transition.fallbackTimer) window.clearTimeout(transition.fallbackTimer);
      cleanup();
      if (shellState.viewAnimation === transition) shellState.viewAnimation = null;
      resolveCompletion();
    },
  };
  shellState.viewAnimation = transition;
  transition.fallbackTimer = window.setTimeout(() => {
    transition.animations.forEach((animation) => {
      if (animation.playState !== 'finished') animation.cancel();
    });
    transition.finish();
  }, VIEW_SLIDE_MS + 120);
  void Promise.all(
    transition.animations.map((animation) => animation.finished.catch(() => null)),
  ).then(() => transition.finish());
  return completion;
}

function syncViewTabSelection(targetTab, animate = true) {
  const tabs = shellState.panel?.querySelector('.csw-view-tabs');
  const indicator = tabs?.querySelector('.csw-view-indicator');
  if (!tabs || !indicator) return;

  const buttons = Array.from(tabs.querySelectorAll('.csw-icon[data-view]'));
  const target = buttons.find((button) => button.dataset.view === targetTab) || null;
  buttons.forEach((button) => {
    const selected = button === target;
    button.dataset.active = String(selected);
    button.setAttribute('aria-selected', String(selected));
  });

  indicator.style.transition = animate && !prefersReducedMotion() ? '' : 'none';
  if (!target) {
    indicator.style.opacity = '0';
    tabs.dataset.activeView = '';
    return;
  }

  tabs.dataset.activeView = targetTab;
  indicator.style.opacity = '1';
  indicator.style.transform = `translate3d(${target.offsetLeft - indicator.offsetLeft}px, 0, 0)`;
  if (!animate) indicator.getBoundingClientRect();
}

function animateViewTabSelection(fromTab, targetTab) {
  syncViewTabSelection(fromTab, false);
  if (fromTab === targetTab) return;
  shellState.viewIndicatorFrame = window.requestAnimationFrame(() => {
    shellState.viewIndicatorFrame = 0;
    if (!isCurrentRuntime()) return;
    syncViewTabSelection(targetTab, true);
  });
}

async function switchView(nextTab) {
  const generation = runtimeState.runtimeGeneration;
  const targetTab = normalizeActiveTab(nextTab);
  if (!isCurrentRuntime(generation) || targetTab === shellState.activeTab) return;
  if (shellState.viewTransitioning) {
    shellState.pendingTab = targetTab;
    return;
  }
  shellState.viewTransitioning = true;
  try {
    const sourceTab = shellState.activeTab;
    const snapshot = captureViewStage();
    const direction = viewSlideDirection(sourceTab, targetTab);
    shellState.activeTab = normalizeActiveTab(targetTab);
    shellState.pendingRender = false;
    if (IS_POPOUT && shellState.open) await sizeNativePanel(true);
    emitSignal('render', {
      preserveMorph: true,
      viewIndicatorFrom: sourceTab,
      allowDuringTransition: true,
    });
    await animateViewSlide(snapshot, direction);
    if (!isCurrentRuntime(generation)) return;
    if (targetTab === 'settings') emitSignal('settings', undefined);
  } finally {
    if (isCurrentRuntime(generation)) {
      shellState.viewTransitioning = false;
      const pendingTab = shellState.pendingTab;
      shellState.pendingTab = '';
      if (pendingTab && pendingTab !== shellState.activeTab) void switchView(pendingTab);
      else flushDeferredRender();
    }
  }
}

export {
  statusStageHtml,
  animateViewTabSelection,
  cancelViewAnimation,
  clearCompletionBeam,
  deferRender,
  fabExpressionLabel,
  flushDeferredRender,
  prefersReducedMotion,
  resolveFabExpression,
  scheduleExpressionRefresh,
  stepwiseWaitingForManualRefresh,
  switchView,
  syncViewTabSelection,
  triggerCompletionBeam,
  usesOutlineExpression,
};
