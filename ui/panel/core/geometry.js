/*
 * [INPUT]: 胶囊状态、DOM 尺寸、滚动容器与原生窗口偏好。
 * [OUTPUT]: 内嵌几何、收放及完成后的外壳切换；保留胶囊位置与原生尺寸同步，停靠开合交由通知协调。
 * [POS]: 交互与视图共用的空间计算层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CHIP_HEIGHT,
  CHIP_RADIUS,
  CHIP_WIDTH,
  HORIZONTAL_PHASE,
  IS_POPOUT,
  MAX_MORPH_MS,
  MIN_MORPH_MS,
  MIN_PHASE_MS,
  MIN_REVERSE_MS,
  MORPH_EDGE_SPEED,
  MORPH_FALLBACK_BUFFER_MS,
  PANEL_MIN_HEIGHT,
  PANEL_RADIUS,
  POPOUT,
  POSITION_KEY,
  RIGHT_EDGE_SNAP_DISTANCE,
  SETTINGS_PANEL_HEIGHT,
  UNFOLD_SAMPLES,
} from '../runtime/constants.js';
import { clamp, isCurrentRuntime, runtimeState, shellState } from '../runtime/state.js';
import { clampPanelHeight, clampPanelWidth } from './panel-appearance.js';
import {
  clearCompletionBeam,
  deferRender,
  flushDeferredRender,
  prefersReducedMotion,
} from './shell.js';
import { contentSafeBounds } from '../host/host-appearance.js';
import { emitSignal } from '../runtime/signals.js';
import { panelPreferences, sizeNativePanel } from '../popout/transport.js';
import { resetEyePointer, resetGlassPointer, syncEyeTracking } from './effects.js';

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function axisEase(progress) {
  const value = clamp(progress, 0, 1);
  const eased = 1 - Math.pow(1 - value, 1.25);
  return eased * 0.4 + value * 0.6;
}

function expandMotionU(progress) {
  return clamp(progress, 0, 1);
}

function defaultPosition() {
  if (IS_POPOUT) return { x: Math.max(12, (window.innerWidth - CHIP_WIDTH) / 2), y: 12 };
  const bounds = contentSafeBounds();
  return clampPosition({
    x: bounds.right - CHIP_WIDTH,
    y: Math.min(bounds.bottom - CHIP_HEIGHT, bounds.top + 44),
  });
}

function savedPosition() {
  if (IS_POPOUT) return defaultPosition();
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return clampPosition(parsed);
  } catch {}
  return defaultPosition();
}

function clampPosition(position) {
  const bounds = contentSafeBounds();
  const visibleWidth = Math.min(CHIP_WIDTH, bounds.width);
  const visibleHeight = Math.min(CHIP_HEIGHT, bounds.height);
  const sourceX = Number(position?.x);
  const sourceY = Number(position?.y);
  return {
    x: clamp(
      Number.isFinite(sourceX) ? sourceX : bounds.left,
      bounds.left,
      Math.max(bounds.left, bounds.right - visibleWidth),
    ),
    y: clamp(
      Number.isFinite(sourceY) ? sourceY : bounds.top,
      bounds.top,
      Math.max(bounds.top, bounds.bottom - visibleHeight),
    ),
  };
}

function persistPosition() {
  if (!shellState.position) return;
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(shellState.position));
  } catch {}
}

function setPosition(position, persist = false) {
  shellState.position = clampPosition(position);
  if (persist) persistPosition();
  applyPosition();
}

function dockRightKeepHeight(persist = true) {
  const layout = shellLayout();
  setPosition(
    {
      x: layout.bounds.right - layout.chip.width,
      y: layout.anchor.y,
    },
    persist,
  );
}

function snapRightIfNear(persist = false, animate = false) {
  const layout = shellLayout();
  const visibleRight = shellState.open
    ? layout.left + layout.width
    : layout.anchor.x + layout.chip.width;
  if (layout.bounds.right - visibleRight > RIGHT_EDGE_SNAP_DISTANCE) return false;
  if (animate && shellState.popover && !prefersReducedMotion()) {
    if (shellState.snapTimer) window.clearTimeout(shellState.snapTimer);
    shellState.popover.dataset.snapRight = 'true';
    const timer = window.setTimeout(() => {
      if (shellState.snapTimer !== timer) return;
      shellState.snapTimer = 0;
      shellState.popover?.removeAttribute('data-snap-right');
    }, 220);
    shellState.snapTimer = timer;
  }
  dockRightKeepHeight(persist);
  return true;
}

function shellLayout() {
  const bounds = contentSafeBounds();
  const dockRect =
    !IS_POPOUT && shellState.layoutMode === 'workbench' && shellState.dockStatus === 'open'
      ? shellState.dockRect
      : null;
  const width = dockRect
    ? dockRect.width
    : Math.max(CHIP_WIDTH, Math.min(clampPanelWidth(shellState.width), bounds.width));
  const anchor = clampPosition(shellState.position || defaultPosition());
  const chipWidth = Math.min(CHIP_WIDTH, width);
  const chipHeight = Math.min(CHIP_HEIGHT, bounds.height);
  const minimumPanelHeight = Math.min(PANEL_MIN_HEIGHT, bounds.height);
  const roomBelow = Math.max(chipHeight, bounds.bottom - anchor.y);
  const roomAbove = Math.max(chipHeight, anchor.y + chipHeight - bounds.top);
  const panelDrag = shellState.drag?.source === 'panel' ? shellState.drag : null;
  const resizeDrag = shellState.resizeDrag;
  const opensDown =
    typeof panelDrag?.lockedOpensDown === 'boolean'
      ? panelDrag.lockedOpensDown
      : typeof resizeDrag?.lockedOpensDown === 'boolean'
        ? resizeDrag.lockedOpensDown
        : roomBelow >= minimumPanelHeight || roomBelow >= roomAbove;
  const availableHeight = opensDown ? roomBelow : roomAbove;
  const requestedHeight = Number.isFinite(panelDrag?.panelHeight)
    ? panelDrag.panelHeight
    : !IS_POPOUT && shellState.activeTab === 'settings'
      ? clampPanelHeight(SETTINGS_PANEL_HEIGHT)
      : clampPanelHeight(shellState.height);
  const height = dockRect
    ? dockRect.height
    : Math.max(CHIP_HEIGHT, Math.min(requestedHeight, bounds.height, availableHeight));
  const compressionProgress =
    shellState.activeTab === 'settings'
      ? 0
      : clamp((requestedHeight - height) / Math.max(1, requestedHeight - chipHeight), 0, 1);
  const desiredLeft = anchor.x - (width - chipWidth) / 2;
  const left = dockRect
    ? dockRect.left
    : clamp(desiredLeft, bounds.left, Math.max(bounds.left, bounds.right - width));
  const desiredTop = opensDown ? anchor.y : anchor.y + chipHeight - height;
  const top = dockRect
    ? dockRect.top
    : clamp(desiredTop, bounds.top, Math.max(bounds.top, bounds.bottom - height));
  const chipLeft = clamp(anchor.x - left, 0, Math.max(0, width - chipWidth));
  const chipTop = clamp(anchor.y - top, 0, Math.max(0, height - chipHeight));
  const collapsedShell = {
    left: chipLeft,
    top: chipTop,
    width: chipWidth,
    height: chipHeight,
    radius: CHIP_RADIUS,
  };
  const horizontalShell = {
    left: 0,
    top: chipTop,
    width,
    height: chipHeight,
    radius: CHIP_RADIUS,
  };
  const expandedShell = {
    left: 0,
    top: 0,
    width,
    height,
    radius: PANEL_RADIUS,
  };
  const distX = Math.max(1, expandedShell.width - collapsedShell.width);
  const distY = Math.max(1, expandedShell.height - collapsedShell.height);
  const stageMs = Math.max(
    Math.max(MIN_PHASE_MS, distX / MORPH_EDGE_SPEED),
    Math.max(MIN_PHASE_MS, distY / MORPH_EDGE_SPEED),
  );
  return {
    left,
    top,
    width,
    height,
    requestedHeight,
    availableHeight,
    compressionProgress,
    bounds,
    anchor,
    chip: {
      left: chipLeft,
      top: chipTop,
      width: chipWidth,
      height: chipHeight,
      radius: CHIP_RADIUS,
    },
    collapsedShell,
    horizontalShell,
    expandedShell,
    distX,
    distY,
    opensDown,
    phaseSplit: HORIZONTAL_PHASE,
    morphDurationMs: clamp(Math.round(stageMs * 2), MIN_MORPH_MS, MAX_MORPH_MS),
  };
}

function phaseSplitOf(geometry) {
  const split = Number(geometry?.phaseSplit);
  if (Number.isFinite(split) && split > 0.05 && split < 0.95) return split;
  return HORIZONTAL_PHASE;
}

function cancelMorphAnimations() {
  const transition = shellState.morphTransition;
  if (transition) {
    transition.cancelled = true;
    if (transition.fallbackTimer) window.clearTimeout(transition.fallbackTimer);
  }
  shellState.morphTransition = null;
  shellState.morphGeneration += 1;
  const animations = [
    shellState.morphAnimation,
    shellState.rimMorphAnimation,
    shellState.panelMorphAnimation,
    shellState.fabMorphAnimation,
    ...(transition?.animations || []),
  ];
  [...new Set(animations)].forEach((animation) => animation?.cancel?.());
  shellState.morphAnimation = null;
  shellState.rimMorphAnimation = null;
  shellState.panelMorphAnimation = null;
  shellState.fabMorphAnimation = null;
}

function unfoldAxes(progress, collapsing = false, split = HORIZONTAL_PHASE) {
  const value = clamp(progress, 0, 1);
  const elapsed = collapsing ? 1 - value : value;
  const phase = clamp(split, 0.05, 0.95);
  let x;
  let y;
  if (elapsed <= phase) {
    x = axisEase(phase < 0.001 ? 1 : elapsed / phase);
    y = 0;
  } else {
    x = 1;
    y = axisEase((elapsed - phase) / Math.max(0.001, 1 - phase));
  }
  return collapsing ? { x: 1 - x, y: 1 - y } : { x, y };
}

function unfoldShell(geometry, progress, collapsing = false) {
  const { x, y } = unfoldAxes(progress, collapsing, phaseSplitOf(geometry));
  const collapsed = geometry.collapsedShell;
  const expanded = geometry.expandedShell;
  return {
    left: lerp(collapsed.left, expanded.left, x),
    top: lerp(collapsed.top, expanded.top, y),
    width: lerp(collapsed.width, expanded.width, x),
    height: lerp(collapsed.height, expanded.height, y),
    radius: lerp(collapsed.radius, expanded.radius, Math.max(x, y)),
  };
}

function morphPathProgress(shell, geometry) {
  const split = phaseSplitOf(geometry);
  const collapsed = geometry.collapsedShell;
  const expanded = geometry.expandedShell;
  const widthProgress = clamp(
    (shell.width - collapsed.width) / Math.max(1, expanded.width - collapsed.width),
    0,
    1,
  );
  const heightProgress = clamp(
    (shell.height - collapsed.height) / Math.max(1, expanded.height - collapsed.height),
    0,
    1,
  );
  if (heightProgress > 0.002 || widthProgress >= 0.998) {
    return split + heightProgress * (1 - split);
  }
  return widthProgress * split;
}

function readGlassGeometry(geometry) {
  const fallback = unfoldShell(geometry, shellState.open ? 1 : 0);
  if (!shellState.glass) return fallback;
  const computed = getComputedStyle(shellState.glass);
  const number = (value, fallbackValue) => {
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  };
  return {
    left: number(computed.left, fallback.left),
    top: number(computed.top, fallback.top),
    width: Math.max(1, number(computed.width, fallback.width)),
    height: Math.max(1, number(computed.height, fallback.height)),
    radius: Math.max(0, number(computed.borderTopLeftRadius, fallback.radius)),
  };
}

function morphPx(value) {
  return `${Number(value.toFixed(3))}px`;
}

function glassFrame(shell, offset) {
  return {
    left: morphPx(shell.left),
    top: morphPx(shell.top),
    width: morphPx(shell.width),
    height: morphPx(shell.height),
    borderRadius: morphPx(shell.radius),
    offset: Number(offset.toFixed(4)),
  };
}

function panelClipPath(shell, geometry) {
  const top = Math.max(0, shell.top);
  const right = Math.max(0, geometry.width - shell.left - shell.width);
  const bottom = Math.max(0, geometry.height - shell.top - shell.height);
  const left = Math.max(0, shell.left);
  return `inset(${morphPx(top)} ${morphPx(right)} ${morphPx(bottom)} ${morphPx(left)} round ${morphPx(shell.radius)})`;
}

function panelFrame(shell, geometry, offset) {
  return {
    clipPath: panelClipPath(shell, geometry),
    offset: Number(offset.toFixed(4)),
  };
}

function fabFrame(shell, offset) {
  const headerHeight = Math.min(CHIP_HEIGHT + 8, shell.height);
  return {
    left: morphPx(shell.left + (shell.width - CHIP_WIDTH) / 2),
    top: morphPx(shell.top + Math.max(0, (headerHeight - CHIP_HEIGHT) / 2)),
    offset: Number(offset.toFixed(4)),
  };
}

function buildMorphPath(currentShell, expanded, geometry) {
  const startProgress = morphPathProgress(currentShell, geometry);
  const targetProgress = expanded ? 1 : 0;
  const remaining = Math.abs(targetProgress - startProgress);
  const baseDuration = clamp(
    Number(geometry.morphDurationMs) || MIN_MORPH_MS,
    MIN_MORPH_MS,
    MAX_MORPH_MS,
  );
  const duration =
    remaining < 0.002
      ? 0
      : clamp(Math.round(baseDuration * remaining), MIN_REVERSE_MS, MAX_MORPH_MS);
  const samples = [{ shell: currentShell, offset: 0 }];
  const steps = UNFOLD_SAMPLES + 1;
  const progressDelta = targetProgress - startProgress;
  const stageProgress = phaseSplitOf(geometry);
  const stageTimeline =
    Math.abs(progressDelta) < 0.000001 ? -1 : (stageProgress - startProgress) / progressDelta;
  const timelines = [];
  for (let index = 1; index <= steps; index += 1) {
    timelines.push(index / steps);
  }
  if (stageTimeline > 0.000001 && stageTimeline < 0.999999) {
    timelines.push(stageTimeline);
  }
  timelines.sort((left, right) => left - right);
  let previousTimeline = -1;
  for (const timeline of timelines) {
    if (Math.abs(timeline - previousTimeline) < 0.000001) continue;
    const motion = expanded ? expandMotionU(timeline) : timeline;
    const sampledProgress = startProgress + progressDelta * motion;
    const progress =
      Math.abs(timeline - stageTimeline) < 0.000001 ? stageProgress : sampledProgress;
    samples.push({ shell: unfoldShell(geometry, progress, false), offset: timeline });
    previousTimeline = timeline;
  }
  const targetShell = expanded ? geometry.expandedShell : geometry.collapsedShell;
  samples[samples.length - 1] = { shell: targetShell, offset: 1 };
  return {
    duration,
    frames: samples.map(({ shell, offset }) => glassFrame(shell, offset)),
    panelFrames: samples.map(({ shell, offset }) => panelFrame(shell, geometry, offset)),
    fabFrames: samples.map(({ shell, offset }) => fabFrame(shell, offset)),
    startProgress,
    targetProgress,
    targetShell,
  };
}

function applyMorphShell(shell, geometry) {
  [shellState.glass, shellState.rim, shellState.completionBeam].forEach((surface) => {
    if (!surface) return;
    surface.style.left = `${shell.left}px`;
    surface.style.top = `${shell.top}px`;
    surface.style.width = `${shell.width}px`;
    surface.style.height = `${shell.height}px`;
    surface.style.borderRadius = `${shell.radius}px`;
  });
  if (shellState.panel) {
    shellState.panel.style.clipPath = panelClipPath(shell, geometry);
  }
  if (shellState.fab) {
    const frame = fabFrame(shell, 0);
    shellState.fab.style.left = frame.left;
    shellState.fab.style.top = frame.top;
  }
}

function applyMorphProgress(progress) {
  if (!shellState.glass && !shellState.rim && !shellState.panel && !shellState.fab) return;
  const geometry = shellState.layout || shellLayout();
  const shell = unfoldShell(geometry, progress, false);
  applyMorphShell(shell, geometry);
}

function settleMorph(progress, focusTarget = '') {
  if (!isCurrentRuntime()) return;
  cancelMorphAnimations();
  resetEyePointer();
  const expanded = IS_POPOUT || progress >= 0.999;
  shellState.open = expanded;
  shellState.popover.dataset.open = String(expanded);
  shellState.popover.dataset.morphing = 'false';
  shellState.panel.inert = !expanded;
  shellState.panel.setAttribute('aria-hidden', String(!expanded));
  shellState.fab.setAttribute('aria-expanded', String(expanded));
  if (!expanded) {
    shellState.fab.title = '展开胶囊';
    shellState.fab.setAttribute('aria-label', '展开胶囊');
  }
  applyMorphProgress(expanded ? 1 : 0);
  resetGlassPointer();
  const runtimeGeneration = runtimeState.runtimeGeneration;
  if (focusTarget === 'panel' && expanded) {
    window.requestAnimationFrame(() => {
      if (isCurrentRuntime(runtimeGeneration)) {
        shellState.panel
          ?.querySelector(".csw-workbench-face, [data-action='collapse']")
          ?.focus({ preventScroll: true });
      }
    });
  }
  if (focusTarget === 'chip' && !expanded) {
    window.requestAnimationFrame(() => {
      if (isCurrentRuntime(runtimeGeneration)) shellState.fab?.focus({ preventScroll: true });
    });
  }
  if (!flushDeferredRender()) syncEyeTracking();
  if (IS_POPOUT) {
    void sizeNativePanel(expanded);
    POPOUT.save(panelPreferences());
  }
}

function startMorph(expanded, focusTarget = '') {
  if (IS_POPOUT) {
    settleMorph(1);
    return;
  }
  if (
    !shellState.glass ||
    !shellState.rim ||
    !shellState.fab ||
    !shellState.panel ||
    !shellState.popover
  )
    return;
  resetEyePointer();
  const geometry = shellState.layout || shellLayout();
  const currentShell = readGlassGeometry(geometry);
  cancelMorphAnimations();
  shellState.open = expanded;
  shellState.focusAfterMorph = focusTarget;
  shellState.popover.dataset.open = String(expanded);
  shellState.popover.dataset.morphing = 'true';
  resetGlassPointer();
  shellState.panel.inert = true;
  shellState.panel.setAttribute('aria-hidden', 'true');
  shellState.fab.setAttribute('aria-expanded', String(expanded));
  const path = buildMorphPath(currentShell, expanded, geometry);
  applyMorphShell(currentShell, geometry);

  if (prefersReducedMotion() || path.duration === 0) {
    settleMorph(path.targetProgress, focusTarget);
    return;
  }

  const generation = shellState.morphGeneration;
  const runtimeGeneration = runtimeState.runtimeGeneration;
  const timing = {
    duration: path.duration,
    easing: 'cubic-bezier(.2, .72, .2, 1)',
    fill: 'forwards',
  };
  const animation = shellState.glass.animate(path.frames, timing);
  shellState.rimMorphAnimation = shellState.rim.animate(path.frames, timing);
  shellState.panelMorphAnimation = shellState.panel.animate(path.panelFrames, timing);
  shellState.fabMorphAnimation = shellState.fab.animate(path.fabFrames, timing);
  shellState.morphAnimation = animation;
  const animations = [
    animation,
    shellState.rimMorphAnimation,
    shellState.panelMorphAnimation,
    shellState.fabMorphAnimation,
  ].filter(Boolean);
  let settled = false;
  const transition = {
    animations,
    cancelled: false,
    fallbackTimer: 0,
    finish: () => {
      if (transition.cancelled || settled) return;
      settled = true;
      if (transition.fallbackTimer) window.clearTimeout(transition.fallbackTimer);
      if (shellState.morphTransition === transition) shellState.morphTransition = null;
      if (!isCurrentRuntime(runtimeGeneration) || generation !== shellState.morphGeneration) return;
      settleMorph(path.targetProgress, focusTarget);
    },
  };
  shellState.morphTransition = transition;
  transition.fallbackTimer = window.setTimeout(() => {
    transition.animations.forEach((item) => {
      if (item.playState !== 'finished') item.cancel();
    });
    transition.finish();
  }, path.duration + MORPH_FALLBACK_BUFFER_MS);
  void Promise.all(transition.animations.map((item) => item.finished.catch(() => null))).then(() =>
    transition.finish(),
  );
}

function setOpen(expanded, focusTarget = '') {
  if (!isCurrentRuntime()) return;
  resetEyePointer();
  if (
    !IS_POPOUT &&
    shellState.layoutMode === 'workbench' &&
    shellState.dockStatus !== 'unsupported'
  ) {
    emitSignal('workbenchToggle', Boolean(expanded));
    return;
  }
  // 停靠不可用时，显式展开紧凑入口改用浮动工作台，不再反复尝试占位。
  if (expanded && shellState.layoutMode === 'workbench' && shellState.dockStatus === 'unsupported')
    shellState.layoutMode = 'capsule';
  const target = IS_POPOUT || Boolean(expanded);
  if (target === shellState.open) return;
  clearCompletionBeam();
  if (IS_POPOUT) {
    settleMorph(1);
    return;
  }
  emitSignal('render', { preserveMorph: true });
  deferRender();
  startMorph(target, focusTarget);
}

function panelDragPosition(drag, dx, dy) {
  const geometry = drag.originLayout;
  const bounds = contentSafeBounds();
  const maxLeft = Math.max(bounds.left, bounds.right - geometry.width);
  const maxTop = Math.max(bounds.top, bounds.bottom - geometry.height);
  const left = clamp(drag.originPanelLeft + dx, bounds.left, maxLeft);
  const top = clamp(drag.originPanelTop + dy, bounds.top, maxTop);
  return {
    x: left + (geometry.width - geometry.chip.width) / 2,
    y: drag.lockedOpensDown ? top : top + geometry.height - geometry.chip.height,
  };
}

function applyPosition() {
  if (!shellState.popover || !shellState.fab || !shellState.position) return;
  shellState.position = clampPosition(shellState.position);
  shellState.layout = shellLayout();
  shellState.popover.style.left = `${shellState.layout.left}px`;
  shellState.popover.style.top = `${shellState.layout.top}px`;
  shellState.popover.style.width = `${shellState.layout.width}px`;
  shellState.popover.style.height = `${shellState.layout.height}px`;
  shellState.root.style.setProperty('--csw-panel-width', `${shellState.layout.width}px`);
  shellState.root.style.setProperty('--csw-panel-height', `${shellState.layout.height}px`);
  shellState.popover.style.setProperty('--csw-chip-left', `${shellState.layout.chip.left}px`);
  const compressionProgress = shellState.layout.compressionProgress || 0;
  const compressed = shellState.activeTab !== 'settings' && compressionProgress > 0.001;
  shellState.popover.dataset.compressed = String(compressed);
  shellState.popover.style.setProperty(
    '--csw-content-fade-size',
    `${compressed ? Math.min(48, 14 + compressionProgress * 34) : 0}px`,
  );
  syncContentFade();
  shellState.fab.style.left = `${shellState.layout.chip.left}px`;
  shellState.fab.style.top = `${shellState.layout.chip.top}px`;
  if (!shellState.morphAnimation) applyMorphProgress(shellState.open ? 1 : 0);
}

function viewScrollTargets(body = shellState.panel?.querySelector('.csw-body[data-view-body]')) {
  if (!body) return [];
  const targets = [body];
  const previewScroll = body.querySelector('.csw-prompt-preview-scroll');
  if (previewScroll) targets.push(previewScroll);
  return targets;
}

function captureViewScroll() {
  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  if (!body || body.dataset.viewBody !== shellState.activeTab) return null;
  const preview = body.querySelector('.csw-prompt-preview');
  const previewScroll = preview?.querySelector('.csw-prompt-preview-scroll');
  return {
    view: shellState.activeTab,
    top: body.scrollTop,
    preview:
      preview && previewScroll
        ? {
            index: preview.dataset.previewIndex || '',
            prompt: preview.querySelector('.csw-prompt-preview-body')?.textContent || '',
            top: previewScroll.scrollTop,
          }
        : null,
  };
}

function restoreViewScroll(snapshot) {
  if (!snapshot || snapshot.view !== shellState.activeTab) return;
  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  if (!body || body.dataset.viewBody !== snapshot.view) return;
  const maxTop = Math.max(0, body.scrollHeight - body.clientHeight);
  body.scrollTop = clamp(snapshot.top, 0, maxTop);

  const preview = body.querySelector('.csw-prompt-preview');
  const previewScroll = preview?.querySelector('.csw-prompt-preview-scroll');
  if (!snapshot.preview || !preview || !previewScroll) return;
  const prompt = preview.querySelector('.csw-prompt-preview-body')?.textContent || '';
  if (preview.dataset.previewIndex !== snapshot.preview.index || prompt !== snapshot.preview.prompt)
    return;
  const previewMaxTop = Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
  previewScroll.scrollTop = clamp(snapshot.preview.top, 0, previewMaxTop);
}

function syncContentFade() {
  const popover = shellState.popover;
  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  if (!popover || !body) return;

  const preview = body.querySelector('.csw-prompt-preview');
  const previewScroll = preview?.querySelector('.csw-prompt-preview-scroll');
  if (preview && previewScroll) {
    const previewMaxTop = Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
    const previewOverflowing = previewMaxTop > 2;
    const previewAtEnd = !previewOverflowing || previewScroll.scrollTop >= previewMaxTop - 2;
    preview.dataset.scrollOverflow = String(previewOverflowing);
    preview.dataset.scrollAtEnd = String(previewAtEnd);
    preview.dataset.scrollFade = String(previewOverflowing && !previewAtEnd);
  }

  const view = body.dataset.viewBody || '';
  const compressed = popover.dataset.compressed === 'true';
  const eligible = compressed && (view === 'next' || view === 'outline');
  const scrollStates = viewScrollTargets(body).map((target) => ({
    target,
    maxTop: Math.max(0, target.scrollHeight - target.clientHeight),
  }));
  const overflowing = eligible && scrollStates.some(({ maxTop }) => maxTop > 2);
  const atEnd =
    !overflowing ||
    scrollStates.every(({ target, maxTop }) => maxTop <= 2 || target.scrollTop >= maxTop - 2);

  popover.dataset.contentOverflow = String(overflowing);
  popover.dataset.contentAtEnd = String(atEnd);
  popover.dataset.contentFade = String(overflowing && !atEnd);
}

function installContentFadeTracking() {
  shellState.contentFadeCleanup?.();
  shellState.contentFadeCleanup = null;

  const body = shellState.panel?.querySelector('.csw-body[data-view-body]');
  const targets = viewScrollTargets(body);
  if (!body || !targets.length) return;

  const onScroll = () => syncContentFade();
  targets.forEach((target) => target.addEventListener('scroll', onScroll, { passive: true }));

  const resizeObserver =
    typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(onScroll) : null;
  const resizeTargets = new Set();
  targets.forEach((target) => {
    resizeTargets.add(target);
    if (target.firstElementChild) resizeTargets.add(target.firstElementChild);
  });
  resizeTargets.forEach((target) => resizeObserver?.observe(target));

  shellState.contentFadeCleanup = () => {
    targets.forEach((target) => target.removeEventListener('scroll', onScroll));
    resizeObserver?.disconnect();
  };

  syncContentFade();
  window.requestAnimationFrame(() => {
    if (body.isConnected && shellState.panel?.contains(body)) syncContentFade();
  });
}

export {
  applyPosition,
  cancelMorphAnimations,
  captureViewScroll,
  clampPosition,
  defaultPosition,
  dockRightKeepHeight,
  installContentFadeTracking,
  panelDragPosition,
  persistPosition,
  restoreViewScroll,
  savedPosition,
  setOpen,
  setPosition,
  settleMorph,
  shellLayout,
  snapRightIfNear,
  startMorph,
  syncContentFade,
};
