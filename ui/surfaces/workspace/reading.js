/*
 * [INPUT]: 工作台已有内容身份标记与滚动节点。
 * [OUTPUT]: 按聊天和内容身份保存阅读位置；隐藏区域的零尺寸不覆盖已有滚动记录。
 * [POS]: 在容器迁移前保存阅读位置，不持久化正文或偏好。
 * [PROTOCOL]: 变更时检查 workspace/AGENTS.md。
 */
import { readWorkbenchScroll } from '../../shared/scroll.js';
export { readWorkbenchScroll, writeWorkbenchScroll } from '../../shared/scroll.js';
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
