/*
 * [INPUT]: 胶囊 DOM 与外观、指针状态。
 * [OUTPUT]: 视线跟踪和指针高光效果。
 * [POS]: 外壳效果底层，不依赖视图、业务或几何控制。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CURIOUS_EYE_MAX_X,
  CURIOUS_EYE_MAX_Y,
  EYE_MAX_X,
  EYE_MAX_Y,
} from '../runtime/constants.js';
import { clamp, isCurrentRuntime, runtimeState, shellState } from '../runtime/state.js';

function eyeTrackingActive() {
  return (
    shellState.fabExpression === 'answering' &&
    !shellState.open &&
    !shellState.morphAnimation &&
    !shellState.drag &&
    shellState.root?.dataset.hidden !== 'true'
  );
}

function curiousEyeTrackingActive() {
  return (
    shellState.activeTab === 'settings' &&
    shellState.open &&
    !shellState.morphAnimation &&
    !shellState.drag &&
    shellState.root?.dataset.hidden !== 'true'
  );
}

function eyeTrackingNeeded() {
  return eyeTrackingActive() || curiousEyeTrackingActive();
}

function applyEyeOffset(x = 0, y = 0) {
  shellState.root?.style.setProperty('--csw-eye-x', `${x.toFixed(2)}px`);
  shellState.root?.style.setProperty('--csw-eye-y', `${y.toFixed(2)}px`);
}

function applyCuriousEyeOffset(x = 0, y = 0) {
  shellState.root?.style.setProperty('--csw-curious-eye-x', `${x.toFixed(2)}px`);
  shellState.root?.style.setProperty('--csw-curious-eye-y', `${y.toFixed(2)}px`);
}

function pointerInsideRect(pointer, rect) {
  return (
    pointer.x >= rect.left &&
    pointer.x <= rect.right &&
    pointer.y >= rect.top &&
    pointer.y <= rect.bottom
  );
}

function eyeOffset(pointer, rect, maxX, maxY, reachDistance) {
  const dx = pointer.x - (rect.left + rect.width / 2);
  const dy = pointer.y - (rect.top + rect.height / 2);
  const distance = Math.hypot(dx, dy);
  const reach = clamp(distance / reachDistance, 0, 1);
  const angle = Math.atan2(dy, dx);
  return {
    x: Math.cos(angle) * maxX * reach,
    y: Math.sin(angle) * maxY * reach,
  };
}

function flushEyePointer(generation = runtimeState.runtimeGeneration) {
  if (!isCurrentRuntime(generation)) return;
  shellState.eyeRaf = 0;
  if (!shellState.eyePointer || !eyeTrackingNeeded()) {
    applyEyeOffset();
    applyCuriousEyeOffset();
    return;
  }

  if (eyeTrackingActive() && shellState.fab) {
    const rect = shellState.fab.getBoundingClientRect();
    if (rect.width && rect.height) {
      const offset = eyeOffset(shellState.eyePointer, rect, EYE_MAX_X, EYE_MAX_Y, 220);
      applyEyeOffset(offset.x, offset.y);
    } else {
      applyEyeOffset();
    }
  } else {
    applyEyeOffset();
  }

  if (!curiousEyeTrackingActive()) {
    applyCuriousEyeOffset();
    return;
  }
  const surface = shellState.panel?.querySelector('.csw-mouth-stage[data-mouth-stage="settings"]');
  const face = shellState.panel?.querySelector('.csw-head-face[data-expression="curious"]');
  const surfaceRect = surface?.getBoundingClientRect();
  const faceRect = face?.getBoundingClientRect();
  if (
    !surfaceRect?.width ||
    !surfaceRect.height ||
    !faceRect?.width ||
    !faceRect.height ||
    !pointerInsideRect(shellState.eyePointer, surfaceRect)
  ) {
    applyCuriousEyeOffset();
    return;
  }
  const offset = eyeOffset(
    shellState.eyePointer,
    faceRect,
    CURIOUS_EYE_MAX_X,
    CURIOUS_EYE_MAX_Y,
    Math.max(120, surfaceRect.height),
  );
  applyCuriousEyeOffset(offset.x, offset.y);
}

function scheduleEyePointer() {
  if (!isCurrentRuntime() || shellState.eyeRaf) return;
  const generation = runtimeState.runtimeGeneration;
  shellState.eyeRaf = window.requestAnimationFrame(() => flushEyePointer(generation));
}

function resetEyePointer(clearPointer = false) {
  if (shellState.eyeRaf) window.cancelAnimationFrame(shellState.eyeRaf);
  shellState.eyeRaf = 0;
  if (clearPointer) shellState.eyePointer = null;
  applyEyeOffset();
  applyCuriousEyeOffset();
}

function syncEyeTracking() {
  if (!isCurrentRuntime()) return;
  if (!eyeTrackingNeeded()) {
    resetEyePointer();
    return;
  }
  scheduleEyePointer();
}

function installEyeTracking() {
  if (shellState.eyeCleanup) return;
  const onPointerMove = (event) => {
    shellState.eyePointer = { x: event.clientX, y: event.clientY };
    if (eyeTrackingNeeded()) scheduleEyePointer();
  };
  const onPointerLeave = () => resetEyePointer(true);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('blur', onPointerLeave);
  document.addEventListener('mouseleave', onPointerLeave);
  shellState.eyeCleanup = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('blur', onPointerLeave);
    document.removeEventListener('mouseleave', onPointerLeave);
    resetEyePointer(true);
    shellState.eyeCleanup = null;
  };
}

function bindGlassPointerSurface(surface) {
  if (!(surface instanceof Element)) return;
  surface.addEventListener('pointerenter', onShellPointerMove);
  surface.addEventListener('pointermove', onShellPointerMove);
  surface.addEventListener('pointerleave', onShellPointerLeave);
  surface.addEventListener('pointercancel', resetGlassPointer);
}

function onShellPointerMove(event) {
  if (!shellState.glass || !shellState.popover) return;
  const expanded = shellState.open || shellState.popover.dataset.open === 'true';
  const surface = event.currentTarget;
  const validSurface = expanded
    ? surface instanceof Element && surface.matches('.csw-head-face')
    : surface === shellState.fab;
  if (!validSurface || !(surface instanceof Element)) {
    resetGlassPointer();
    return;
  }
  const surfaceRect = surface.getBoundingClientRect();
  if (!surfaceRect.width || !surfaceRect.height) return;
  const rect = shellState.glass.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  shellState.popover.toggleAttribute('data-csw-hot-hover', true);
  const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
  const angle =
    (Math.atan2(
      event.clientY - rect.top - rect.height / 2,
      event.clientX - rect.left - rect.width / 2,
    ) *
      180) /
    Math.PI;
  const normalizedX = (event.clientX - surfaceRect.left) / surfaceRect.width - 0.5;
  const normalizedY = (event.clientY - surfaceRect.top) / surfaceRect.height - 0.5;
  const proximity = 1 - clamp(Math.hypot(normalizedX, normalizedY) / 0.72, 0, 1);
  const strength = expanded ? 0.1 + proximity * 0.12 : 0.62 + proximity * 0.38;
  const parallaxX = expanded ? 1.6 : 1.8;
  const parallaxY = expanded ? 1.2 : 1.4;
  shellState.popover.style.setProperty('--csw-glass-x', `${x.toFixed(2)}%`);
  shellState.popover.style.setProperty('--csw-glass-y', `${y.toFixed(2)}%`);
  shellState.popover.style.setProperty(
    '--csw-glass-px',
    `${(normalizedX * parallaxX).toFixed(2)}px`,
  );
  shellState.popover.style.setProperty(
    '--csw-glass-py',
    `${(normalizedY * parallaxY).toFixed(2)}px`,
  );
  shellState.popover.style.setProperty('--csw-glass-strength', strength.toFixed(3));
  shellState.popover.style.setProperty('--csw-glass-angle', `${angle.toFixed(2)}deg`);
}

function onShellPointerLeave() {
  resetGlassPointer();
}

function resetGlassPointer() {
  const expanded = shellState.open || shellState.popover?.dataset.open === 'true';
  shellState.popover?.removeAttribute('data-csw-hot-hover');
  shellState.popover?.style.setProperty('--csw-glass-x', '28%');
  shellState.popover?.style.setProperty('--csw-glass-y', expanded ? '16%' : '22%');
  shellState.popover?.style.setProperty('--csw-glass-px', '0px');
  shellState.popover?.style.setProperty('--csw-glass-py', '0px');
  shellState.popover?.style.setProperty('--csw-glass-strength', '0');
  shellState.popover?.style.setProperty('--csw-glass-angle', '-40deg');
}

export {
  bindGlassPointerSurface,
  installEyeTracking,
  resetEyePointer,
  resetGlassPointer,
  syncEyeTracking,
};
