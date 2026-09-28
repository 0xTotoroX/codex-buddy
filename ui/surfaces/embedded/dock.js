/*
 * [INPUT]: 已识别的 Codex 主内容与前景聊天布局、期望侧栏宽度和开合状态。
 * [OUTPUT]: 自有根节点挂载、可撤销布局占位、含回程锚点的几何通知与临时让位状态；收起占位归零，宿主不可用时保留紧凑入口，不创建提示或替代菜单。
 * [POS]: 宿主布局适配；不移动聊天节点，不读取正文，不包含功能视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { foregroundSurface } from '../../codex/page-context.js';
const SLOT = 'data-codex-buddy-dock';
const OWN_UI = `[${SLOT}],[data-companion-stepwise-root],[data-codex-buddy-features-root]`;
const visible = (node) =>
  node && node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility === 'visible';

export function findDockHost() {
  const surface = foregroundSurface();
  if (surface) return surface.row ? surface : null;
  const frames = document.querySelectorAll(
    '.app-shell-main-content-frame,[class*="_MainContentFrame_"]',
  );
  for (const frame of frames) {
    if (!visible(frame)) continue;
    for (const row of frame.children) {
      const style = getComputedStyle(row);
      if (style.display !== 'flex' || style.flexDirection !== 'row') continue;
      const content = [...row.children].find(
        (child) =>
          !child.hasAttribute(SLOT) &&
          child.querySelector('.thread-scroll-container') &&
          child.querySelector('.ProseMirror,[contenteditable="true"]'),
      );
      if (content && getComputedStyle(content).flexGrow !== '0') return { row, content };
    }
  }
  return null;
}

export function createDock(onChange, beforeMove = () => {}) {
  let host = null,
    slot = null,
    frame = 0,
    fingerprint = '';
  let options = { width: 340, open: true, detached: false };
  let blocked = false;
  let observer = null;
  let attachedRoot = null;
  let dockExpanded = false;
  const blockedRows = new WeakMap();
  const schedule = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
  };
  const mutations = new MutationObserver((records) => {
    const external = records.filter(
      (record) =>
        !(record.target instanceof Element && record.target.closest(OWN_UI)) &&
        (record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => !(node instanceof Element && node.matches(OWN_UI)),
          )),
    );
    if (
      external.length &&
      (!slot?.isConnected ||
        foregroundSurface()?.dialog !== host?.dialog ||
        external.some(
          (record) =>
            (record.type === 'childList' && record.target === host?.row) ||
            (record.type === 'attributes' &&
              record.target instanceof Element &&
              (record.target.matches('[role="dialog"],dialog') ||
                record.target.contains(host?.row))) ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(
                  '[role="dialog"],dialog,[class*="MainContent"],.app-shell-main-content-frame',
                ) ||
                  node.querySelector('[role="dialog"],dialog') ||
                  node.contains(host?.row)),
            ),
        ))
    )
      schedule();
  });
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'aria-hidden', 'aria-modal', 'style', 'class'],
  });
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  function unavailable(suspended) {
    removeSlot();
    publish({ status: suspended ? 'suspended' : 'unsupported', rect: null });
  }
  function removeSlot() {
    if (slot) beforeMove();
    observer?.disconnect();
    observer = null;
    if (host) blockedRows.set(host.row, blocked);
    if (attachedRoot) {
      if (attachedRoot.parentElement !== document.body) document.body.append(attachedRoot);
      delete attachedRoot.dataset.dockMounted;
    }
    host?.row.removeAttribute('data-codex-buddy-chat-row');
    host?.content.removeAttribute('data-codex-buddy-chat-content');
    slot?.remove();
    slot = null;
    host = null;
  }
  function update(next = options) {
    options = next;
    const found = findDockHost();
    if (!found) {
      unavailable(!!foregroundSurface());
      return;
    }
    if (host?.row !== found.row || host?.content !== found.content || !slot?.isConnected) {
      removeSlot();
      host = found;
      blocked = blockedRows.get(host.row) || false;
      if (host.dialog) {
        host.row.setAttribute('data-codex-buddy-chat-row', 'true');
        host.content.setAttribute('data-codex-buddy-chat-content', 'true');
      }
      slot = document.createElement('aside');
      slot.setAttribute(SLOT, 'true');
      slot.setAttribute('aria-label', 'CodexBuddy 工作台入口');
      slot.style.cssText =
        'order:1;flex:0 0 auto;min-width:0;position:relative;align-self:stretch;overflow:visible;padding:0;border:0;margin:0;box-sizing:border-box;';
      host.row.append(slot);
      observer = new ResizeObserver(schedule);
      observer.observe(host.row);
      observer.observe(host.content);
      if (host.dialog) observer.observe(host.dialog);
    }
    const bounds = host.row.getBoundingClientRect();
    // 只计算聊天与自有占位可分配的宽度，不把文件/浏览器侧栏算进来。
    const availableWidth = Math.min(
      bounds.width,
      host.content.getBoundingClientRect().width + slot.getBoundingClientRect().width,
    );
    const requestedWidth = Math.min(options.width, Math.max(300, availableWidth - 560));
    const enough =
      availableWidth >= 560 + requestedWidth && bounds.bottom - Math.max(bounds.top, 48) >= 426;
    // 收起后即使空间恢复也保持收起，由用户主动重新打开。
    if (options.open && !options.detached && !enough) blocked = true;
    if (!options.open) blocked = false;
    const returnExpanded = options.open && enough && !blocked;
    const expanded = !options.detached && returnExpanded;
    if (dockExpanded && !expanded) beforeMove();
    dockExpanded = expanded;
    slot.dataset.expanded = String(expanded);
    placeRoot();
    const width = expanded ? requestedWidth : 0;
    if (slot.style.width !== `${width}px`) slot.style.width = `${width}px`;
    slot.dataset.reason = enough ? '' : 'space';
    const rect = slot.getBoundingClientRect();
    slot.style.setProperty('--csw-dock-inset', `${Math.max(0, 48 - rect.top)}px`);
    // 确认宿主真的让出了空间；失败时撤销，不用浮层冒充停靠。
    if (
      host.content.getBoundingClientRect().right > rect.left + 1 ||
      rect.right > bounds.right + 1
    ) {
      unavailable(!!host.dialog);
      return;
    }
    publish({
      status: expanded ? 'open' : options.detached ? 'detached' : enough ? 'closed' : 'space',
      transient: !!host.dialog,
      rect: {
        left: rect.left,
        top: Math.max(rect.top, 48),
        width: rect.width,
        height: rect.bottom - Math.max(rect.top, 48),
        right: rect.right,
        bottom: rect.bottom,
        anchor: {
          left: returnExpanded ? rect.right - requestedWidth : rect.right,
          top: Math.max(rect.top, 48),
          right: rect.right,
          bottom: returnExpanded ? rect.bottom : Math.max(rect.top, 48),
          width: returnExpanded ? requestedWidth : 0,
          height: returnExpanded ? rect.bottom - Math.max(rect.top, 48) : 0,
        },
      },
    });
  }
  function publish(value) {
    const key = JSON.stringify(value);
    if (key === fingerprint) return;
    fingerprint = key;
    onChange(value);
  }
  function placeRoot() {
    if (!attachedRoot) return;
    const parent = dockExpanded && slot ? slot : document.body;
    if (attachedRoot.parentElement !== parent) {
      attachedRoot.dataset.dockMoved = 'true';
      parent.append(attachedRoot);
    }
    if (dockExpanded && slot) attachedRoot.dataset.dockMounted = 'true';
    else delete attachedRoot.dataset.dockMounted;
  }
  return {
    update,
    attachRoot(root) {
      attachedRoot = root;
      placeRoot();
    },
    reopen() {
      blocked = false;
      update({ ...options, open: true });
    },
    destroy() {
      mutations.disconnect();
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      cancelAnimationFrame(frame);
      removeSlot();
    },
  };
}
