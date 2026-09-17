/*
 * [INPUT]: 共享大纲与 Stepwise 视图、当前聊天身份、工作台布局偏好。
 * [OUTPUT]: 内置视图注册、双面板增量渲染、自动/双轴分栏、布局菜单、独立滚动与键盘分隔线。
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

import {
  normalizeWorkbenchLayout,
  resolveWorkbenchLayout,
  activeWorkbenchPanels,
} from './model.js';

const paneContent = new WeakMap();
const layoutKey = IS_POPOUT ? 'popoutLayout' : 'dockLayout';
const layoutPreference = () => shellState[layoutKey];
const layoutMenu = `<details class="csw-layout-menu"><summary class="csw-icon" role="button" aria-label="布局" title="布局"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/></svg></summary><div class="csw-layout-options" role="group" aria-label="工作台布局">
  <button data-layout-mode="auto">自动</button><button data-layout-mode="vertical">上下</button><button data-layout-mode="horizontal">左右</button>
  <span class="csw-layout-hint" hidden>空间不足，暂以上下排列</span>
  <button data-layout-action="swap">交换位置</button><button data-layout-action="reset">恢复默认布局</button>
</div></details>`;

function changeLayout(action) {
  const preference = layoutPreference();
  if (action === 'reset') shellState[layoutKey] = normalizeWorkbenchLayout(null);
  else if (action === 'swap') {
    preference.first = preference.first === 'outline' ? 'next' : 'outline';
    preference.verticalRatio = 1 - preference.verticalRatio;
    preference.horizontalRatio = 1 - preference.horizontalRatio;
  } else preference.mode = action;
  shellState.splitRatio = shellState.dockLayout.verticalRatio;
  updateSplit();
  saveWorkbench();
}

// 视图注册只组合已有业务入口；排列或挂载不会启用功能或请求生成。
function registeredPanels(nextHtml, attachNextEvents) {
  const views = {
    outline: {
      enabled: outlineEnabled,
      html: outlineHtml,
      bind: attachOutlineEvents,
      refresh: refreshOutline,
    },
    next: {
      enabled: stepwiseEnabled,
      html: nextHtml,
      bind: attachNextEvents,
      refresh: forceRefreshStepwise,
    },
  };
  return activeWorkbenchPanels().map((pane) => ({ ...pane, ...views[pane.id] }));
}

function bindSeparator(handle, axis, read, change) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const direction = typeof axis === 'function' ? axis() : axis;
    const origin = direction === 'x' ? event.clientX : event.clientY;
    const value = read();
    const move = (event) =>
      change(value, (direction === 'x' ? event.clientX : event.clientY) - origin);
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
    const direction = typeof axis === 'function' ? axis() : axis;
    const delta = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[event.key];
    if (
      !delta ||
      (direction === 'x'
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
  const registry = registeredPanels(nextHtml, attachNextEvents);
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
        ${registry.map((pane, index) => `${index ? '<div class="csw-workbench-split" role="separator" tabindex="0" aria-label="调整大纲与下一步比例" aria-orientation="horizontal" aria-valuemin="20" aria-valuemax="80"></div>' : ''}<section class="csw-workbench-pane" data-pane="${pane.id}" aria-label="${pane.title}"><header><strong>${pane.title}</strong><button class="csw-icon" data-refresh="${pane.id}" aria-label="${pane.id === 'outline' ? '刷新大纲' : '刷新建议'}">${iconSvg('refresh')}</button></header><div class="csw-body" data-view-body="${pane.id}" tabindex="0"></div></section>`).join('')}
      </div>
      <section class="csw-workbench-settings" aria-label="工作台设置" hidden></section>
      <div class="csw-workbench-resize" role="separator" tabindex="0" aria-label="调整工作台宽度" aria-orientation="vertical" aria-valuemin="300" aria-valuemax="460"></div>
    </div>`;
    for (const pane of registry) {
      panel.querySelector(`[data-refresh="${pane.id}"]`).addEventListener('click', () => {
        if (pane.enabled()) void pane.refresh();
      });
    }
    const observer = new ResizeObserver(() => {
      const panes = panel.querySelector('.csw-workbench-panes');
      if (panes?.clientHeight) updateSplit();
    });
    observer.observe(panel.querySelector('.csw-workbench-panes'));
    const events = new AbortController();
    document.addEventListener(
      'pointerdown',
      (event) => {
        const menu = panel.querySelector('.csw-layout-menu');
        if (menu && !menu.contains(event.target)) menu.removeAttribute('open');
      },
      { signal: events.signal },
    );
    panel.addEventListener(
      'keydown',
      (event) => {
        const menu = panel.querySelector('.csw-layout-menu[open]');
        if (event.key === 'Escape' && menu) {
          event.stopPropagation();
          menu.removeAttribute('open');
          menu.querySelector('summary').focus();
        }
      },
      { signal: events.signal },
    );
    shellState.workbenchLayoutCleanup = () => {
      observer.disconnect();
      events.abort();
    };
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
      () => (panel.querySelector('.csw-workbench-panes').dataset.axis === 'horizontal' ? 'x' : 'y'),
      () => {
        const split = currentSplit();
        return { axis: split.axis, ratio: split.ratio, available: split.available };
      },
      (start, delta) => {
        const split = currentSplit();
        if (start.axis !== split.axis) return;
        layoutPreference()[`${split.axis}Ratio`] = clamp(
          start.ratio + delta / start.available,
          Math.max(0.2, split.minimum),
          Math.min(0.8, split.maximum),
        );
        shellState.splitRatio = shellState.dockLayout.verticalRatio;
        updateSplit();
      },
    );
  }
  const root = panel.querySelector('.csw-workbench');
  const sourceLabel = panel.querySelector('.csw-workbench-source');
  sourceLabel.textContent = source?.sourceLabel || 'Codex · 等待聊天';
  sourceLabel.title = sourceLabel.textContent;
  const controls = panel.querySelector('.csw-workbench-controls');
  const controlsHtml = `${layoutMenu}${panelWindowControls()}<button class="csw-icon" data-workbench-settings aria-label="${shellState.workbenchSettings ? '返回工作台' : '设置'}" title="${shellState.workbenchSettings ? '返回工作台' : '设置'}">${iconSvg(shellState.workbenchSettings ? 'outline' : 'settings')}</button>${IS_POPOUT ? '' : '<button class="csw-icon" data-workbench-close aria-label="收起工作台" title="收起工作台">›</button><button class="csw-icon" data-workbench-exit aria-label="切回胶囊" title="切回胶囊">◉</button>'}`;
  if (paneContent.get(controls) !== controlsHtml) {
    controls.innerHTML = controlsHtml;
    paneContent.set(controls, controlsHtml);
    bindPanelWindowControls();
    controls.querySelectorAll('[data-layout-mode], [data-layout-action]').forEach((button) => {
      button.addEventListener('click', () =>
        changeLayout(button.dataset.layoutMode || button.dataset.layoutAction),
      );
    });
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
  for (const entry of registry) {
    const { id: kind, html, bind } = entry;
    const enabled = entry.enabled();
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

function currentSplit() {
  const panes = shellState.panel.querySelector('.csw-workbench-panes');
  const style = getComputedStyle(panes);
  return resolveWorkbenchLayout(
    layoutPreference(),
    panes.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    panes.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    panes.dataset.axis,
  );
}

function updateSplit() {
  const panes = shellState.panel.querySelector('.csw-workbench-panes');
  const preference = layoutPreference();
  shellState.panel.querySelectorAll('[data-layout-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.layoutMode === preference.mode));
  });
  if (!panes?.clientHeight) return;
  const split = currentSplit();
  const { axis, ratio } = split;
  const bodies = [...panes.querySelectorAll('.csw-body, .csw-prompt-preview-scroll')].map(
    (node) => [node, node.scrollTop],
  );
  const handle = panes.querySelector('[role="separator"]');
  const first = panes.querySelector(`[data-pane="${split.children[0].id}"]`);
  if (panes.firstElementChild !== first) {
    const focused = document.activeElement;
    panes.insertBefore(first, handle);
    panes.append(panes.querySelector(`[data-pane="${split.children[1].id}"]`));
    if (focused instanceof HTMLElement && panes.contains(focused))
      focused.focus({ preventScroll: true });
  }
  panes.dataset.axis = axis;
  const tracks = `minmax(${split.minSizes[0]}px,${ratio}fr) 8px minmax(${split.minSizes[1]}px,${1 - ratio}fr)`;
  panes.style.gridTemplateRows = axis === 'vertical' ? tracks : 'minmax(0,1fr)';
  panes.style.gridTemplateColumns = axis === 'horizontal' ? tracks : 'minmax(0,1fr)';
  for (const [node, top] of bodies) node.scrollTop = top;
  handle.setAttribute('aria-orientation', axis === 'horizontal' ? 'vertical' : 'horizontal');
  handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  handle.setAttribute('aria-valuemin', String(Math.ceil(Math.max(0.2, split.minimum) * 100)));
  handle.setAttribute('aria-valuemax', String(Math.floor(Math.min(0.8, split.maximum) * 100)));
  handle.setAttribute(
    'aria-valuetext',
    `${first.getAttribute('aria-label')} ${Math.round(ratio * 100)}%`,
  );
  const hint = shellState.panel.querySelector('.csw-layout-hint');
  if (hint) hint.hidden = preference.mode !== 'horizontal' || axis === 'horizontal';
}
