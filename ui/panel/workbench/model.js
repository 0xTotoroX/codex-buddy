/*
 * [INPUT]: 当前容器内容尺寸、面板尺寸声明与按呈现方式保存的布局偏好。
 * [OUTPUT]: 内置面板元数据、偏好迁移、纯分栏计算与统一编排命令。
 * [POS]: 工作台布局模型；不依赖 DOM、业务状态或窗口生命周期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
export const workbenchPanels = [
  { id: 'outline', title: '大纲', minWidth: 220, minHeight: 180 },
  { id: 'next', title: '下一步', minWidth: 260, minHeight: 180 },
];
// 注册表与已打开面板分开；新增注册项不会自动启用功能或多占一栏。
export function activeWorkbenchPanels(registry = workbenchPanels) {
  return ['outline', 'next'].map((id) => registry.find((pane) => pane.id === id));
}
export const SPLIT_SIZE = 8;
const bound = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0.2, Math.min(0.8, value))
    : fallback;

/** @returns {import('../../contracts').WorkbenchLayout} */
export function normalizeWorkbenchLayout(value, legacyRatio = 0.45) {
  return {
    group: value?.group === 'tabs' ? 'tabs' : 'split',
    active: value?.active === 'next' ? 'next' : 'outline',
    mode: ['auto', 'vertical', 'horizontal'].includes(value?.mode) ? value.mode : 'auto',
    first: value?.first === 'next' ? 'next' : 'outline',
    verticalRatio: bound(value?.verticalRatio, bound(legacyRatio, 0.45)),
    horizontalRatio: bound(value?.horizontalRatio, 0.4),
  };
}

// 比例始终属于第一个面板；交换位置时调用方同时翻转比例以保留各面板面积。
export function resolveWorkbenchLayout(
  preference,
  width,
  height,
  previous = '',
  panels = workbenchPanels,
) {
  const ordered = activeWorkbenchPanels(panels).sort(
    (a, b) => Number(b.id === preference.first) - Number(a.id === preference.first),
  );
  const minWidth =
    ordered.reduce((sum, pane) => sum + pane.minWidth, 0) + SPLIT_SIZE * (ordered.length - 1);
  const threshold = minWidth + (preference.mode === 'auto' && previous !== 'horizontal' ? 32 : 0);
  const axis = preference.mode !== 'vertical' && width >= threshold ? 'horizontal' : 'vertical';
  const available = Math.max(1, (axis === 'horizontal' ? width : height) - SPLIT_SIZE);
  const size = axis === 'horizontal' ? 'minWidth' : 'minHeight';
  const fits = available >= ordered[0][size] + ordered[1][size];
  const minimum = fits ? ordered[0][size] / available : 0.5;
  const maximum = fits ? 1 - ordered[1][size] / available : 0.5;
  const ratio = Math.max(minimum, Math.min(maximum, preference[`${axis}Ratio`]));
  return {
    type: preference.group === 'tabs' ? 'tabs' : 'split',
    axis,
    ratio,
    available,
    minimum,
    maximum,
    minSizes: ordered.map((pane) => pane[size]),
    children: ordered.map((pane) => ({ type: 'panel', id: pane.id })),
  };
}

// 菜单与拖拽共用命令；无效落点返回 null，不改变任何业务或持久状态。
export function arrangeWorkbench(preference, pane, action, width, height) {
  if (!['outline', 'next'].includes(pane)) return null;
  const next = normalizeWorkbenchLayout(preference);
  const other = pane === 'outline' ? 'next' : 'outline';
  if (action === 'merge') {
    next.group = 'tabs';
    next.active = pane;
  } else if (action === 'activate') next.active = pane;
  else if (action === 'reorder') {
    next.first = next.first === 'outline' ? 'next' : 'outline';
    next.verticalRatio = 1 - next.verticalRatio;
    next.horizontalRatio = 1 - next.horizontalRatio;
  } else if (action === 'split') {
    const split = resolveWorkbenchLayout(next, width, height);
    if (split.available < split.minSizes.reduce((sum, size) => sum + size, 0)) return null;
    next.group = 'split';
  } else if (['left', 'right', 'top', 'bottom'].includes(action)) {
    const horizontal = ['left', 'right'].includes(action);
    const size = horizontal ? 'minWidth' : 'minHeight';
    const minimum = activeWorkbenchPanels().reduce((sum, panel) => sum + panel[size], SPLIT_SIZE);
    if ((horizontal ? width : height) < minimum) return null;
    next.group = 'split';
    next.mode = horizontal ? 'horizontal' : 'vertical';
    const first = ['left', 'top'].includes(action) ? pane : other;
    if (next.first !== first) {
      next.verticalRatio = 1 - next.verticalRatio;
      next.horizontalRatio = 1 - next.horizontalRatio;
    }
    next.first = first;
  } else return null;
  return next;
}
