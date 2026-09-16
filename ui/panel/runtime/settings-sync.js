/*
 * [INPUT]: 版本化设置、后台请求与独立功能控制器。
 * [OUTPUT]: 设置保存、同步、低频恢复与功能开关协调。
 * [POS]: 设置协调层；通过通知请求渲染和运行启停。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { SETTINGS_SYNC_INTERVAL_MS } from './constants.js';
import {
  bridgeCall,
  isCurrentInstance,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizeGenerationMode,
  outlineEnabled,
  runtimeEnabled,
  runtimeState,
  settingsFingerprint,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
} from './state.js';
import { emitSignal } from './signals.js';
import { resetStepwiseFeature } from '../stepwise.js';
import { pushDiagnostic } from './diagnostics.js';
import { resetOutlineFeature } from '../outline.js';

function applyRuntimeSettings(nextSettings) {
  const hadStepwise = stepwiseEnabled();
  const hadOutline = outlineEnabled();
  const previousGenerationMode = stepwiseGenerationMode();
  const previousRevision = runtimeState.settings?.generationRevision;
  runtimeState.settings = nextSettings;
  runtimeState.settingsFingerprint = settingsFingerprint(nextSettings);
  if (hadStepwise && !stepwiseEnabled()) resetStepwiseFeature();
  if (hadOutline && !outlineEnabled()) resetOutlineFeature();
  if (
    hadStepwise &&
    stepwiseEnabled() &&
    (previousGenerationMode !== stepwiseGenerationMode() ||
      previousRevision !== nextSettings?.generationRevision)
  ) {
    resetStepwiseFeature(stepwiseGenerationMode() === 'manual' ? 'manual-ready' : 'idle');
  }
  shellState.activeTab = normalizeActiveTab();
  return runtimeState.settings;
}

async function syncSettings(patch = {}) {
  if (!isCurrentInstance()) return null;
  const normalizedPatch = {};
  if (patch && typeof patch === 'object') {
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined) normalizedPatch[key] = value;
    });
  }
  if (Object.keys(normalizedPatch).length) {
    if (!runtimeState.settingsLoaded) {
      runtimeState.pendingSettingsPatch = {
        ...runtimeState.pendingSettingsPatch,
        ...normalizedPatch,
      };
    }
    applyRuntimeSettings({ ...(runtimeState.settings || {}), ...normalizedPatch });
  }
  const hasRuntimePatch =
    typeof normalizedPatch.enabled === 'boolean' ||
    typeof normalizedPatch.answerOutlineEnabled === 'boolean' ||
    Object.prototype.hasOwnProperty.call(normalizedPatch, 'generationMode');
  if (patch?.enabled === true) {
    pushDiagnostic('settings:enabled-sync', {});
  }
  if (patch?.answerOutlineEnabled === true) pushDiagnostic('settings:outline-enabled-sync', {});
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'generationMode')) {
    pushDiagnostic('settings:generation-mode-sync', {
      mode: stepwiseGenerationMode(),
    });
  }
  if (hasRuntimePatch) {
    const hasInFlightSettingsRequest = Boolean(runtimeState.settingsPromise);
    runtimeState.settingsSyncEpoch += 1;
    if (!runtimeState.settingsLoaded || hasInFlightSettingsRequest) {
      runtimeState.pendingSettingsPatch = {
        ...runtimeState.pendingSettingsPatch,
        ...normalizedPatch,
      };
      runtimeState.settingsPromise = null;
      void reloadSettings();
    }
    if (!runtimeEnabled()) {
      pushDiagnostic('settings:disabled-sync', {});
      if (runtimeState.runtimeActive) emitSignal('runtime', false);
      return runtimeState.settings;
    }
    emitSignal('runtime', true);
    emitSignal('render', undefined);
    emitSignal('scan', 0);
    return runtimeState.settings;
  }

  runtimeState.settingsPromise = null;
  runtimeState.startupPromise = null;
  const settings = await loadSettings();
  if (!isCurrentInstance()) return null;
  if (!runtimeEnabled(settings)) {
    pushDiagnostic('settings:disabled-sync', {});
    if (runtimeState.runtimeActive) emitSignal('runtime', false);
    return settings;
  }
  pushDiagnostic('settings:enabled-sync', {});
  emitSignal('runtime', true);
  emitSignal('render', undefined);
  emitSignal('scan', 0);
  return settings;
}

function statusLine(settings) {
  if (!runtimeEnabled(settings)) return '悬浮球已关闭';
  if (!stepwiseEnabled(settings)) return '仅显示大纲';
  if (!settings.baseUrlConfigured || !settings.model) return '尚未配置服务地址或模型';
  if (!settings.apiKeyConfigured) return '尚未配置密钥';
  return `连接就绪 · ${settings.model || ''}`.replace(/\s+·\s+$/, '');
}

async function setGenerationMode(value) {
  if (!isCurrentRuntime() || !runtimeState.settingsLoaded || !stepwiseEnabled()) return;
  const runtimeGeneration = runtimeState.runtimeGeneration;
  const previousMode = stepwiseGenerationMode();
  const nextMode = normalizeGenerationMode(value);
  if (nextMode === previousMode) return;
  const previousSettings = runtimeState.settings;
  const cancelAutoRequestImmediately = previousMode === 'auto' && nextMode === 'manual';
  const requestEpoch = ++runtimeState.settingsSyncEpoch;
  runtimeState.settingsRequestId += 1;
  runtimeState.settingsPromise = null;
  if (cancelAutoRequestImmediately) {
    applyRuntimeSettings({ ...(runtimeState.settings || {}), generationMode: nextMode });
    emitSignal('scan', 0);
  }
  emitSignal('generationControl', { mode: nextMode, busy: true });

  const payload = await bridgeCall('/settings/set', {
    generationMode: nextMode,
  });
  if (!isCurrentRuntime(runtimeGeneration) || requestEpoch !== runtimeState.settingsSyncEpoch)
    return;
  if (payload?.error) {
    if (cancelAutoRequestImmediately) {
      applyRuntimeSettings(previousSettings);
      emitSignal('scan', 0);
    }
    runtimeState.settingsStatus = payload.error || '模式保存失败';
    emitSignal('render', undefined);
    return;
  }

  runtimeState.pendingSettingsPatch = {
    ...runtimeState.pendingSettingsPatch,
    generationMode: nextMode,
  };
  if (!cancelAutoRequestImmediately) {
    applyRuntimeSettings({ ...(runtimeState.settings || {}), generationMode: nextMode });
  }
  runtimeState.settingsStatus = statusLine(runtimeState.settings);
  emitSignal('generationControl', { mode: nextMode, busy: false });
  emitSignal('scan', 0);

  runtimeState.settingsPromise = null;
  await reloadSettings();
}

async function loadSettings() {
  const requestId = ++runtimeState.settingsRequestId;
  const requestEpoch = runtimeState.settingsSyncEpoch;
  const payload = await bridgeCall('/stepwise/settings', {});
  if (
    !isCurrentInstance() ||
    requestId !== runtimeState.settingsRequestId ||
    requestEpoch !== runtimeState.settingsSyncEpoch
  )
    return null;
  let shouldRender = false;
  if (payload?.settings) {
    const nextSettings = { ...payload.settings, ...runtimeState.pendingSettingsPatch };
    if (!Object.prototype.hasOwnProperty.call(nextSettings, 'generationMode')) {
      nextSettings.generationMode = stepwiseGenerationMode();
    }
    runtimeState.pendingSettingsPatch = {};
    const settingsChanged =
      !runtimeState.settingsLoaded ||
      settingsFingerprint(nextSettings) !== runtimeState.settingsFingerprint;
    runtimeState.settingsLoaded = true;
    if (settingsChanged) applyRuntimeSettings(nextSettings);
    if (runtimeEnabled(nextSettings)) {
      if (!runtimeState.runtimeActive) emitSignal('runtime', true);
      if (settingsChanged) {
        runtimeState.settingsStatus = statusLine(nextSettings);
        shouldRender = true;
        emitSignal('scan', 0);
      }
    } else if (runtimeState.runtimeActive) {
      emitSignal('runtime', false);
    }
  } else {
    const nextStatus = payload?.error || 'Bridge 未就绪';
    shouldRender = nextStatus !== runtimeState.settingsStatus;
    runtimeState.settingsStatus = nextStatus;
  }
  if (shouldRender && isCurrentRuntime()) emitSignal('render', undefined);
  return runtimeState.settings;
}

function reloadSettings() {
  if (!runtimeState.settingsPromise) {
    const request = loadSettings();
    const tracked = request.finally(() => {
      if (runtimeState.settingsPromise === tracked) runtimeState.settingsPromise = null;
    });
    runtimeState.settingsPromise = tracked;
  }
  return runtimeState.settingsPromise;
}

function scheduleSettingsSync(delay = SETTINGS_SYNC_INTERVAL_MS) {
  if (!isCurrentInstance()) return;
  if (runtimeState.settingsSyncTimer) window.clearTimeout(runtimeState.settingsSyncTimer);
  runtimeState.settingsSyncTimer = window.setTimeout(async () => {
    runtimeState.settingsSyncTimer = 0;
    try {
      await reloadSettings();
    } catch (error) {
      pushDiagnostic('settings:sync-error', {
        message: String(error?.message || error || 'settings sync failed'),
      });
    } finally {
      scheduleSettingsSync();
    }
  }, delay);
}

async function ensureSettings() {
  if (runtimeState.settingsLoaded) return runtimeState.settings;
  return reloadSettings();
}

async function testSettings() {
  if (!isCurrentRuntime()) return;
  const generation = runtimeState.runtimeGeneration;
  runtimeState.settingsStatus = '正在检查连接';
  emitSignal('render', undefined);
  const payload = await bridgeCall('/stepwise/test', {});
  if (!isCurrentRuntime(generation)) return;
  const count = Array.isArray(payload?.items) ? payload.items.length : 0;
  runtimeState.settingsStatus =
    payload?.error || (payload?.disabled ? '功能已关闭' : `连接正常 · ${count} 条`);
  emitSignal('render', undefined);
}

async function openSettings() {
  if (!isCurrentRuntime()) return;
  const generation = runtimeState.runtimeGeneration;
  runtimeState.settingsStatus = '正在打开配置网页…';
  emitSignal('render', undefined);
  const payload = await bridgeCall('/settings/open', {});
  if (!isCurrentRuntime(generation)) return;
  runtimeState.settingsStatus =
    payload?.status === 'ok' ? '已打开配置网页' : payload?.message || '打开失败';
  emitSignal('render', undefined);
}

export {
  ensureSettings,
  loadSettings,
  openSettings,
  reloadSettings,
  scheduleSettingsSync,
  setGenerationMode,
  statusLine,
  syncSettings,
  testSettings,
};
