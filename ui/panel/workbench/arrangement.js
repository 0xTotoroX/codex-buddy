/*
 * [INPUT]: 工作台 DOM、当前布局与统一提交回调、功能可用状态。
 * [OUTPUT]: 面板移动菜单、标签键盘交互、可取消的窗内落位预览、临时专注查看。
 * [POS]: 只编排现有视图；不创建窗口、不读取正文、不发业务请求。
 * [PROTOCOL]: 变更时核对 workbench/AGENTS.md。
 */
import { iconSvg } from '../icons/index.js';
import { arrangeWorkbench } from './model.js';

export function installArrangement(root, { read, write, update, enabled }) {
  const events = new AbortController();
  const panes = root.querySelector('.csw-workbench-panes');
  const preview = document.createElement('div');
  preview.className = 'csw-drop-preview';
  preview.hidden = true;
  preview.setAttribute('aria-hidden', 'true');
  root.append(preview);
  let focused = '';
  let drag = null;
  let suppressClick = false;
  let suppressTimer;
  const bounds = () => {
    const style = getComputedStyle(panes);
    return {
      width: panes.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: panes.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    };
  };
  function command(pane, action) {
    if (focused && action !== 'focus') return false;
    if (action === 'focus') {
      cancel();
      focused = focused === pane ? '' : pane;
      update();
      return true;
    }
    const { width, height } = bounds();
    const next = arrangeWorkbench(read(), pane, action, width, height);
    if (!next) return false;
    write(next);
    return true;
  }
  function cancel() {
    if (drag?.moved) suppressClick = true;
    if (drag && panes.hasPointerCapture(drag.pointerId))
      panes.releasePointerCapture(drag.pointerId);
    drag = null;
    preview.hidden = true;
    delete root.dataset.arranging;
  }
  root.addEventListener(
    'pointerdown',
    () => {
      if (!drag) suppressClick = false;
    },
    { capture: true, signal: events.signal },
  );
  root.addEventListener(
    'change',
    (event) => {
      const menu = event.target.closest('[data-pane-arrange]');
      if (!menu) return;
      command(menu.dataset.paneArrange, menu.value);
      menu.value = '';
    },
    { signal: events.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
        return;
      }
      const focus = event.target.closest('[data-pane-focus]');
      const tab = event.target.closest('[data-pane-tab]');
      if (focus) command(focus.dataset.paneFocus, 'focus');
      if (tab) command(tab.dataset.paneTab, 'activate');
    },
    { capture: true, signal: events.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const tab = event.target.closest('[data-pane-tab]');
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...panes.querySelectorAll('[data-pane-tab]')];
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
              tabs.length;
      tabs.forEach((button, i) => {
        button.tabIndex = i === index ? 0 : -1;
      });
      tabs[index].focus();
    },
    { signal: events.signal },
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || (!drag && !focused)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (drag) cancel();
      else {
        focused = '';
        update();
      }
    },
    { capture: true, signal: events.signal },
  );
  window.addEventListener('blur', cancel, { signal: events.signal });
  panes.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || focused) return;
      const tab = event.target.closest('[data-pane-tab]');
      const header = event.target.closest('.csw-workbench-pane > header');
      if (!tab && (!header || event.target.closest('button,select,input,summary'))) return;
      const pane = tab?.dataset.paneTab || header.closest('[data-pane]').dataset.pane;
      if (!enabled(pane)) return;
      event.stopPropagation();
      drag = {
        pane,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        target: null,
      };
      // 超过拖动阈值才捕获指针，保留标签的普通点击目标。
    },
    { signal: events.signal },
  );
  function destination(event) {
    const rect = panes.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return null;
    const other = drag.pane === 'outline' ? 'next' : 'outline';
    if (!enabled(drag.pane) || !enabled(other)) return null;
    const target = read().group === 'tabs' ? panes : panes.querySelector(`[data-pane="${other}"]`);
    if (!target?.isConnected || !target.clientHeight) return null;
    const box = target.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width,
      y = (event.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    const edge = Math.min(x, 1 - x, y, 1 - y);
    const action =
      edge >= 0.25
        ? 'merge'
        : edge === x
          ? 'left'
          : edge === 1 - x
            ? 'right'
            : edge === y
              ? 'top'
              : 'bottom';
    const { width, height } = bounds();
    if (!arrangeWorkbench(read(), drag.pane, action, width, height)) return null;
    return { action, box };
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      if (!drag.moved) panes.setPointerCapture(event.pointerId);
      drag.moved = true;
      event.preventDefault();
      root.dataset.arranging = 'true';
      drag.target = destination(event);
      preview.hidden = !drag.target;
      if (!drag.target) return;
      const { action, box } = drag.target;
      const origin = root.getBoundingClientRect();
      let { width, height } = box;
      let left = box.left - origin.left,
        top = box.top - origin.top;
      if (['left', 'right'].includes(action)) {
        width /= 2;
        if (action === 'right') left += width;
      }
      if (['top', 'bottom'].includes(action)) {
        height /= 2;
        if (action === 'bottom') top += height;
      }
      Object.assign(preview.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      preview.textContent = action === 'merge' ? '合并为标签' : '分栏';
    },
    { signal: events.signal },
  );
  window.addEventListener(
    'pointerup',
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => {
          suppressClick = false;
        }, 0);
        return;
      }
      const target = drag.moved ? destination(event) : null;
      const { pane, moved } = drag;
      cancel();
      if (moved) {
        suppressClick = true;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
      if (target) command(pane, target.action);
    },
    { signal: events.signal },
  );
  window.addEventListener('pointercancel', cancel, { signal: events.signal });
  panes.addEventListener('lostpointercapture', cancel, { signal: events.signal });
  let lastSize = '';
  const observer = new ResizeObserver(() => {
    const size = `${panes.clientWidth}:${panes.clientHeight}`;
    if (lastSize && lastSize !== size) cancel();
    lastSize = size;
  });
  observer.observe(panes);
  return {
    get focused() {
      return focused;
    },
    command,
    cancel,
    sync() {
      if (
        drag &&
        (!root.isConnected ||
          root.closest('[data-dock-visible="false"]') ||
          !enabled(drag.pane) ||
          !enabled(drag.pane === 'outline' ? 'next' : 'outline') ||
          panes.hidden)
      )
        cancel();
      for (const menu of root.querySelectorAll('[data-pane-arrange]')) {
        menu.disabled = Boolean(focused);
        const { width, height } = bounds();
        for (const option of menu.options)
          if (option.value)
            option.disabled = !arrangeWorkbench(
              read(),
              menu.dataset.paneArrange,
              option.value,
              width,
              height,
            );
      }
      for (const button of root.querySelectorAll('[data-pane-focus]')) {
        const icon = focused ? 'restore' : 'focus';
        if (button.dataset.icon !== icon) {
          button.innerHTML = iconSvg(icon);
          button.dataset.icon = icon;
        }
        button.setAttribute('aria-label', focused ? '恢复编排' : '专注查看');
        button.setAttribute('title', focused ? '恢复编排' : '专注查看');
        button.setAttribute('aria-pressed', String(focused === button.dataset.paneFocus));
      }
    },
    destroy() {
      cancel();
      clearTimeout(suppressTimer);
      events.abort();
      observer.disconnect();
      preview.remove();
    },
  };
}
