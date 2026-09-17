/*
 * [INPUT]: 宿主可见对话框、聊天滚动区和输入框结构。
 * [OUTPUT]: 前景界面及可停靠聊天容器识别。
 * [POS]: 布局和聊天关联共用的只读宿主识别，不读取正文。
 * [PROTOCOL]: 变更时检查 host/AGENTS.md。
 */
export function visibleSurface(node) {
  if (!(node instanceof HTMLElement)) return false;
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && style.visibility === 'visible';
}

export function foregroundSurface() {
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(
    (node) => !node.closest('[data-companion-stepwise-root]') && visibleSurface(node),
  );
  const modal = dialogs.filter(
    (node) => node.getAttribute('aria-modal') === 'true' || node.matches(':modal'),
  );
  const dialog =
    modal.at(-1) ||
    dialogs.findLast((node) => node.contains(document.activeElement)) ||
    dialogs.at(-1);
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
