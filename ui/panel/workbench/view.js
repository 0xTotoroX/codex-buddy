/*
 * [INPUT]: 共享大纲与 Stepwise 视图、当前聊天身份、工作台布局偏好。
 * [OUTPUT]: 双面板增量渲染、独立滚动、可键盘调整的分隔线及设置覆盖页。
 * [POS]: 工作台组合视图；复用业务状态和写入校验，不创建第二套运行时。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { IS_POPOUT, POPOUT } from '../runtime/constants.js';
import {
  clamp,
  shellState,
  outlineEnabled,
  stepwiseEnabled,
  outlineState,
  stepwiseState,
  contextState,
  runtimeState,
} from '../runtime/state.js';
import { emitSignal } from '../runtime/signals.js';
import {
  outlineHtml,
  attachOutlineEvents,
  alignOutlineNestedText,
  refreshOutline,
} from '../outline.js';
import { forceRefreshStepwise } from '../stepwise.js';
import { settingsHtml, attachSettingsEvents } from '../core/settings-view.js';
import { iconSvg, applyMaterial } from '../core/panel-appearance.js';
import {
  bindPanelWindowControls,
  panelWindowControls,
  exportPanelState,
  readingContentToken,
} from '../runtime/presentation.js';
import { closeWorkbench, setWorkbench, saveWorkbench } from './layout.js';
import { installPanelDrag } from '../core/interaction.js';
import { workbenchReading, rememberWorkbenchReading } from './reading.js';

const paneContent = new WeakMap();

function bindSeparator(handle, axis, read, change) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const origin = axis === 'x' ? event.clientX : event.clientY;
    const value = read();
    const move = (event) => change(value, (axis === 'x' ? event.clientX : event.clientY) - origin);
    const finish = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('lostpointercapture', finish);
      saveWorkbench();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
  handle.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[event.key];
    if (
      !delta ||
      (axis === 'x'
        ? !['ArrowLeft', 'ArrowRight'].includes(event.key)
        : !['ArrowUp', 'ArrowDown'].includes(event.key))
    )
      return;
    event.preventDefault();
    change(read(), delta);
    saveWorkbench();
  });
}

export function renderWorkbench(nextHtml, attachNextEvents, clearPromptTimers) {
  const panel = shellState.panel;
  const moved = shellState.root.dataset.dockMoved === 'true';
  delete shellState.root.dataset.dockMoved;
  if (IS_POPOUT || !moved) rememberWorkbenchReading(panel);
  const source = IS_POPOUT ? shellState.remoteSource : exportPanelState();
  const token = source?.viewToken || '';
  if (!panel.querySelector('.csw-workbench')) {
    shellState.workbenchLayoutCleanup?.();
    panel.innerHTML = `<div class="csw-workbench">
      <header class="csw-head csw-workbench-head"><span class="csw-workbench-source"></span><div class="csw-workbench-controls"></div></header>
      <div class="csw-workbench-panes">
        <section class="csw-workbench-pane" data-pane="outline" aria-label="大纲"><header><strong>大纲</strong><button class="csw-icon" data-refresh="outline" aria-label="刷新大纲">${iconSvg('refresh')}</button></header><div class="csw-body" data-view-body="outline" tabindex="0"></div></section>
        <div class="csw-workbench-split" role="separator" tabindex="0" aria-label="调整大纲与下一步比例" aria-orientation="horizontal" aria-valuemin="20" aria-valuemax="80"></div>
        <section class="csw-workbench-pane" data-pane="next" aria-label="下一步"><header><strong>下一步</strong><button class="csw-icon" data-refresh="next" aria-label="刷新建议">${iconSvg('refresh')}</button></header><div class="csw-body" data-view-body="next" tabindex="0"></div></section>
      </div>
      <section class="csw-workbench-settings" aria-label="工作台设置" hidden></section>
      <div class="csw-workbench-resize" role="separator" tabindex="0" aria-label="调整工作台宽度" aria-orientation="vertical" aria-valuemin="300" aria-valuemax="460"></div>
    </div>`;
    panel.querySelector('[data-refresh="outline"]').addEventListener('click', () => {
      if (outlineEnabled()) void refreshOutline();
    });
    panel.querySelector('[data-refresh="next"]').addEventListener('click', () => {
      if (stepwiseEnabled()) void forceRefreshStepwise();
    });
    const observer = new ResizeObserver(() => {
      const panes = panel.querySelector('.csw-workbench-panes');
      if (panes?.clientHeight) updateSplit();
    });
    observer.observe(panel.querySelector('.csw-workbench-panes'));
    shellState.workbenchLayoutCleanup = () => observer.disconnect();
    bindSeparator(
      panel.querySelector('.csw-workbench-resize'),
      'x',
      () => shellState.dockWidth,
      (width, dx) => {
        shellState.dockWidth = clamp(width - dx, 300, 460);
        emitSignal('render', undefined);
      },
    );
    bindSeparator(
      panel.querySelector('.csw-workbench-split'),
      'y',
      () => shellState.splitRatio,
      (ratio, dy) => {
        const height = splitHeight(panel.querySelector('.csw-workbench-panes'));
        const min = Math.min(0.5, 180 / Math.max(1, height));
        shellState.splitRatio = clamp(
          ratio + dy / Math.max(1, height),
          Math.max(0.2, min),
          Math.min(0.8, 1 - min),
        );
        updateSplit();
      },
    );
  }
  const root = panel.querySelector('.csw-workbench');
  const sourceLabel = panel.querySelector('.csw-workbench-source');
  sourceLabel.textContent = source?.sourceLabel || 'Codex · 等待聊天';
  sourceLabel.title = sourceLabel.textContent;
  const controls = panel.querySelector('.csw-workbench-controls');
  const controlsHtml = `${panelWindowControls()}<button class="csw-icon" data-workbench-settings aria-label="${shellState.workbenchSettings ? '返回工作台' : '设置'}" title="${shellState.workbenchSettings ? '返回工作台' : '设置'}">${iconSvg(shellState.workbenchSettings ? 'outline' : 'settings')}</button>${IS_POPOUT ? '' : '<button class="csw-icon" data-workbench-close aria-label="收起工作台" title="收起工作台">›</button><button class="csw-icon" data-workbench-exit aria-label="切回胶囊" title="切回胶囊">◉</button>'}`;
  if (paneContent.get(controls) !== controlsHtml) {
    controls.innerHTML = controlsHtml;
    paneContent.set(controls, controlsHtml);
    bindPanelWindowControls();
    controls.querySelector('[data-workbench-settings]').addEventListener('click', () => {
      shellState.workbenchSettings = !shellState.workbenchSettings;
      emitSignal('render', undefined);
    });
    controls.querySelector('[data-workbench-close]')?.addEventListener('click', closeWorkbench);
    controls
      .querySelector('[data-workbench-exit]')
      ?.addEventListener('click', () => setWorkbench(false));
    if (IS_POPOUT) installPanelDrag();
  }
  root.querySelector('.csw-workbench-panes').hidden = shellState.workbenchSettings;
  const settings = root.querySelector('.csw-workbench-settings');
  settings.hidden = !shellState.workbenchSettings;
  if (shellState.workbenchSettings) {
    const html = `<div class="csw-body" data-view-body="settings">${settingsHtml()}</div>`;
    if (paneContent.get(settings) !== html) {
      settings.innerHTML = html;
      paneContent.set(settings, html);
      attachSettingsEvents();
    }
  }
  for (const [kind, enabled, html, bind] of [
    ['outline', outlineEnabled(), outlineHtml, attachOutlineEvents],
    ['next', stepwiseEnabled(), nextHtml, attachNextEvents],
  ]) {
    const pane = root.querySelector(`[data-pane="${kind}"]`);
    const body = pane.querySelector('.csw-body');
    pane.querySelector('button').disabled =
      !enabled ||
      (kind === 'outline'
        ? outlineState.outlineStatus === 'pending'
        : stepwiseState.bridgeStatus === 'pending');
    const identity = `${token}:${readingContentToken(kind)}`;
    const changed = body.dataset.identity !== identity;
    const context = source?.context;
    const readingKey = JSON.stringify([
      kind,
      context?.paneKey,
      context?.sessionId,
      context?.assistantMessageId,
      source?.answerHash,
      readingContentToken(kind),
    ]);
    const restored = changed || moved ? workbenchReading(readingKey) : null;
    if (changed && kind === 'next' && !shellState.restoringWorkbench)
      shellState.promptPreviewIndex = restored?.previewIndex || 0;
    const content = enabled ? html() : '<div class="csw-empty">功能已关闭</div>';
    const contentKey =
      kind === 'next'
        ? JSON.stringify([
            enabled,
            identity,
            shellState.labelOnly,
            stepwiseState.bridgeStatus,
            stepwiseState.bridgeError,
            contextState.scanStatus,
            contextState.scanBusy,
            runtimeState.settings?.generationMode,
          ])
        : content;
    const restorePreview =
      kind === 'next' &&
      shellState.restoringWorkbench &&
      body.querySelector('.csw-prompt-preview')?.dataset.previewIndex !==
        String(shellState.promptPreviewIndex);
    if (changed || restorePreview || paneContent.get(body) !== contentKey) {
      const top = changed ? restored?.top || 0 : body.scrollTop;
      const preview = body.querySelector('.csw-prompt-preview-scroll');
      const previewTop = changed ? restored?.previewTop || 0 : preview?.scrollTop || 0;
      if (kind === 'next') clearPromptTimers();
      body.innerHTML = content;
      body.dataset.identity = identity;
      body.dataset.readingKey = readingKey;
      paneContent.set(body, contentKey);
      body.scrollTop = top;
      if (enabled) bind(body);
      const nextPreview = body.querySelector('.csw-prompt-preview-scroll');
      if (nextPreview) nextPreview.scrollTop = previewTop;
    }
    if (moved && restored) {
      body.scrollTop = restored.top;
      const preview = body.querySelector('.csw-prompt-preview-scroll');
      if (preview) preview.scrollTop = restored.previewTop;
    }
  }
  alignOutlineNestedText();
  updateSplit();
  applyMaterial({ animate: false });
  root
    .querySelector('.csw-workbench-resize')
    .setAttribute('aria-valuenow', String(shellState.dockWidth));
}

function splitHeight(panes) {
  const style = getComputedStyle(panes);
  return Math.max(
    360,
    panes.clientHeight - 8 - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
  );
}

function updateSplit() {
  const panes = shellState.panel.querySelector('.csw-workbench-panes');
  if (!panes.clientHeight) return;
  const available = splitHeight(panes);
  const ratio = clamp(shellState.splitRatio, 180 / available, 1 - 180 / available);
  panes.style.gridTemplateRows = `minmax(180px,${ratio}fr) 8px minmax(180px,${1 - ratio}fr)`;
  panes
    .querySelector('[role="separator"]')
    .setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}
