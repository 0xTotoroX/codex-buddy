/*
 * [INPUT]: 宿主可见对话框、聊天滚动区和输入框结构。
 * [OUTPUT]: 最近操作的聊天记录、模态窗口及独立聊天容器识别；普通注释/编辑浮层不改变停靠目标。
 * [POS]: 布局和聊天关联共用的只读宿主识别，不读取正文。
 * [PROTOCOL]: 变更时检查 codex/AGENTS.md。
 */
const MAIN =
  '.app-shell-main-content-frame,[class*="_MainContentFrame_"],[data-app-shell-tab-panel-controller]';
const CHAT = 'section[role="dialog"][class*="floatingSurface"]';
const OWN =
  '[data-companion-stepwise-root],[data-codex-buddy-features-root],[data-codex-buddy-launcher]';
let selectedSurface = null;
let selectedTopChat = null;

// 保留用户最后操作的聊天；点击 Buddy 入口不会改变其所属聊天。
export function rememberChatTarget(target) {
  if (target === null) {
    selectedSurface = selectedTopChat = null;
    return;
  }
  if (!(target instanceof Element) || target.closest(OWN)) return;
  const surface = target.closest(CHAT) || target.closest(MAIN);
  if (!surface) return;
  selectedSurface = surface;
  selectedTopChat = [...document.querySelectorAll(CHAT)].filter(visibleSurface).at(-1) || null;
}

export function visibleSurface(node) {
  if (!(node instanceof HTMLElement)) return false;
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && style.visibility === 'visible';
}

export function foregroundSurface() {
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(
    (node) =>
      !node.closest('[data-companion-stepwise-root],[data-codex-buddy-features-root]') &&
      visibleSurface(node),
  );
  const modal = dialogs.filter(
    (node) => node.getAttribute('aria-modal') === 'true' || node.matches(':modal'),
  );
  // 注释编辑等非模态浮层也使用 role=dialog。它们不接管聊天布局，
  // 否则让位会移动其锚点，鼠标离开后又恢复停靠，形成反复收放。
  const chats = dialogs.filter((node) => node.matches('section[class*="floatingSurface"]'));
  const topChat = chats.at(-1) || null;
  const selected =
    selectedSurface?.isConnected && visibleSurface(selectedSurface)
      ? selectedTopChat === topChat
        ? selectedSurface
        : null
      : document.activeElement;
  const inMain = selected instanceof Element && !!selected.closest(MAIN);
  const dialog =
    modal.at(-1) || chats.findLast((node) => node.contains(selected)) || (inMain ? null : topChat);
  if (!dialog) return null;
  const thread = dialog.querySelector('.thread-scroll-container');
  const composer = dialog.querySelector('.ProseMirror,[contenteditable="true"]');
  // 只适配已验证的独立聊天面板，设置/确认框不参与聊天绑定。
  if (!dialog.matches('section[class*="floatingSurface"]') || !thread || !composer)
    return { dialog, thread: null, row: null, content: null };
  let content = thread.parentElement;
  while (content && content !== dialog && !content.contains(composer))
    content = content.parentElement;
  const row = content?.parentElement;
  const supported =
    content &&
    content !== dialog &&
    row &&
    row !== dialog &&
    row.children.length - row.querySelectorAll(':scope > [data-codex-buddy-dock]').length === 1 &&
    getComputedStyle(row).display === 'flex' &&
    getComputedStyle(content).flexGrow !== '0';
  return { dialog, thread, row: supported ? row : null, content: supported ? content : null };
}
