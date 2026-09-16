/*
 * [INPUT]: 胶囊 DOM、几何、外观与指针/键盘事件。
 * [OUTPUT]: 表情 100ms 单击/外层双击识别和首击前形态记忆、拖拽、固定对角缩放、排序和快捷键处理；仅内嵌可收起，原生视口变化保存展开尺寸。
 * [POS]: 外壳交互层；效果在 effects，原生手势经 popout/transport 转发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  HEIGHT_KEY,
  IS_POPOUT,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  POPOUT,
  WIDTH_KEY,
} from '../runtime/constants.js';
import {
  applyPosition,
  cancelMorphAnimations,
  clampPosition,
  defaultPosition,
  panelDragPosition,
  persistPosition,
  setOpen,
  setPosition,
  settleMorph,
  shellLayout,
  snapRightIfNear,
  startMorph,
  syncContentFade,
} from './geometry.js';
import { bumpFontSize, clampPanelHeight, clampPanelWidth } from './panel-appearance.js';
import { emitSignal } from '../runtime/signals.js';
import { nativePanelDrag, panelPreferences } from '../popout/transport.js';
import {
  isCurrentRuntime,
  runtimeState,
  outlineEnabled,
  persistViewOrder,
  shellState,
  storage,
} from '../runtime/state.js';
import { refreshOutline } from '../outline.js';
import { resetEyePointer, syncEyeTracking } from './effects.js';
import { syncViewTabSelection } from './shell.js';

function onResize() {
  if (!shellState.position) return;
  if (IS_POPOUT) {
    if (shellState.open && !shellState.nativeSizeChanging) {
      shellState.width = clampPanelWidth(window.innerWidth - 24);
      shellState.height = clampPanelHeight(window.innerHeight - 24);
      if (shellState.popover?.dataset.resizing !== 'true' && !POPOUT.motionActive?.()) {
        storage.set(WIDTH_KEY, String(shellState.width));
        storage.set(HEIGHT_KEY, String(shellState.height));
        POPOUT.save(panelPreferences());
      }
    }
    shellState.position = defaultPosition();
    if (shellState.open && !shellState.morphAnimation && !shellState.nativeSizeChanging) {
      // 连续缩放只更新几何，避免每帧重置眼睛、收放状态及重复布局。
      applyPosition();
      return;
    }
  }
  const target = shellState.open ? 1 : 0;
  cancelMorphAnimations();
  shellState.position = clampPosition(shellState.position);
  applyPosition();
  settleMorph(target);
  syncContentFade();
}

function onPanelWheel(event) {
  if (!shellState.open || (!event.altKey && !event.metaKey) || event.deltaY === 0) return;
  event.preventDefault();
  event.stopPropagation();
  bumpFontSize(event.deltaY > 0 ? -1 : 1);
}

function onFabPointerDown(event) {
  beginDrag(event, 'fab');
}

function dragTargetBlocked(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest('.csw-head-side')) return true;
  if (target.closest('.csw-head-face')) return false;
  return Boolean(target.closest("button,a,input,textarea,select,[role='button']"));
}

function beginDrag(event, source) {
  if (event.button !== 0 || shellState.morphAnimation || !shellState.position) return;
  if (source === 'fab' && shellState.open) return;
  if (source === 'panel' && (!shellState.open || dragTargetBlocked(event.target))) return;

  if (IS_POPOUT) {
    nativePanelDrag(event, source);
    return;
  }
  shellState.dragCleanup?.();
  const handle = event.currentTarget;
  const originLayout = shellState.layout || shellLayout();
  const drag = {
    pointerId: event.pointerId,
    source,
    startedOnHeadFace:
      source === 'panel' &&
      event.target instanceof Element &&
      Boolean(event.target.closest('.csw-head-face')),
    startX: event.clientX,
    startY: event.clientY,
    originX: shellState.position.x,
    originY: shellState.position.y,
    originLayout,
    originPanelLeft: originLayout.left,
    originPanelTop: originLayout.top,
    lockedOpensDown: source === 'panel' ? originLayout.opensDown : null,
    panelHeight: source === 'panel' ? originLayout.height : null,
    moved: false,
  };
  shellState.drag = drag;
  shellState.suppressFabClick = false;
  shellState.suppressHeadFaceClick = false;
  resetEyePointer();

  const onPointerMove = (moveEvent) => {
    if (shellState.drag !== drag || moveEvent.pointerId !== drag.pointerId) return;
    const dx = moveEvent.clientX - drag.startX;
    const dy = moveEvent.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      cancelFaceClick();
      handle?.setAttribute?.('data-dragging', 'true');
      try {
        handle?.setPointerCapture?.(drag.pointerId);
      } catch {}
    }
    moveEvent.preventDefault();
    const nextPosition =
      source === 'panel'
        ? panelDragPosition(drag, dx, dy)
        : { x: drag.originX + dx, y: drag.originY + dy };
    setPosition(nextPosition);
    snapRightIfNear();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerEnd, true);
    window.removeEventListener('pointercancel', onPointerEnd, true);
    handle?.removeAttribute?.('data-dragging');
    try {
      handle?.releasePointerCapture?.(drag.pointerId);
    } catch {}
    if (shellState.dragCleanup === cleanup) shellState.dragCleanup = null;
  };

  const onPointerEnd = (endEvent) => {
    if (shellState.drag !== drag || endEvent.pointerId !== drag.pointerId) return;
    cleanup();
    if (endEvent.type === 'pointercancel') cancelFaceClick();
    if (!drag.moved) {
      shellState.drag = null;
      return;
    }
    const snapped = snapRightIfNear(true, true);
    shellState.drag = null;
    if (!snapped) persistPosition();
    if (source === 'fab') {
      shellState.suppressFabClick = true;
      window.setTimeout(() => {
        shellState.suppressFabClick = false;
      }, 300);
    } else {
      shellState.suppressHeadFaceClick = true;
      window.setTimeout(() => {
        shellState.suppressHeadFaceClick = false;
      }, 300);
      if (drag.startedOnHeadFace && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    syncEyeTracking();
  };

  shellState.dragCleanup = cleanup;
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onPointerEnd, true);
  window.addEventListener('pointercancel', onPointerEnd, true);
  if (source === 'panel' && !drag.startedOnHeadFace) event.preventDefault();
}

function installPanelDrag() {
  const head = shellState.panel?.querySelector('.csw-head');
  if (head && head.dataset.dragBound !== '1') {
    head.dataset.dragBound = '1';
    head.addEventListener('pointerdown', (event) => beginDrag(event, 'panel'));
  }
}

function installViewTabReorder() {
  shellState.viewReorderCleanup?.();
  shellState.viewReorderCleanup = null;
  const tabs = shellState.panel?.querySelector('.csw-view-tabs');
  const buttons = Array.from(tabs?.querySelectorAll("[data-reorderable='true']") || []);
  if (buttons.length < 2) return;

  let drag = null;
  const clearButtonState = () => {
    buttons.forEach((button) => {
      button.removeAttribute('data-dragging');
      button.style.removeProperty('order');
    });
    tabs.removeAttribute('data-reordering');
  };
  const finish = (commit) => {
    buttons.forEach((button) => button.removeEventListener('pointerdown', onPointerDown));
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerEnd, true);
    window.removeEventListener('pointercancel', onPointerEnd, true);
    const activeDrag = drag;
    drag = null;
    clearButtonState();
    if (!activeDrag) {
      shellState.viewReorderCleanup = null;
      return;
    }
    try {
      activeDrag.button.releasePointerCapture(activeDrag.pointerId);
    } catch {}
    if (activeDrag.moved) shellState.suppressViewTabClickUntil = performance.now() + 320;
    const changed = activeDrag.pendingOrder.join('|') !== shellState.viewOrder.join('|');
    shellState.viewReorderCleanup = null;
    if (commit && activeDrag.moved && changed) {
      persistViewOrder(activeDrag.pendingOrder);
      emitSignal('render', { preserveMorph: true });
    }
  };
  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.button.setAttribute('data-dragging', 'true');
      tabs.setAttribute('data-reordering', 'true');
    }
    event.preventDefault();
    const currentIndex = drag.pendingOrder.indexOf(drag.view);
    const targetIndex = currentIndex === 0 ? 1 : 0;
    const otherView = drag.pendingOrder[targetIndex];
    const otherButton = buttons.find((button) => button.dataset.view === otherView);
    if (!otherButton) return;
    const rect = otherButton.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const crossed = currentIndex === 0 ? event.clientX > midpoint : event.clientX < midpoint;
    if (!crossed) return;
    const nextOrder = drag.pendingOrder.slice();
    [nextOrder[currentIndex], nextOrder[targetIndex]] = [
      nextOrder[targetIndex],
      nextOrder[currentIndex],
    ];
    drag.pendingOrder = nextOrder;
    buttons.forEach((button) => {
      button.style.order = String(nextOrder.indexOf(button.dataset.view));
    });
    syncViewTabSelection(shellState.activeTab, true);
  };
  const onPointerEnd = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    finish(true);
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 || drag) return;
    const button = event.currentTarget;
    event.stopPropagation();
    drag = {
      button,
      view: button.dataset.view,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pendingOrder: shellState.viewOrder.slice(),
    };
    try {
      button.setPointerCapture(event.pointerId);
    } catch {}
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
  };
  buttons.forEach((button) => button.addEventListener('pointerdown', onPointerDown));
  shellState.viewReorderCleanup = () => finish(false);
}

function resizePositionFromCorner(width, height, resize) {
  const left = resize.corner === 'bl' ? resize.right - width : resize.left;
  return {
    x: left + (width - resize.chipWidth) / 2,
    y: resize.lockedOpensDown ? resize.top : resize.top + height - resize.chipHeight,
  };
}

function installResize() {
  if (!shellState.popover || shellState.popover.dataset.resizeBound === '1') return;
  shellState.popover.dataset.resizeBound = '1';
  shellState.popover.querySelectorAll('.csw-resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        !shellState.open ||
        (!IS_POPOUT && shellState.activeTab === 'settings') ||
        shellState.morphAnimation ||
        !shellState.layout
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (IS_POPOUT) {
        shellState.popover.dataset.resizing = 'true';
        POPOUT.native({ kind: 'resize', corner: handle.dataset.corner });
        return;
      }
      shellState.resizeCleanup?.();
      const corner = handle.dataset.corner === 'bl' ? 'bl' : 'br';
      const startRect = shellState.popover.getBoundingClientRect();
      const startWidth = shellState.layout.width;
      const startHeight = shellState.layout.height;
      const startX = event.clientX;
      const startY = event.clientY;
      cancelFaceClick();
      const resize = {
        pointerId: event.pointerId,
        corner,
        chipHeight: shellState.layout.chip.height,
        chipWidth: shellState.layout.chip.width,
        left: startRect.left,
        right: startRect.right,
        top: startRect.top,
        bounds: shellState.layout.bounds,
        lockedOpensDown: shellState.layout.opensDown,
      };
      shellState.resizeDrag = resize;
      shellState.popover.dataset.resizing = 'true';

      const onMove = (moveEvent) => {
        if (shellState.resizeDrag !== resize || moveEvent.pointerId !== resize.pointerId) return;
        moveEvent.preventDefault();
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const availableWidth =
          corner === 'bl' ? resize.right - resize.bounds.left : resize.bounds.right - resize.left;
        const nextWidth = Math.min(
          availableWidth,
          clampPanelWidth(corner === 'bl' ? startWidth - dx : startWidth + dx),
        );
        const nextHeight = Math.min(
          resize.bounds.bottom - resize.top,
          clampPanelHeight(startHeight + dy),
        );
        shellState.width = nextWidth;
        shellState.height = nextHeight;
        shellState.position = clampPosition(
          resizePositionFromCorner(nextWidth, nextHeight, resize),
        );
        applyPosition();
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', endResize, true);
        window.removeEventListener('pointercancel', endResize, true);
        window.removeEventListener('blur', finishResize, true);
        document.removeEventListener('visibilitychange', onVisibilityChange, true);
        handle.removeEventListener('lostpointercapture', onLostPointerCapture, true);
        if (shellState.resizeCleanup === finishResize) shellState.resizeCleanup = null;
      };

      const finishResize = () => {
        cleanup();
        if (shellState.resizeDrag === resize) {
          // 调整尺寸后以当前面板顶边作为收放锚点，避免向上展开的面板在松手时翻转。
          const layout = shellLayout();
          shellState.resizeDrag = null;
          shellState.position = clampPosition({ x: shellState.position.x, y: layout.top });
        }
        shellState.popover?.removeAttribute('data-resizing');
        storage.set(WIDTH_KEY, String(shellState.width));
        storage.set(HEIGHT_KEY, String(shellState.height));
        persistPosition();
        applyPosition();
        try {
          handle.releasePointerCapture(resize.pointerId);
        } catch {}
      };

      const endResize = (endEvent) => {
        if (shellState.resizeDrag !== resize || endEvent.pointerId !== resize.pointerId) return;
        finishResize();
      };

      const onLostPointerCapture = (captureEvent) => {
        if (captureEvent.pointerId !== resize.pointerId) return;
        finishResize();
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') finishResize();
      };

      shellState.resizeCleanup = finishResize;
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {}
      window.addEventListener('pointermove', onMove, { capture: true, passive: false });
      window.addEventListener('pointerup', endResize, true);
      window.addEventListener('pointercancel', endResize, true);
      window.addEventListener('blur', finishResize, true);
      document.addEventListener('visibilitychange', onVisibilityChange, true);
      handle.addEventListener('lostpointercapture', onLostPointerCapture, true);
    });

    handle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      shellState.resizeCleanup?.();
      shellState.width = PANEL_WIDTH;
      shellState.height = clampPanelHeight(PANEL_HEIGHT);
      storage.set(WIDTH_KEY, String(shellState.width));
      storage.set(HEIGHT_KEY, String(shellState.height));
      applyPosition();
    });
  });
}

// 鼠标单击等待 100ms；更慢的第二击仍可跨越形变中的表情/玻璃命中层。
function cancelFaceClick() {
  window.clearTimeout(shellState.faceClickTimer);
  shellState.faceClickTimer = 0;
  shellState.lastFaceClick = null;
  window.removeEventListener('blur', cancelFaceClick);
}

function consumeFaceDoubleClick(event) {
  if (shellState.suppressFabClick || shellState.suppressHeadFaceClick || shellState.drag?.moved) {
    cancelFaceClick();
    return false;
  }
  const previous = shellState.lastFaceClick;
  const canSwitchWindow = IS_POPOUT || runtimeState.settings?.popoutSupported === true;
  const matched =
    event.detail !== 0 &&
    previous &&
    performance.now() - previous.time <= 500 &&
    Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6;
  cancelFaceClick();
  if (!matched || !canSwitchWindow) return false;
  if (!IS_POPOUT) settleMorph(previous.open ? 1 : 0);
  emitSignal('windowToggle', undefined);
  return true;
}

function onFaceClick(event, source) {
  const suppressed = source === 'fab' ? 'suppressFabClick' : 'suppressHeadFaceClick';
  if (shellState[suppressed] || shellState.drag?.moved) {
    cancelFaceClick();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (consumeFaceDoubleClick(event)) return;
  if (event.detail > 2) return;
  if (event.detail !== 0) {
    shellState.lastFaceClick = {
      time: performance.now(),
      x: event.clientX,
      y: event.clientY,
      open: shellState.open,
    };
    window.addEventListener('blur', cancelFaceClick, { once: true });
  }
  const expanded = source === 'fab' ? !shellState.open : false;
  const singleClick = () => {
    shellState.faceClickTimer = 0;
    if (!IS_POPOUT && isCurrentRuntime() && !shellState.detached && !shellState.detachPending) {
      setOpen(expanded, expanded ? (event.detail === 0 ? 'panel' : '') : 'chip');
    }
  };
  if (event.detail === 0 || runtimeState.settings?.popoutSupported !== true) singleClick();
  else if (!IS_POPOUT) shellState.faceClickTimer = window.setTimeout(singleClick, 100);
}

function onFaceSecondPress(event) {
  const previous = shellState.lastFaceClick;
  if (
    event.button !== 0 ||
    !previous ||
    performance.now() - previous.time > 500 ||
    Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 6
  )
    return;
  // 第二击已按下时，不让单击计时器在按下与松开之间改变命中区域。
  window.clearTimeout(shellState.faceClickTimer);
  shellState.faceClickTimer = 0;
}

function onFaceDoubleClick(event) {
  if (!consumeFaceDoubleClick(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onFabClick(event) {
  onFaceClick(event, 'fab');
}

function onHeadFaceClick(event) {
  onFaceClick(event, 'head');
}

function onGlassClick(event) {
  if (consumeFaceDoubleClick(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (shellState.popover?.dataset.morphing !== 'true') return;
  event.preventDefault();
  event.stopPropagation();
  const expanded = !shellState.open;
  startMorph(expanded, expanded ? '' : 'chip');
}

function onKeyDown(event) {
  if (event.key === 'Escape') cancelFaceClick();
  if (event.key === 'Escape' && shellState.open && !IS_POPOUT) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(false, 'chip');
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.closest("input, textarea, select, [contenteditable='true'], .ProseMirror") ||
      target.isContentEditable)
  )
    return;
  const isOutlineToggle =
    event.shiftKey && (event.code === 'KeyO' || String(event.key || '').toUpperCase() === 'O');
  if (!isOutlineToggle || !shellState.panel || !outlineEnabled()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (shellState.open && shellState.activeTab === 'outline') {
    setOpen(false, 'chip');
    return;
  }
  shellState.activeTab = 'outline';
  emitSignal('render', { preserveMorph: true });
  void refreshOutline();
  if (!shellState.open) setOpen(true, 'panel');
}

export {
  cancelFaceClick,
  installPanelDrag,
  installResize,
  installViewTabReorder,
  onFabClick,
  onFaceDoubleClick,
  onFaceSecondPress,
  onFabPointerDown,
  onGlassClick,
  onHeadFaceClick,
  onKeyDown,
  onPanelWheel,
  onResize,
};
