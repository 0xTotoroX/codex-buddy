/*
 * [INPUT]: 工作台已有内容身份标记与滚动节点。
 * [OUTPUT]: 有界的临时阅读位置缓存。
 * [POS]: 在容器迁移前保存阅读位置，不持久化正文或偏好。
 * [PROTOCOL]: 变更时检查 workbench/AGENTS.md。
 */
const readings = new Map();
export function rememberWorkbenchReading(panel) {
  for (const body of panel?.querySelectorAll('.csw-workbench [data-reading-key]') || []) {
    if (!body.clientHeight) continue;
    readings.set(body.dataset.readingKey, {
      top: body.scrollTop,
      previewIndex: Number(body.querySelector('.csw-prompt-preview')?.dataset.previewIndex) || 0,
      previewTop: body.querySelector('.csw-prompt-preview-scroll')?.scrollTop || 0,
    });
    if (readings.size > 32) readings.delete(readings.keys().next().value);
  }
}
export function workbenchReading(key) {
  return readings.get(key);
}
