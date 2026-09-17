/*
 * [INPUT]: 工作台纯布局模型的默认偏好； 稳定常量、初始化偏好与页面桥接。
 * [OUTPUT]: 五组状态（弹出初始化展开）、窗口交接动画与表情点击记录与单击计时状态、兼容调试投影、文本工具和能力判断。
 * [POS]: 无上层依赖的状态基础层，初始化由 lifecycle 显式调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { normalizeWorkbenchLayout } from '../workbench/model.js';
import {
  DETACHED_KEY,
  API_KEY,
  BRIDGE_TIMEOUT_MS,
  DEFAULT_PROMPT_CLICK_MODE,
  DEFAULT_STEPWISE_ITEMS,
  DEFAULT_VIEW_ORDER,
  INSTANCE_ID,
  IS_POPOUT,
  LABEL_ONLY_KEY,
  MAX_STEPWISE_ITEMS,
  MAX_TEXT_LENGTH,
  PAGE_BRIDGE,
  POPOUT,
  PROMPT_CLICK_MODES,
  PROMPT_CLICK_MODE_KEY,
  ROOT_ATTR,
  VIEW_ORDER_KEY,
} from './constants.js';

('use strict');

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      if (IS_POPOUT && window[API_KEY]?.instanceId === INSTANCE_ID)
        POPOUT.save(window[API_KEY].panelPreferences());
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

function normalizePromptClickMode(value) {
  return PROMPT_CLICK_MODES.includes(value) ? value : DEFAULT_PROMPT_CLICK_MODE;
}

function readPromptClickMode() {
  const stored = storage.get(PROMPT_CLICK_MODE_KEY);
  if (PROMPT_CLICK_MODES.includes(stored)) return stored;
  storage.set(PROMPT_CLICK_MODE_KEY, DEFAULT_PROMPT_CLICK_MODE);
  return DEFAULT_PROMPT_CLICK_MODE;
}

function normalizeViewOrder(value) {
  const source = Array.isArray(value) ? value : [];
  const result = source.filter(
    (tab, index) => DEFAULT_VIEW_ORDER.includes(tab) && source.indexOf(tab) === index,
  );
  DEFAULT_VIEW_ORDER.forEach((tab) => {
    if (!result.includes(tab)) result.push(tab);
  });
  return result;
}

function readViewOrder() {
  try {
    return normalizeViewOrder(JSON.parse(storage.get(VIEW_ORDER_KEY) || 'null'));
  } catch {
    return DEFAULT_VIEW_ORDER.slice();
  }
}

function createRuntimeState(preferences) {
  return {
    settingsPromise: null,
    startupPromise: null,
    settingsRequestId: 0,
    settingsSyncEpoch: 0,
    pendingSettingsPatch: {},
    observer: null,
    timer: 0,
    settings: /** @type {import("../../contracts").Settings|null} */ (null),
    settingsLoaded: false,
    settingsFingerprint: '',
    settingsSyncTimer: 0,
    settingsStatus: '',
    scans: 0,
    runtimeGeneration: 0,
    runtimeActive: false,
    domReadyHandler: null,
    destroyed: false,
    diagnostics: preferences.diagnostics,
    signalCleanup: null,
  };
}

/** @type {ReturnType<typeof createRuntimeState>} */
const runtimeState = /** @type {any} */ ({});

function createContextState(preferences) {
  return {
    codexAppActionsPromise: null,
    lastAssistantHash: '',
    lastAssistantAt: 0,
    scanStatus: 'idle',
    scanBusy: false,
    lastScanStatus: '',
    pinnedThreadRoot: null,
    pinnedThreadAt: 0,
    pinnedPaneKey: '',
    pinnedSessionId: '',
    latestTurnAnchor: null,
    nodeKeySeq: 0,
    nodeKeys: new WeakMap(),
    activeContext: {
      paneRoot: null,
      paneKey: '',
      sessionId: '',
      assistantMessageId: '',
      generation: 0,
    },
    focusHandler: null,
    pointerHandler: null,
    selectionHandler: null,
  };
}

/** @type {ReturnType<typeof createContextState>} */
const contextState = /** @type {any} */ ({});

function createStepwiseState(preferences) {
  return {
    currentHash: '',
    bridgeCache: new Map(),
    bridgeActiveKey: '',
    bridgePendingHash: '',
    bridgePendingRequestId: 0,
    bridgePendingMode: 'auto',
    bridgeRequestSequence: 0,
    bridgeStatus: 'idle',
    bridgeError: '',
    prompts: [],
    promptContext: null,
    stepwiseEpoch: 0,
  };
}

/** @type {ReturnType<typeof createStepwiseState>} */
const stepwiseState = /** @type {any} */ ({});

function createOutlineState(preferences) {
  return {
    flashTimer: 0,
    outlineItems: [],
    outlineStatus: 'idle',
    outlineError: '',
    outlineFingerprint: '',
    outlineSourceHash: '',
    outlineRefreshPromise: null,
    outlineMessage: null,
    outlineScrollCleanup: null,
    outlineEpoch: 0,
  };
}

/** @type {ReturnType<typeof createOutlineState>} */
const outlineState = /** @type {any} */ ({});

function createShellState(preferences) {
  return {
    detached: !IS_POPOUT && sessionStorage.getItem(DETACHED_KEY) === 'true',
    presentationFingerprint: '',
    remoteSource: /** @type {import("../../contracts").PanelSnapshot|null} */ (null),
    remoteFingerprint: '',
    nativeSizeChanging: false,
    pinnedOnTop: false,
    detachPending: false,
    detachedRecoveryTimer: 0,
    handoffAnimation: null,
    handoffGeneration: 0,
    handoffPromise: null,
    handoffTarget: null,
    themeObserver: null,
    typographyObserver: null,
    promptPreviewTimer: 0,
    promptClickTimer: 0,
    lastFaceClick: null,
    faceClickTimer: 0,
    promptPreviewIndex: 0,
    expressionTimer: 0,
    completionBeamTimer: 0,
    snapTimer: 0,
    materialAnimTimer: 0,
    viewAnimation: null,
    viewIndicatorFrame: 0,
    viewReorderCleanup: null,
    suppressViewTabClickUntil: 0,
    viewTransitioning: false,
    pendingTab: '',
    pendingRender: false,
    root: null,
    fab: null,
    popover: null,
    glass: null,
    rim: null,
    completionBeam: null,
    panel: null,
    contentFadeCleanup: null,
    open: IS_POPOUT,
    morphAnimation: null,
    rimMorphAnimation: null,
    panelMorphAnimation: null,
    fabMorphAnimation: null,
    morphTransition: null,
    morphGeneration: 0,
    layout: null,
    focusAfterMorph: '',
    activeTab: 'next',
    layoutMode: /** @type {'capsule'|'workbench'} */ ('capsule'),
    dockWidth: 340,
    splitRatio: 0.45,
    dockLayout: normalizeWorkbenchLayout(null),
    popoutLayout: normalizeWorkbenchLayout(null),
    dockOpen: true,
    dockRect: null,
    dockStatus: '',
    workbenchSettings: false,
    workbenchLayoutCleanup: null,
    restoringWorkbench: false,
    viewOrder: readViewOrder(),
    position: null,
    width: preferences.width,
    height: preferences.height,
    hostTypography: /** @type {import("../../contracts").HostTypography} */ (
      preferences.hostTypography
    ),
    fontOffset: preferences.fontOffset,
    material: preferences.material,
    liquidVariant: preferences.liquidVariant,
    labelOnly: storage.get(LABEL_ONLY_KEY) === 'true',
    promptClickMode: readPromptClickMode(),
    drag: null,
    dragCleanup: null,
    resizeDrag: null,
    resizeCleanup: null,
    suppressFabClick: false,
    suppressHeadFaceClick: false,
    eyePointer: null,
    eyeRaf: 0,
    eyeCleanup: null,
    sourceCueAngle: null,
    sourceCueAnimation: 0,
    surpriseUntil: 0,
    fabExpression: 'idle',
    theme: 'dark',
    themeMode: 'auto',
    keyHandler: null,
  };
}

/** @type {ReturnType<typeof createShellState>} */
const shellState = /** @type {any} */ ({});

function initializeState(preferences) {
  Object.assign(runtimeState, createRuntimeState(preferences));
  Object.assign(contextState, createContextState(preferences));
  Object.assign(stepwiseState, createStepwiseState(preferences));
  Object.assign(outlineState, createOutlineState(preferences));
  Object.assign(shellState, createShellState(preferences));
}

// Legacy diagnostic shape; runtime code uses the five owned state objects.
function debugState() {
  return { ...runtimeState, ...contextState, ...stepwiseState, ...outlineState, ...shellState };
}

function isCurrentInstance() {
  return !runtimeState.destroyed && window[API_KEY]?.instanceId === INSTANCE_ID;
}

function isCurrentRuntime(generation = runtimeState.runtimeGeneration) {
  return (
    isCurrentInstance() &&
    runtimeState.runtimeActive &&
    generation === runtimeState.runtimeGeneration
  );
}

function stepwiseEnabled(settings = runtimeState.settings) {
  return settings?.enabled === true;
}

function normalizeGenerationMode(value) {
  return value === 'manual' ? 'manual' : 'auto';
}

function stepwiseGenerationMode(settings = runtimeState.settings) {
  return normalizeGenerationMode(settings?.generationMode);
}

function outlineEnabled(settings = runtimeState.settings) {
  return settings?.answerOutlineEnabled === true;
}

function runtimeEnabled(settings = runtimeState.settings) {
  return IS_POPOUT || stepwiseEnabled(settings) || outlineEnabled(settings);
}

function enabledViewOrder() {
  return shellState.viewOrder.filter((tab) =>
    tab === 'next' ? stepwiseEnabled() : outlineEnabled(),
  );
}

function viewNavigationOrder() {
  return [...enabledViewOrder(), 'settings'];
}

function persistViewOrder(order) {
  shellState.viewOrder = normalizeViewOrder(order);
  storage.set(VIEW_ORDER_KEY, JSON.stringify(shellState.viewOrder));
}

function configuredMaxPromptItems(settings = runtimeState.settings) {
  const value = Number(settings?.maxItems);
  if (!Number.isFinite(value)) return DEFAULT_STEPWISE_ITEMS;
  return clamp(Math.floor(value), 1, MAX_STEPWISE_ITEMS);
}

function stepwiseInputText(value) {
  const configured = Number(runtimeState.settings?.maxInputChars);
  const limit = Number.isFinite(configured)
    ? clamp(Math.floor(configured), 500, 32000)
    : MAX_TEXT_LENGTH;
  return Array.from(normalizeText(value)).slice(-limit).join('');
}

function normalizeActiveTab(tab = shellState.activeTab) {
  if (tab === 'settings') return 'settings';
  if (tab === 'next' && stepwiseEnabled()) return 'next';
  if (tab === 'outline' && outlineEnabled()) return 'outline';
  if (stepwiseEnabled()) return 'next';
  if (outlineEnabled()) return 'outline';
  return IS_POPOUT ? 'settings' : 'next';
}

function settingsFingerprint(settings) {
  if (!settings || typeof settings !== 'object') return '';
  return JSON.stringify(
    Object.keys(settings)
      .sort()
      .map((key) => [key, settings[key]]),
  );
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function shortText(value, limit = MAX_TEXT_LENGTH) {
  const text = normalizeText(value);
  return text.length > limit ? text.slice(text.length - limit) : text;
}

function hashText(value) {
  const source = String(value ?? '');
  let digest = 0;
  for (const character of source) digest = (digest * 31 + character.codePointAt(0)) | 0;
  return `${source.length.toString(36)}-${(digest >>> 0).toString(36)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stripOwnUi(clone) {
  clone.querySelectorAll?.(`[${ROOT_ATTR}]`).forEach((item) => item.remove());
  return clone;
}

function elementText(node) {
  if (!(node instanceof Element)) return normalizeText(node?.textContent || '');
  return normalizeText(stripOwnUi(node.cloneNode(true)).textContent || '');
}

function directText(node) {
  if (!(node instanceof Element)) return '';
  const clone = stripOwnUi(node.cloneNode(true));
  clone.querySelectorAll?.("button,[role='button'],svg").forEach((item) => item.remove());
  return normalizeText(clone.textContent || '');
}

function bridgeCall(path, payload) {
  if (typeof window[PAGE_BRIDGE] !== 'function') {
    return Promise.resolve({ error: 'page bridge is not installed', items: [] });
  }
  let timer = 0;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(
      () => resolve({ error: 'page bridge timed out', items: [] }),
      BRIDGE_TIMEOUT_MS,
    );
  });
  const request = Promise.resolve(window[PAGE_BRIDGE](path, payload || {}));
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function roundPixel(value) {
  return Math.round(Number(value) * 100) / 100;
}

export {
  bridgeCall,
  clamp,
  configuredMaxPromptItems,
  contextState,
  debugState,
  directText,
  elementText,
  enabledViewOrder,
  escapeAttr,
  escapeHtml,
  hashText,
  initializeState,
  isCurrentInstance,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizeGenerationMode,
  normalizePromptClickMode,
  normalizeText,
  normalizeViewOrder,
  outlineEnabled,
  outlineState,
  persistViewOrder,
  roundPixel,
  runtimeEnabled,
  runtimeState,
  settingsFingerprint,
  shellState,
  shortText,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseInputText,
  stepwiseState,
  storage,
  stripOwnUi,
  viewNavigationOrder,
};
