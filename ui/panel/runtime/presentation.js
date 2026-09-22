/*
 * [INPUT]: 工作台纯布局模型的旧比例迁移； 后台 popoutSupported 能力、共享胶囊状态、宿主上下文与弹出页通信对象。
 * [OUTPUT]: 共享关联及双面板阅读投影、关联/快捷词填入命令及配置/身份校验；阅读状态按实际渲染外壳接续。
 * [POS]: 内嵌与系统窗口的显示边界，宿主保留业务权威状态，在不可见宿主中仍提供临时屏幕区域与交接眨眼，配合原生窗口位置接续。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { iconSvg } from '../icons/index.js';
import { readWorkbenchScroll, writeWorkbenchScroll } from '../workbench/reading.js';
import { normalizeWorkbenchLayout } from '../workbench/model.js';
import {
  DETACHED_KEY,
  FONT_OFFSET_KEY,
  HEIGHT_KEY,
  INSTANCE_ID,
  IS_POPOUT,
  LABEL_ONLY_KEY,
  MATERIAL_KEY,
  LIQUID_VARIANT_KEY,
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
import {
  chatBindingStatus,
  changeChatBinding,
  bindingSourceReady,
  chatBusy,
  contextMatches,
  contextSnapshot,
} from '../host/context.js';
import { foregroundSurface } from '../host/surfaces.js';
import {
  clampFontOffset,
  clampPanelWidth,
  clampPanelHeight,
  normalizeMaterial,
} from '../core/panel-appearance.js';
import { defaultPosition, shellLayout } from '../core/geometry.js';
import { emitSignal } from './signals.js';
import { fillComposer, forceRefreshStepwise, normalizePromptState } from '../stepwise.js';
import { outlineJumpTo, outlineJumpToAnchor, refreshOutline } from '../outline.js';
import { panelPreferences, sizeNativePanel } from '../popout/transport.js';

let preferencesRevision = -1;

// 仅在交接时读取；屏幕坐标不写入偏好，也不包含宿主正文。
function panelWindowAnchor() {
  if (IS_POPOUT || !shellState.glass?.isConnected) return null;
  const layout = shellLayout();
  // 弹出后玻璃背景层 display:none；从同一套布局计算收回位置，不能读取零尺寸 DOM。
  const dock = shellState.layoutMode === 'workbench' && shellState.dockRect;
  const rect = dock
    ? dock.anchor
    : !shellState.open
      ? {
          left: layout.anchor.x,
          top: layout.anchor.y,
          width: layout.chip.width,
          height: layout.chip.height,
          right: layout.anchor.x + layout.chip.width,
          bottom: layout.anchor.y + layout.chip.height,
        }
      : shellState.detached || document.hidden
        ? {
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height,
            right: layout.left + layout.width,
            bottom: layout.top + layout.height,
          }
        : shellState.glass.getBoundingClientRect();
  const border = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const titlebar = Math.max(0, window.outerHeight - window.innerHeight - border);
  if (
    border > 20 ||
    titlebar > 140 ||
    rect.width < 40 ||
    rect.height < 20 ||
    rect.left < 0 ||
    rect.top < 0 ||
    rect.right > innerWidth ||
    rect.bottom > innerHeight
  )
    return null;
  return {
    x: screenX + border + rect.left,
    y: screenY + titlebar + rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function blinkHandoff() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const eye of shellState.panel?.querySelectorAll('.csw-fab-eye') || []) {
    eye.animate(
      [
        { transform: 'scaleY(1)' },
        { transform: 'scaleY(.14)', offset: 0.45 },
        { transform: 'scaleY(1)' },
      ],
      { duration: 180, easing: 'ease-in-out' },
    );
  }
}

function applyWorkbenchPreferences(ui) {
  shellState.layoutMode = ui.layoutMode === 'workbench' ? 'workbench' : 'capsule';
  shellState.dockWidth = clamp(Number(ui.dockWidth) || 340, 300, 460);
  shellState.splitRatio = clamp(Number(ui.splitRatio) || 0.45, 0.2, 0.8);
  shellState.dockLayout = normalizeWorkbenchLayout(ui.dockLayout, shellState.splitRatio);
  shellState.popoutLayout = normalizeWorkbenchLayout(ui.popoutLayout, shellState.splitRatio);
  shellState.splitRatio = shellState.dockLayout.verticalRatio;
  shellState.dockOpen = ui.dockOpen !== false;
}

function applyPanelPreferences(ui) {
  if (!ui) return;
  applyWorkbenchPreferences(ui);
  // 保留浮窗请求尺寸；内嵌只在布局时收敛，避免收回后丢失大窗口偏好。
  shellState.width = clampPanelWidth(ui.width, Infinity);
  shellState.height = clampPanelHeight(ui.height, Infinity);
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
    const initial = preferencesRevision === -1;
    preferencesRevision = revision;
    if (initial && revision === 0 && ui) {
      applyWorkbenchPreferences(ui);
      emitSignal('render', undefined);
    }
    if (revision > 0 && JSON.stringify(panelPreferences()) !== JSON.stringify(ui))
      applyPanelPreferences(ui);
  }
  void setDetached(detached, ui, null);
}

function readingContentToken(tab) {
  return hashText(
    JSON.stringify(
      tab === 'next'
        ? [
            runtimeState.settings?.generationRevision,
            stepwiseState.prompts.map(({ label, summary, prompt }) => [label, summary, prompt]),
          ]
        : tab === 'outline'
          ? outlineState.outlineItems.map(({ id, text }) => [id, text])
          : 'settings',
    ),
  );
}

function readingState(viewToken) {
  const body = shellState.panel?.querySelector(
    `.csw-body[data-view-body="${shellState.activeTab}"]`,
  );
  const promptScroll = shellState.panel?.querySelector('.csw-prompt-preview-scroll');
  return {
    viewToken,
    contentToken: readingContentToken(shellState.activeTab),
    activeTab: shellState.activeTab,
    scrollTop: readWorkbenchScroll(body),
    promptPreviewIndex: Number(shellState.promptPreviewIndex) || 0,
    promptScrollTop: readWorkbenchScroll(promptScroll),
    ...(shellState.panel?.querySelector('.csw-workbench')
      ? {
          panes: Object.fromEntries(
            ['outline', 'next'].map((kind) => [
              kind,
              {
                contentToken: readingContentToken(kind),
                scrollTop: readWorkbenchScroll(
                  shellState.panel?.querySelector(`.csw-body[data-view-body="${kind}"]`),
                ),
              },
            ]),
          ),
        }
      : {}),
  };
}

function panelReadingState() {
  const viewToken = IS_POPOUT ? shellState.remoteSource?.viewToken : exportPanelState()?.viewToken;
  return viewToken ? readingState(viewToken) : null;
}

function validReadingState(value, viewToken) {
  return (
    Boolean(value && viewToken) &&
    value.viewToken === viewToken &&
    ['next', 'outline', 'settings'].includes(value.activeTab) &&
    (value.panes ? true : value.contentToken === readingContentToken(value.activeTab)) &&
    Number.isFinite(value.scrollTop) &&
    Number.isInteger(value.promptPreviewIndex) &&
    Number.isFinite(value.promptScrollTop)
  );
}

function applyReadingSelection(value, viewToken) {
  if (!validReadingState(value, viewToken)) return false;
  shellState.activeTab = normalizeActiveTab(value.activeTab);
  shellState.restoringWorkbench = Boolean(value.panes);
  shellState.promptPreviewIndex = clamp(
    value.panes && value.panes.next?.contentToken !== readingContentToken('next')
      ? 0
      : value.promptPreviewIndex,
    0,
    Math.max(0, stepwiseState.prompts.length - 1),
  );
  return true;
}

function restoreReadingScroll(value, viewToken) {
  shellState.restoringWorkbench = false;
  if (!validReadingState(value, viewToken)) return;
  if (value.panes) {
    for (const kind of ['outline', 'next']) {
      if (value.panes[kind]?.contentToken !== readingContentToken(kind)) continue;
      const pane = shellState.panel?.querySelector(`.csw-body[data-view-body="${kind}"]`);
      writeWorkbenchScroll(pane, value.panes[kind].scrollTop);
    }
    if (value.panes.next?.contentToken === readingContentToken('next')) {
      const preview = shellState.panel?.querySelector('.csw-prompt-preview-scroll');
      writeWorkbenchScroll(preview, value.promptScrollTop);
    }
    return;
  }
  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  if (
    !body ||
    body.dataset.viewBody !== value.activeTab ||
    shellState.activeTab !== value.activeTab
  )
    return;
  writeWorkbenchScroll(
    body,
    body.clientHeight
      ? clamp(value.scrollTop, 0, Math.max(0, body.scrollHeight - body.clientHeight))
      : value.scrollTop,
  );
  const promptScroll = body.querySelector('.csw-prompt-preview-scroll');
  if (promptScroll) writeWorkbenchScroll(promptScroll, value.promptScrollTop);
}

async function animateHandoff(next) {
  const root = shellState.root;
  if (!root) return;
  const from = root.dataset.detached === 'true' ? 0 : Number(getComputedStyle(root).opacity);
  shellState.handoffAnimation?.cancel?.();
  const generation = ++shellState.handoffGeneration;
  root.style.pointerEvents = 'none';
  root.inert = true;
  if (!next) {
    root.style.visibility = '';
    root.setAttribute('data-detached', 'false');
  }
  window.dispatchEvent(new Event('codex-buddy:appearance'));
  if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.style.opacity = '';
  } else {
    const animation = root.animate([{ opacity: from }, { opacity: next ? 0 : 1 }], {
      duration: next ? 110 : 120,
      easing: 'cubic-bezier(.2, .72, .2, 1)',
      fill: 'forwards',
    });
    shellState.handoffAnimation = animation;
    await animation.finished.catch(() => null);
    if (generation !== shellState.handoffGeneration) return;
    // 先落实可见性，再取消 fill，避免透明动画留在根节点。
    root.style.visibility = next ? 'hidden' : '';
    animation.cancel();
    shellState.handoffAnimation = null;
    root.style.opacity = '';
  }
  if (generation !== shellState.handoffGeneration) return;
  root.style.visibility = next ? 'hidden' : '';
  root.style.pointerEvents = next ? 'none' : '';
  root.setAttribute('data-detached', String(next));
  root.inert = next;
  if (!next) blinkHandoff();
}

async function setDetached(value, ui = null, presentation = null) {
  if (IS_POPOUT || !isCurrentRuntime()) return;
  const next = value === true;
  const fingerprint = JSON.stringify(ui);
  if ((next || shellState.detached) && shellState.presentationFingerprint !== fingerprint) {
    shellState.presentationFingerprint = fingerprint;
    applyPanelPreferences(ui);
  }
  shellState.detached = next;
  if (shellState.layoutMode === 'workbench') emitSignal('render', undefined);
  clearTimeout(shellState.detachedRecoveryTimer);
  shellState.detachedRecoveryTimer = next
    ? window.setTimeout(() => {
        if (isCurrentRuntime() && shellState.detached) void setDetached(false, null, null);
      }, 15000)
    : 0;
  sessionStorage.setItem(DETACHED_KEY, String(next));
  const currentToken = presentation ? exportPanelState()?.viewToken : null;
  if (!next && applyReadingSelection(presentation, currentToken)) emitSignal('render', undefined);
  if (!next) restoreReadingScroll(presentation, currentToken);
  if (
    shellState.root &&
    (shellState.handoffPromise || shellState.root.getAttribute('data-detached') !== String(next))
  ) {
    if (shellState.handoffTarget !== next) {
      shellState.handoffTarget = next;
      const handoff = animateHandoff(next).finally(() => {
        if (shellState.handoffPromise === handoff) {
          shellState.handoffPromise = null;
          shellState.handoffTarget = null;
        }
      });
      shellState.handoffPromise = handoff;
    }
    await shellState.handoffPromise;
  }
  window.dispatchEvent(new Event('codex-buddy:appearance'));
}

/** @returns {import("../../contracts").PanelSnapshot|null} */
function exportPanelState() {
  if (IS_POPOUT || !isCurrentRuntime()) return null;

  const context = contextSnapshot();
  const foreground = foregroundSurface();
  const chatTitle =
    foreground?.thread === contextState.activeContext.paneRoot
      ? foreground?.dialog.querySelector('header')?.textContent?.trim().slice(0, 100)
      : '';
  const outline = outlineState.outlineItems.map(
    ({ id, text, displayLevel, numberPrefix, labelText }) => ({
      id,
      text,
      displayLevel,
      numberPrefix,
      labelText,
    }),
  );
  const association = chatBindingStatus();
  const viewToken = hashText(
    JSON.stringify([
      context.runtimeGeneration,
      context.generation,
      context.sessionId || context.paneKey,
      context.assistantMessageId,
      contextState.lastAssistantHash,
    ]),
  );
  const promptToken = hashText(
    JSON.stringify([
      runtimeState.settings?.generationRevision,
      stepwiseState.prompts,
      runtimeState.settings?.quickPrompts,
    ]),
  );
  const outlineToken = hashText(JSON.stringify(outline));
  const panelReading = readingState(viewToken);
  return {
    instanceId: INSTANCE_ID,
    context,
    answerHash: contextState.lastAssistantHash,
    viewToken,
    promptToken,
    outlineToken,
    readingState: panelReading,
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
    association,
    sourceLabel:
      association.mode === 'locked'
        ? `已锁定：${association.label || association.sessionId}${association.available ? '' : ' · 来源暂不可用'}`
        : chatTitle
          ? `聊天 · ${chatTitle}`
          : context.sessionId
            ? `Codex · 任务 ${context.sessionId.slice(-8)}`
            : 'Codex · 未选择任务',
  };
}

/** @param {import("../../contracts").PanelCommand} command */
function panelCommand(command) {
  if (
    ![
      'association',
      'fill',
      'quick-fill',
      'generate',
      'outline-refresh',
      'outline-jump',
      'outline-anchor',
    ].includes(command?.kind)
  )
    return { ok: false, message: '不支持的浮窗操作。' };
  emitSignal('verify', undefined);
  const current = exportPanelState();
  if (!current || command.instanceId !== INSTANCE_ID || command.viewToken !== current.viewToken)
    return { ok: false, message: '回答或任务已经变化，请刷新后重试。' };
  if (command.kind === 'association') return changeChatBinding(command.action, command.sessionId);
  if (!bindingSourceReady() || !contextMatches(command.context))
    return { ok: false, message: '聊天来源暂不可用或已变化，请重新确认。' };
  if (
    ['fill', 'quick-fill', 'generate'].includes(command.kind) &&
    command.promptToken !== current.promptToken
  )
    return { ok: false, message: '建议或生成配置已经更新，请刷新后重试。' };
  if (chatBusy() && command.kind !== 'quick-fill')
    return { ok: false, message: '回答正在生成，请等待完成。' };
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
  if (command.kind === 'fill' || command.kind === 'quick-fill') {
    if (command.promptToken !== current.promptToken)
      return { ok: false, message: '建议已经更新，请重新选择。' };
    const index = Number(command.index);
    const items =
      command.kind === 'quick-fill' ? runtimeState.settings?.quickPrompts : stepwiseState.prompts;
    const prompt = Number.isInteger(index) ? items?.[index]?.prompt : null;
    if (!prompt) return { ok: false, message: '这条建议已经失效。' };
    const result = fillComposer(prompt, command.kind === 'fill' && command.submit === true, {
      remote: true,
      quick: command.kind === 'quick-fill',
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
  normalizePromptState(source.prompts);
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
  if (initial) applyReadingSelection(source.readingState, source.viewToken);
  emitSignal('render', undefined);
  if (initial) restoreReadingScroll(source.readingState, source.viewToken);
}

function panelDisconnected(message) {
  if (shellState.remoteSource?.association?.mode === 'locked') {
    shellState.remoteSource.association.available = false;
    shellState.remoteSource.sourceLabel = `已锁定：${shellState.remoteSource.association.label} · 来源暂不可用`;
    shellState.remoteFingerprint = '';
    emitSignal('render', undefined);
    return;
  }
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

function panelWindowControls({ includePin = true } = {}) {
  const unsupported = !IS_POPOUT && runtimeState.settings?.popoutSupported !== true;
  const label = IS_POPOUT
    ? '放回聊天'
    : unsupported
      ? '桌面浮窗仅支持 macOS 15 及以上的 Apple Silicon 设备'
      : shellState.detachPending
        ? '正在弹出…'
        : '移到独立窗口';
  const popIcon = iconSvg(IS_POPOUT ? 'return' : 'detach');
  const pinTitle = shellState.pinnedOnTop ? '取消窗口置顶' : '窗口置顶';
  const pin =
    IS_POPOUT && includePin
      ? `<button class="csw-icon csw-desktop-pin" type="button" data-action="pin" aria-pressed="${shellState.pinnedOnTop}" title="${pinTitle}" aria-label="${pinTitle}">${iconSvg('pin')}</button>`
      : '';
  return `${pin}<button class="csw-icon" type="button" data-action="detach" title="${label}" aria-label="${label}" ${unsupported || shellState.detachPending ? 'disabled' : ''}>${popIcon}</button>`;
}

async function togglePanelWindow() {
  if (IS_POPOUT && shellState.detachPending) {
    POPOUT.cancelDock?.();
    return;
  }
  if (shellState.detachPending || (!IS_POPOUT && runtimeState.settings?.popoutSupported !== true))
    return;
  shellState.detachPending = true;
  emitSignal('render', undefined);
  try {
    if (IS_POPOUT) await POPOUT.dock();
    else {
      const result = await bridgeCall('/panel/detach', { ui: panelPreferences() });
      if (result.error) throw new Error(result.error);
    }
  } catch (error) {
    if (IS_POPOUT) POPOUT.notice(error.message);
    else {
      stepwiseState.bridgeError = error.message;
      stepwiseState.bridgeStatus = 'failed';
    }
  } finally {
    shellState.detachPending = false;
    emitSignal('render', undefined);
  }
}

function bindPanelWindowControls() {
  shellState.panel
    .querySelector('[data-action="detach"]')
    ?.addEventListener('click', () => void togglePanelWindow());
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
  togglePanelWindow,
  bindPanelWindowControls,
  exportPanelState,
  panelCommand,
  panelDisconnected,
  panelReadingState,
  readingContentToken,
  panelWindowAnchor,
  blinkHandoff,
  panelWindowControls,
  receivePanelState,
  setDetached,
  syncPanelPreferences,
};
