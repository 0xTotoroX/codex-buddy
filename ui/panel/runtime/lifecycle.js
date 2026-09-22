/*
 * [INPUT]: 宿主上下文、独立功能、设置协调、外壳与通知。
 * [OUTPUT]: 只读 panelAppearance 接口； 扫描、启停与通知订阅，连接胶囊与停靠开合；切换聊天恢复有效建议缓存，来源失联保留只读结果并使异步请求失效。
 * [POS]: 模块组合入口；统一初始化并回收观察器、定时器和订阅。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { panelAppearance } from '../core/panel-appearance.js';

import {
  DETACHED_KEY,
  DEVELOPMENT,
  API_KEY,
  INSTANCE_ID,
  IS_POPOUT,
  NEW_ANSWER_EXPRESSION_MS,
  ROOT_ATTR,
  SCAN_DELAY_MS,
  SCRIPT_VERSION,
  STREAM_IDLE_MS,
  STYLE_ID,
} from './constants.js';
import {
  assistantMessageId,
  chatBusy,
  bindingSourceReady,
  chatSurfaceReady,
  contextMatches,
  contextSnapshot,
  findLatestAssistantMessage,
  findPreviousUserText,
  installContextTracking,
  removeContextTracking,
  setScanStatus,
} from '../host/context.js';
import {
  bridgeRequestKey,
  clearPromptsForNewAssistant,
  requestBridgeStepwise,
  resetStepwiseFeature,
} from '../stepwise.js';
import { cancelMorphAnimations, dockRightKeepHeight, setOpen } from '../core/geometry.js';
import {
  cancelSourceCueAnimation,
  clearPromptInteractionTimers,
  installFloat,
  renderFloat,
} from '../core/views.js';
import {
  cancelViewAnimation,
  resolveFabExpression,
  scheduleExpressionRefresh,
  triggerCompletionBeam,
} from '../core/shell.js';
import {
  contextState,
  debugState,
  hashText,
  initializeState,
  isCurrentInstance,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizeText,
  outlineEnabled,
  outlineState,
  runtimeEnabled,
  runtimeState,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseInputText,
  stepwiseState,
} from './state.js';
import {
  ensureSettings,
  loadSettings,
  reloadSettings,
  scheduleSettingsSync,
  syncSettings,
} from './settings-sync.js';
import {
  togglePanelWindow,
  exportPanelState,
  panelReadingState,
  panelWindowAnchor,
  blinkHandoff,
  panelCommand,
  panelDisconnected,
  receivePanelState,
  setDetached,
  syncPanelPreferences,
} from './presentation.js';
import { fallbackHostTypography } from '../host/host-appearance.js';
import { installStyle } from '../core/install-styles.js';
import {
  invalidateOutline,
  outlineClearMarks,
  refreshOutline,
  resetOutlineFeature,
} from '../outline.js';
import { nativeGestureEnded, panelPreferences } from '../popout/transport.js';
import { cancelFaceClick, onResize } from '../core/interaction.js';
import { stopWorkbench, setWorkbench, openWorkbench, closeWorkbench } from '../workbench/layout.js';
import { onSignal } from './signals.js';
import { pushDiagnostic, readDiagnostics } from './diagnostics.js';
import {
  readFontOffset,
  readMaterial,
  readLiquidVariant,
  readPanelHeight,
  readPanelWidth,
  syncTheme,
  toggleMaterial,
  writeMaterial,
} from '../core/panel-appearance.js';
import { updateGenerationModeControl } from '../core/settings-view.js';

function scan(generation = runtimeState.runtimeGeneration, timerId = 0) {
  if (IS_POPOUT || !isCurrentRuntime(generation)) return;
  if (timerId && runtimeState.timer !== timerId) return;
  if (timerId) runtimeState.timer = 0;
  runtimeState.scans += 1;
  installStyle();
  installFloat();
  const stepwiseActive = stepwiseEnabled();
  const outlineActive = outlineEnabled();

  if (!bindingSourceReady()) {
    setScanStatus('source-unavailable', {});
    renderFloat();
    return;
  }
  if (!chatSurfaceReady()) {
    if (outlineActive && (outlineState.outlineItems.length || outlineState.outlineMessage))
      invalidateOutline();
    const statusChanged = setScanStatus('not-ready', {});
    if (statusChanged) renderFloat();
    return;
  }

  const message = findLatestAssistantMessage();
  if (!message) {
    if (contextState.lastAssistantHash) {
      contextState.lastAssistantHash = '';
      contextState.activeContext.assistantMessageId = '';
      clearPromptsForNewAssistant('');
    }
    if (outlineActive && (outlineState.outlineItems.length || outlineState.outlineMessage))
      invalidateOutline();
    const statusChanged = setScanStatus('no-assistant-message', {});
    if (statusChanged) renderFloat();
    return;
  }

  const nextAssistantMessageId = assistantMessageId(message);
  if (contextState.activeContext.assistantMessageId !== nextAssistantMessageId) {
    contextState.activeContext.assistantMessageId = nextAssistantMessageId;
  }

  const sourceText = normalizeText(message.text);
  const assistantText = stepwiseInputText(sourceText);
  const hash = hashText(sourceText);
  const now = Date.now();

  if (hash !== contextState.lastAssistantHash) {
    contextState.lastAssistantHash = hash;
    contextState.lastAssistantAt = now;
    shellState.surpriseUntil = now + NEW_ANSWER_EXPRESSION_MS;
    scheduleExpressionRefresh(NEW_ANSWER_EXPRESSION_MS);
    setScanStatus('assistant-changed', { hash, textLength: assistantText.length });
    if (outlineActive) invalidateOutline(message, hash);
    if (stepwiseActive) {
      clearPromptsForNewAssistant(hash);
    } else {
      renderFloat();
    }
    scheduleScan(STREAM_IDLE_MS + 120);
    return;
  }

  if (now - contextState.lastAssistantAt < STREAM_IDLE_MS) {
    setScanStatus('assistant-settling', { hash });
    scheduleScan(STREAM_IDLE_MS);
    return;
  }

  if (
    outlineActive &&
    (outlineState.outlineSourceHash !== hash || !outlineState.outlineMessage?.isConnected) &&
    !outlineState.outlineRefreshPromise
  ) {
    void refreshOutline({ message, assistantHash: hash });
  }
  if (!stepwiseActive) {
    const statusChanged = setScanStatus('ready', {
      hash,
      outlineOnly: true,
      outlineCount: outlineState.outlineItems.length,
    });
    if (statusChanged) renderFloat();
    return;
  }

  const userText = findPreviousUserText(message);
  const bridgeKey = bridgeRequestKey(userText, assistantText);
  const generationMode = stepwiseGenerationMode();
  const manualRequestPending =
    generationMode === 'manual' &&
    stepwiseState.bridgeStatus === 'pending' &&
    stepwiseState.bridgePendingHash === bridgeKey;
  stepwiseState.bridgeActiveKey = bridgeKey;
  const bridgeResult = stepwiseState.bridgeCache.get(bridgeKey);
  const hasSuccessfulCache = bridgeResult?.status === 'ok';
  let prompts = [];

  if (generationMode === 'manual' && !hasSuccessfulCache && !manualRequestPending) {
    stepwiseState.bridgeStatus = 'manual-ready';
    stepwiseState.bridgeError = '';
    stepwiseState.promptContext = contextSnapshot();
  } else if (manualRequestPending) {
    stepwiseState.bridgeError = '';
    stepwiseState.promptContext = contextSnapshot();
  } else if (hasSuccessfulCache) {
    prompts = Array.isArray(bridgeResult.prompts) ? bridgeResult.prompts : [];
    stepwiseState.bridgeStatus = 'ok';
    stepwiseState.bridgeError = '';
    stepwiseState.promptContext = contextSnapshot();
  } else {
    if (bridgeResult) {
      stepwiseState.bridgeStatus =
        bridgeResult.status ||
        (bridgeResult.error ? 'failed' : bridgeResult.disabled ? 'disabled' : 'ok');
      stepwiseState.bridgeError = bridgeResult.error || '';
      stepwiseState.promptContext = contextSnapshot();
    } else {
      requestBridgeStepwise(bridgeKey, userText, assistantText, 'auto');
    }
  }
  setScanStatus('ready', {
    hash,
    bridgeCached: Boolean(bridgeResult),
    promptCount: prompts.length,
  });

  const nextHash = hashText(
    `${generationMode}:${stepwiseState.bridgeStatus}:${prompts.map((item) => `${item.label}\n${item.prompt}`).join('\n\n')}`,
  );
  const renderedHash = `${hash}:${nextHash}`;
  if (stepwiseState.currentHash !== renderedHash) {
    stepwiseState.currentHash = renderedHash;
    stepwiseState.prompts = prompts;
    stepwiseState.promptContext = contextSnapshot();
    shellState.promptPreviewIndex = 0;
    renderFloat();
  }
}

function scheduleScan(delay = SCAN_DELAY_MS) {
  if (IS_POPOUT) return;
  if (!isCurrentRuntime()) return;
  if (runtimeState.timer) window.clearTimeout(runtimeState.timer);
  const generation = runtimeState.runtimeGeneration;
  const timer = window.setTimeout(() => scan(generation, timer), delay);
  runtimeState.timer = timer;
}

function installObserver() {
  if (!isCurrentRuntime()) return false;
  const root = document.body || document.documentElement;
  if (!root) return false;

  const generation = runtimeState.runtimeGeneration;
  runtimeState.observer = new MutationObserver((mutations) => {
    if (!isCurrentRuntime(generation)) return;
    const relevant = mutations.some((mutation) => {
      if (shellState.root?.contains(mutation.target)) return false;
      return mutation.addedNodes.length || mutation.type === 'characterData';
    });
    if (relevant) scheduleScan();
  });
  runtimeState.observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return true;
}

function stopRuntime() {
  stopWorkbench();
  cancelFaceClick();
  window.dispatchEvent(
    new CustomEvent('codex-buddy:stop', { detail: { destroy: runtimeState.destroyed } }),
  );
  runtimeState.runtimeActive = false;
  runtimeState.runtimeGeneration += 1;
  contextState.latestTurnAnchor = null;
  if (runtimeState.domReadyHandler)
    document.removeEventListener('DOMContentLoaded', runtimeState.domReadyHandler);
  runtimeState.domReadyHandler = null;
  if (runtimeState.timer) window.clearTimeout(runtimeState.timer);
  if (shellState.expressionTimer) window.clearTimeout(shellState.expressionTimer);
  if (outlineState.flashTimer) window.clearTimeout(outlineState.flashTimer);
  if (shellState.materialAnimTimer) window.clearTimeout(shellState.materialAnimTimer);
  if (shellState.completionBeamTimer) window.clearTimeout(shellState.completionBeamTimer);
  if (shellState.snapTimer) window.clearTimeout(shellState.snapTimer);
  if (shellState.eyeRaf) window.cancelAnimationFrame(shellState.eyeRaf);
  runtimeState.timer = 0;
  shellState.expressionTimer = 0;
  outlineState.flashTimer = 0;
  shellState.materialAnimTimer = 0;
  shellState.completionBeamTimer = 0;
  shellState.snapTimer = 0;
  shellState.eyeRaf = 0;
  shellState.surpriseUntil = 0;
  stepwiseState.bridgeActiveKey = '';
  stepwiseState.bridgePendingHash = '';
  stepwiseState.bridgePendingRequestId = 0;
  shellState.viewTransitioning = false;
  shellState.pendingTab = '';
  shellState.pendingRender = false;
  shellState.popover?.removeAttribute?.('data-snap-right');
  cancelViewAnimation();
  cancelSourceCueAnimation();
  cancelMorphAnimations();
  shellState.handoffGeneration += 1;
  shellState.handoffAnimation?.cancel?.();
  shellState.handoffAnimation = null;
  shellState.handoffPromise = null;
  shellState.handoffTarget = null;
  shellState.dragCleanup?.();
  shellState.resizeCleanup?.();
  shellState.viewReorderCleanup?.();
  shellState.contentFadeCleanup?.();
  shellState.eyeCleanup?.();
  shellState.eyeCleanup = null;
  shellState.contentFadeCleanup = null;
  shellState.eyePointer = null;
  document
    .querySelectorAll('.companion-stepwise-active-pane, .companion-stepwise-pane-flash')
    .forEach((node) => {
      node.classList.remove('companion-stepwise-active-pane', 'companion-stepwise-pane-flash');
    });
  removeContextTracking();
  if (shellState.keyHandler) document.removeEventListener('keydown', shellState.keyHandler, true);
  shellState.keyHandler = null;
  window.removeEventListener('resize', onResize);
  runtimeState.observer?.disconnect();
  runtimeState.observer = null;
  shellState.themeObserver?.disconnect();
  shellState.themeObserver = null;
  shellState.typographyObserver?.disconnect();
  shellState.typographyObserver = null;
  clearPromptInteractionTimers();
  outlineClearMarks();
  outlineState.outlineItems = [];
  outlineState.outlineRefreshPromise = null;
  outlineState.outlineMessage = null;
  outlineState.outlineScrollCleanup?.();
  outlineState.outlineScrollCleanup = null;
  outlineState.outlineSourceHash = '';
  outlineState.outlineFingerprint = '';
  outlineState.outlineStatus = 'idle';
  outlineState.outlineError = '';
  shellState.root?.remove();
  shellState.root = null;
  shellState.fab = null;
  shellState.popover = null;
  shellState.glass = null;
  shellState.rim = null;
  shellState.completionBeam = null;
  shellState.panel = null;
  shellState.layout = null;
  shellState.drag = null;
  shellState.resizeDrag = null;
  shellState.dragCleanup = null;
  shellState.resizeCleanup = null;
  shellState.viewReorderCleanup = null;
  shellState.suppressViewTabClickUntil = 0;
  shellState.focusAfterMorph = '';
  contextState.pinnedThreadRoot = null;
  contextState.pinnedThreadAt = 0;
  contextState.activeContext = {
    paneRoot: null,
    paneKey: '',
    sessionId: '',
    assistantMessageId: '',
    generation: contextState.activeContext.generation + 1,
  };
  document.getElementById(STYLE_ID)?.remove();
  shellState.open = false;
}

function activateRuntime() {
  if (!isCurrentInstance()) return false;
  if (!runtimeState.runtimeActive) {
    runtimeState.runtimeGeneration += 1;
    runtimeState.runtimeActive = true;
  }
  const generation = runtimeState.runtimeGeneration;
  shellState.activeTab = normalizeActiveTab();
  installStyle();
  installFloat();
  if (IS_POPOUT) {
    renderFloat();
    return true;
  }
  installContextTracking();
  if (!runtimeState.observer && !installObserver()) {
    const domReadyHandler = () => {
      if (runtimeState.domReadyHandler === domReadyHandler) runtimeState.domReadyHandler = null;
      if (!isCurrentRuntime(generation)) return;
      installObserver();
      installFloat();
      void ensureSettings();
      scheduleScan(0);
    };
    runtimeState.domReadyHandler = domReadyHandler;
    document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
  }
  scheduleScan(0);
  return true;
}

function destroy() {
  clearTimeout(shellState.detachedRecoveryTimer);
  if (!IS_POPOUT) sessionStorage.removeItem(DETACHED_KEY);
  runtimeState.destroyed = true;
  stepwiseState.promptContext = null;
  contextState.latestTurnAnchor = null;
  contextState.pinnedPaneKey = '';
  contextState.pinnedSessionId = '';
  contextState.pinnedThreadRoot = null;
  if (runtimeState.settingsSyncTimer) window.clearTimeout(runtimeState.settingsSyncTimer);
  runtimeState.settingsSyncTimer = 0;
  cancelSourceCueAnimation();
  cancelViewAnimation();
  stopRuntime();
  runtimeState.signalCleanup?.();
  if (window[API_KEY]?.instanceId === INSTANCE_ID) delete window[API_KEY];
}

async function start() {
  scheduleSettingsSync();
  if (runtimeState.startupPromise) return runtimeState.startupPromise;
  const generation = runtimeState.runtimeGeneration;
  runtimeState.startupPromise = (async () => {
    const settings = await ensureSettings();
    if (!isCurrentInstance() || generation !== runtimeState.runtimeGeneration) return;
    if (!runtimeEnabled(settings)) {
      pushDiagnostic('startup:disabled', {});
      runtimeState.startupPromise = null;
      return;
    }
    activateRuntime();
  })();
  return runtimeState.startupPromise;
}

function install() {
  // Re-injection replaces stale instances instead of layering another UI on top.
  const previous = window[API_KEY];
  const previousRuntimeHealthy =
    previous?.state?.runtimeActive === true &&
    previous?.state?.settingsLoaded === true &&
    document.readyState !== 'loading' &&
    previous?.state?.root?.isConnected === true &&
    previous?.state?.popover?.isConnected === true &&
    Boolean(previous?.state?.observer) &&
    document.querySelectorAll?.(`[${ROOT_ATTR}="true"]`).length === 1 &&
    document.querySelectorAll?.(`#${STYLE_ID}`).length === 1 &&
    document.getElementById(STYLE_ID)?.dataset.codexStepwiseStyleVersion === SCRIPT_VERSION;
  if (
    previous?.version === SCRIPT_VERSION &&
    previous?.state?.destroyed !== true &&
    previousRuntimeHealthy
  ) {
    previous.syncSettings?.();
    previous.start?.();
    return;
  }
  if (previous && typeof previous.destroy === 'function') previous.destroy();
  document.querySelectorAll?.(`[${ROOT_ATTR}="true"]`).forEach((node) => node.remove());
  document.getElementById(STYLE_ID)?.remove();

  initializeState({
    width: readPanelWidth(),
    height: readPanelHeight(),
    hostTypography: fallbackHostTypography(),
    fontOffset: readFontOffset(),
    material: readMaterial(),
    liquidVariant: readLiquidVariant(),
    diagnostics: readDiagnostics(),
  });
  const stopSignals = [
    onSignal('render', (options) => renderFloat(options)),
    onSignal('scan', (delay) => scheduleScan(delay)),
    onSignal('runtime', (enabled) => (enabled ? activateRuntime() : stopRuntime())),
    onSignal('bindingUnavailable', () => {
      stepwiseState.stepwiseEpoch += 1;
      stepwiseState.bridgePendingHash = '';
      stepwiseState.bridgePendingRequestId = 0;
      if (stepwiseState.bridgeStatus === 'pending') stepwiseState.bridgeStatus = 'idle';
      outlineState.outlineEpoch += 1;
      outlineState.outlineRefreshPromise = null;
      if (outlineState.outlineStatus === 'pending')
        outlineState.outlineStatus = outlineState.outlineItems.length ? 'ready' : 'idle';
    }),
    onSignal('context', () => {
      resetStepwiseFeature('idle', { preserveCache: true });
      resetOutlineFeature();
    }),
    onSignal('complete', (count) => triggerCompletionBeam(count)),
    onSignal('preview', () => clearPromptInteractionTimers()),
    onSignal('settings', () => {
      void reloadSettings();
    }),
    onSignal('generationControl', ({ mode, busy }) => updateGenerationModeControl(mode, busy)),
    onSignal('verify', () => scan()),
    onSignal('theme', () => syncTheme()),
    onSignal('windowToggle', () => void togglePanelWindow()),
    onSignal('workbenchToggle', (expanded) => (expanded ? openWorkbench() : closeWorkbench())),
  ];
  runtimeState.signalCleanup = () => stopSignals.forEach((stop) => stop());
  window[API_KEY] = {
    version: SCRIPT_VERSION,
    instanceId: INSTANCE_ID,
    development: DEVELOPMENT,
    get state() {
      return debugState();
    },
    scan,
    start,
    destroy,
    loadSettings,
    syncSettings,
    setOpen,
    setWorkbench,
    setMaterial: writeMaterial,
    toggleMaterial,
    dockRight: dockRightKeepHeight,
    getFabExpression: () => resolveFabExpression(),
    renderFloat,
    panelPreferences,
    exportPanelState,
    panelAppearance,
    panelReadingState,
    panelWindowAnchor,
    blinkHandoff,
    panelCommand,
    setDetached,
    syncPanelPreferences,
    receivePanelState,
    panelDisconnected,
    nativeGestureEnded,
    desktopStatus: () => {
      if (runtimeState.runtimeActive && !shellState.root?.isConnected) scheduleScan(0);
      return {
        hasAnswer: Boolean(contextState.lastAssistantHash),
        headings:
          contextState.lastAssistantHash &&
          contextState.lastAssistantHash === outlineState.outlineSourceHash
            ? outlineState.outlineItems.length
            : 0,
      };
    },
    diagnostics: () => runtimeState.diagnostics.slice(),
    verifyRequest: (context, answerHash) => {
      scan();
      return (
        contextMatches(context) && contextState.lastAssistantHash === answerHash && !chatBusy()
      );
    },
  };

  void start();
}

install();
