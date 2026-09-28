/* [INPUT]: Scroll element and intended reading position.
 * [OUTPUT]: Read/write scroll while preserving hidden or size-clamped positions.
 * [POS]: Shared DOM utility for feature previews and container reading.
 * [PROTOCOL]: Keep shared/AGENTS.md in sync. */
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
