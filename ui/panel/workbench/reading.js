/*
 * [INPUT]: 工作台已有内容身份标记与滚动节点。
 * [OUTPUT]: 按聊天和内容身份保存阅读位置；隐藏区域的零尺寸不覆盖已有滚动记录。
 * [POS]: 在容器迁移前保存阅读位置，不持久化正文或偏好。
 * [PROTOCOL]: 变更时检查 workbench/AGENTS.md。
 */
const readings = new Map();
export function rememberWorkbenchReading(panel) {
  for (const body of panel?.querySelectorAll('.csw-workbench [data-reading-key]') || []) {
    // 隐藏/搬移时浏览器可能已将 scrollTop 清零，不能覆盖刚保存的可见阅读位置。
    if (!body.clientHeight && readings.has(body.dataset.readingKey)) continue;
    readings.set(body.dataset.readingKey, {
      top: readWorkbenchScroll(body),
      previewIndex: Number(body.querySelector('.csw-prompt-preview')?.dataset.previewIndex) || 0,
      previewTop: readWorkbenchScroll(body.querySelector('.csw-prompt-preview-scroll')),
    });
    if (readings.size > 32) readings.delete(readings.keys().next().value);
  }
}
export function workbenchReading(key) {
  return readings.get(key);
}

// display:none 的滚动节点无法可靠回读；按内容身份保留隐藏标签的位置。
const hiddenScroll = new WeakMap();
const scrollIdentity = (node) => node?.closest('[data-reading-key]')?.dataset.readingKey || '';
export function readWorkbenchScroll(node) {
  if (!node) return 0;
  const saved = hiddenScroll.get(node);
  if (saved?.identity === scrollIdentity(node)) {
    // 布局变大导致浏览器夹紧时保留原阅读意图；用户真正滚动后使用新位置。
    if (!node.clientHeight || node.scrollTop === saved.applied) return saved.top;
    // 字体/容器重排可能晚于布局写入；浏览器随后夹紧到新的最大值不算用户滚动。
    const maximum = Math.max(0, node.scrollHeight - node.clientHeight);
    if (maximum < saved.applied && node.scrollTop === maximum) {
      saved.applied = node.scrollTop;
      return saved.top;
    }
  }
  return node.clientHeight ? node.scrollTop : 0;
}
export function writeWorkbenchScroll(node, top) {
  if (!node) return;
  node.scrollTop = top;
  hiddenScroll.set(node, { identity: scrollIdentity(node), top, applied: node.scrollTop });
}
