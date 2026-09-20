/*
 * [INPUT]: /model-control/icons.js 映射到公共 ui/panel/icons/index.js与服务投影数据。
 * [OUTPUT]: 无构建依赖的图标、验证和保留节点身份的列表协调。
 * [POS]: 模型控制 UI 的纯视图辅助；许可由父项目统一收集。
 * [PROTOCOL]: 与共享图标路径保持一致；地图由主任务维护。
 */
import { iconSvg } from '/model-control/icons.js';

// Route supplied by the parent: the public icon catalog remains the only source.
export const icons = new Proxy({}, { get: (_, name) => iconSvg(name) });

export function text(node, value) {
  const next = String(value ?? '');
  if (node.textContent !== next) node.textContent = next;
}

export function button(label, action, icon) {
  const node = document.createElement('button');
  node.type = 'button';
  node.title = label;
  node.setAttribute('aria-label', label);
  if (icon) node.innerHTML = icons[icon];
  else node.textContent = label;
  node.addEventListener('click', action);
  return node;
}

// Move only when order changes: passive polling preserves focus, hover and scroll.
export function reconcile(parent, items, keyOf, create, update) {
  const existing = new Map([...parent.children].map((node) => [node.dataset.key, node]));
  let cursor = parent.firstElementChild;
  for (const item of items) {
    const key = String(keyOf(item));
    const node = existing.get(key) || create(item);
    node.dataset.key = key;
    update(node, item);
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextElementSibling;
    existing.delete(key);
  }
  for (const node of existing.values()) node.remove();
}

export function describe(selection, models = []) {
  if (!selection) return '尚未读取';
  const label = models.find((model) => model.id === selection.model)?.label || selection.model;
  return `${label} · ${selection.reasoning} · ${selection.speed === 'fast' ? 'Fast' : 'Standard'}`;
}

export function validate(selection, models) {
  if (!selection) return '没有已确认的配置';
  const model = models.find((item) => item.id === selection.model);
  if (!model) return '此模型当前不可用';
  if (!model.reasoning.includes(selection.reasoning)) return '此推理强度当前不可用';
  if (!['standard', 'fast'].includes(selection.speed)) return '速度配置无效';
  if (selection.speed === 'fast' && !model.fast) return '此模型不支持 Fast；预设不会自动降速';
  return '';
}

export function moved(items, from, to) {
  const next = [...items];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
