/*
 * [INPUT]: 后台 popoutSupported 能力、共享胶囊状态、宿主上下文与弹出页通信对象。
 * [OUTPUT]: 弹出强制展开、窗口/材质偏好同步、含宿主主题色且不覆盖系统明暗的状态投影、受限业务命令及弹出/收回入口。
 * [POS]: 内嵌与系统窗口的显示边界，宿主保留业务权威状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  DETACHED_KEY,
  FONT_OFFSET_KEY,
  HEIGHT_KEY,
  INSTANCE_ID,
  IS_POPOUT,
  LABEL_ONLY_KEY,
  MATERIAL_KEY,
  LIQUID_VARIANT_KEY,
  PANEL_HEIGHT,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  POPOUT,
  PROMPT_CLICK_MODE_KEY,
  VIEW_ORDER_KEY,
  WIDTH_KEY,
} from './constants.js';
import {
  bridgeCall,
  clamp,
  contextState,
  escapeAttr,
  escapeHtml,
  hashText,
  isCurrentRuntime,
  normalizeActiveTab,
  normalizePromptClickMode,
  normalizeViewOrder,
  outlineState,
  runtimeState,
  shellState,
  stepwiseState,
  storage,
} from './state.js';
import { chatBusy, contextMatches, contextSnapshot } from '../host/context.js';
import { clampFontOffset, clampPanelWidth, normalizeMaterial } from '../core/panel-appearance.js';
import { defaultPosition } from '../core/geometry.js';
import { emitSignal } from './signals.js';
import { fillComposer, forceRefreshStepwise } from '../stepwise.js';
import { outlineJumpTo, outlineJumpToAnchor, refreshOutline } from '../outline.js';
import { panelPreferences, sizeNativePanel } from '../popout/transport.js';

let preferencesRevision = -1;

function applyPanelPreferences(ui) {
  if (!ui) return;
  shellState.width = clampPanelWidth(ui.width);
  shellState.height = clamp(Number(ui.height) || PANEL_HEIGHT, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT);
  shellState.fontOffset = clampFontOffset(
    ui.fontOffset,
    shellState.hostTypography.baseItemFontSize,
  );
  shellState.material = normalizeMaterial(ui.material);
  shellState.liquidVariant = ui.liquidVariant === 'clear' ? 'clear' : 'regular';
  shellState.labelOnly = ui.labelOnly === true;
  shellState.promptClickMode = normalizePromptClickMode(ui.promptClickMode);
  shellState.viewOrder = normalizeViewOrder(ui.viewOrder);
  shellState.activeTab = normalizeActiveTab(ui.activeTab);
  shellState.open = IS_POPOUT || ui.open === true;
  for (const [key, value] of [
    [WIDTH_KEY, shellState.width],
    [HEIGHT_KEY, shellState.height],
    [FONT_OFFSET_KEY, shellState.fontOffset],
    [MATERIAL_KEY, shellState.material],
    [LIQUID_VARIANT_KEY, shellState.liquidVariant],
    [LABEL_ONLY_KEY, shellState.labelOnly],
    [PROMPT_CLICK_MODE_KEY, shellState.promptClickMode],
  ])
    storage.set(key, String(value));
  storage.set(VIEW_ORDER_KEY, JSON.stringify(shellState.viewOrder));
  emitSignal('render', undefined);
}

function syncPanelPreferences(ui, revision, detached) {
  if (preferencesRevision !== revision) {
    preferencesRevision = revision;
    if (revision > 0 && JSON.stringify(panelPreferences()) !== JSON.stringify(ui))
      applyPanelPreferences(ui);
  }
  setDetached(detached, ui);
}

function setDetached(value, ui) {
  if (IS_POPOUT || !isCurrentRuntime()) return;
  const next = value === true;
  const fingerprint = JSON.stringify(ui);
  if ((next || shellState.detached) && shellState.presentationFingerprint !== fingerprint) {
    shellState.presentationFingerprint = fingerprint;
    applyPanelPreferences(ui);
  }
  shellState.detached = next;
  clearTimeout(shellState.detachedRecoveryTimer);
  shellState.detachedRecoveryTimer = next
    ? window.setTimeout(() => {
        if (isCurrentRuntime() && shellState.detached) setDetached(false, null);
      }, 15000)
    : 0;
  sessionStorage.setItem(DETACHED_KEY, String(next));
  if (shellState.root && shellState.root.getAttribute('data-detached') !== String(next)) {
    shellState.root.style.visibility = next ? 'hidden' : '';
    shellState.root.style.pointerEvents = next ? 'none' : '';
    shellState.root.setAttribute('data-detached', String(next));
    shellState.root.inert = next;
    window.dispatchEvent(new Event('codex-buddy:appearance'));
  }
}

/** @returns {import("../../contracts").PanelSnapshot|null} */
function exportPanelState() {
  if (IS_POPOUT || !isCurrentRuntime()) return null;

  const context = contextSnapshot();
  const outline = outlineState.outlineItems.map(
    ({ id, text, displayLevel, numberPrefix, labelText }) => ({
      id,
      text,
      displayLevel,
      numberPrefix,
      labelText,
    }),
  );
  const viewToken = hashText(JSON.stringify([context, contextState.lastAssistantHash]));
  const promptToken = hashText(
    JSON.stringify([runtimeState.settings?.generationRevision, stepwiseState.prompts]),
  );
  const outlineToken = hashText(JSON.stringify(outline));
  return {
    instanceId: INSTANCE_ID,
    context,
    answerHash: contextState.lastAssistantHash,
    viewToken,
    promptToken,
    outlineToken,
    prompts: stepwiseState.prompts,
    outlineItems: outline,
    outlineStatus: outlineState.outlineStatus,
    outlineError: outlineState.outlineError,
    bridgeStatus: stepwiseState.bridgeStatus,
    bridgeError: stepwiseState.bridgeError,
    scanBusy: chatBusy(),
    scanStatus: contextState.scanStatus,
    theme: shellState.theme,
    accentColor: getComputedStyle(shellState.root).getPropertyValue('--csw-accent').trim(),
    hostTypography: shellState.hostTypography,
    settings: runtimeState.settings,
    sourceLabel: context.sessionId
      ? `Codex · 任务 ${context.sessionId.slice(-8)}`
      : 'Codex · 未选择任务',
  };
}

/** @param {import("../../contracts").PanelCommand} command */
function panelCommand(command) {
  if (
    !['fill', 'generate', 'outline-refresh', 'outline-jump', 'outline-anchor'].includes(
      command?.kind,
    )
  )
    return { ok: false, message: '不支持的浮窗操作。' };
  emitSignal('verify', undefined);
  const current = exportPanelState();
  if (
    !current ||
    command.instanceId !== INSTANCE_ID ||
    command.viewToken !== current.viewToken ||
    !contextMatches(command.context)
  )
    return { ok: false, message: '回答或任务已经变化，请刷新后重试。' };
  if (['fill', 'generate'].includes(command.kind) && command.promptToken !== current.promptToken)
    return { ok: false, message: '建议或生成配置已经更新，请刷新后重试。' };
  if (chatBusy()) return { ok: false, message: '回答正在生成，请等待完成。' };
  if (command.kind === 'generate') {
    forceRefreshStepwise();
    return { ok: true };
  }
  if (command.kind === 'outline-refresh') {
    void refreshOutline();
    return { ok: true };
  }
  if (command.kind.startsWith('outline-') && command.outlineToken !== current.outlineToken)
    return { ok: false, message: '大纲已经更新，请重新选择小节。' };
  if (command.kind === 'outline-jump')
    return { ok: outlineJumpTo(command.id), message: '找不到对应小节，请刷新后重试。' };
  if (command.kind === 'outline-anchor')
    return { ok: outlineJumpToAnchor(command.anchor), message: '找不到当前回答位置。' };
  if (command.kind === 'fill') {
    if (command.promptToken !== current.promptToken)
      return { ok: false, message: '建议已经更新，请重新选择。' };
    const index = Number(command.index);
    const prompt = Number.isInteger(index) ? stepwiseState.prompts[index]?.prompt : null;
    if (!prompt) return { ok: false, message: '这条建议已经失效。' };
    const result = fillComposer(prompt, command.submit === true, {
      remote: true,
      append: command.append === true,
      draftFingerprint: command.draftFingerprint,
    });
    return typeof result === 'object'
      ? result
      : result === true
        ? { ok: true }
        : { ok: false, message: '无法填入关联的 Codex 输入框。' };
  }
  return { ok: false, message: '不支持的浮窗操作。' };
}

async function receivePanelState(result, initial) {
  if (result.snapshot?.hostTypography) shellState.hostTypography = result.snapshot.hostTypography;
  if (initial || result.preferences.webRevision !== preferencesRevision) {
    preferencesRevision = result.preferences.webRevision;
    applyPanelPreferences(result.preferences.ui);
    shellState.pinnedOnTop = result.preferences.alwaysOnTop;
    await sizeNativePanel(shellState.open);
    if (initial) shellState.position = defaultPosition();
  }
  const source = result.snapshot;
  if (!source) {
    panelDisconnected('Codex 尚未连接；连接恢复后会自动更新。');
    return;
  }
  const fingerprint = JSON.stringify(source);
  shellState.remoteSource = source;
  if (fingerprint === shellState.remoteFingerprint && !initial) return;
  shellState.remoteFingerprint = fingerprint;
  if (source.accentColor && CSS.supports('color', source.accentColor)) {
    shellState.root.style.setProperty('--csw-accent', source.accentColor);
  } else {
    shellState.root.style.removeProperty('--csw-accent');
  }
  stepwiseState.prompts = source.prompts;
  outlineState.outlineItems = source.outlineItems;
  outlineState.outlineStatus = source.outlineStatus;
  outlineState.outlineError = source.outlineError;
  stepwiseState.bridgeStatus = source.bridgeStatus;
  stepwiseState.bridgeError = source.bridgeError;
  contextState.scanBusy = source.scanBusy;
  contextState.scanStatus = source.scanStatus;
  runtimeState.settings = source.settings;
  shellState.hostTypography = source.hostTypography;
  runtimeState.settingsLoaded = true;
  contextState.lastAssistantHash = source.answerHash;
  stepwiseState.promptContext = source.context;
  emitSignal('render', undefined);
}

function panelDisconnected(message) {
  if (!shellState.remoteSource && stepwiseState.bridgeError === message) return;
  shellState.remoteSource = null;
  shellState.remoteFingerprint = '';
  stepwiseState.prompts = [];
  outlineState.outlineItems = [];
  stepwiseState.bridgeStatus = 'failed';
  stepwiseState.bridgeError = message;
  outlineState.outlineStatus = 'error';
  outlineState.outlineError = message;
  emitSignal('render', undefined);
}

function panelWindowControls() {
  const unsupported = !IS_POPOUT && runtimeState.settings?.popoutSupported !== true;
  const label = IS_POPOUT
    ? '收回 Codex'
    : unsupported
      ? '桌面浮窗仅支持 macOS 15 及以上的 Apple Silicon 设备'
      : shellState.detachPending
        ? '正在弹出…'
        : '弹出到桌面';
  const arrow = IS_POPOUT ? 'M21 3l-9 9M12 5v7h7' : 'M14 3h7v7M21 3l-9 9';
  const popIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${arrow}M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>`;
  const pinTitle = IS_POPOUT ? (shellState.pinnedOnTop ? '取消置顶' : '窗口置顶') : '弹出后可置顶';
  const pin = `<button class="csw-icon csw-desktop-pin" type="button" data-action="pin" aria-pressed="${shellState.pinnedOnTop}" title="${pinTitle}" aria-label="${pinTitle}" ${IS_POPOUT ? '' : 'disabled tabindex="-1" aria-hidden="true"'}><svg aria-hidden="true" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="m15 3 6 6-4 1-4 4-1 4-6-6 4-1 4-4 1-4ZM6 18l-3 3"/></svg></button>`;
  return `${pin}<button class="csw-icon" type="button" data-action="detach" title="${label}" aria-label="${label}" ${unsupported || shellState.detachPending ? 'disabled' : ''}>${popIcon}</button>`;
}

function bindPanelWindowControls() {
  shellState.panel.querySelector('[data-action="detach"]')?.addEventListener('click', async () => {
    if (IS_POPOUT) {
      await POPOUT.dock();
      return;
    }
    if (shellState.detachPending || runtimeState.settings?.popoutSupported !== true) return;
    shellState.detachPending = true;
    emitSignal('render', undefined);
    const result = await bridgeCall('/panel/detach', { ui: panelPreferences() });
    shellState.detachPending = false;
    if (result.error) {
      stepwiseState.bridgeError = result.error;
      stepwiseState.bridgeStatus = 'failed';
    }
    emitSignal('render', undefined);
  });
  shellState.panel.querySelector('[data-action="pin"]')?.addEventListener('click', async () => {
    try {
      await POPOUT.pin(!shellState.pinnedOnTop);
      shellState.pinnedOnTop = !shellState.pinnedOnTop;
      emitSignal('render', undefined);
    } catch (error) {
      POPOUT.notice(error.message);
    }
  });
  if (IS_POPOUT) POPOUT.save(panelPreferences());
}

export {
  bindPanelWindowControls,
  exportPanelState,
  panelCommand,
  panelDisconnected,
  panelWindowControls,
  receivePanelState,
  setDetached,
  syncPanelPreferences,
};
