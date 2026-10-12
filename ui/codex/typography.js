/* [INPUT]: 已识别聊天的正文元素、宿主字体变量和祖先 CSS zoom。
 * [OUTPUT]: 可复用的只读字体快照与有效布局缩放；不包含聊天文本。
 * [POS]: 宿主排版适配；由统一字体跟随、术语与工作台消费，不修改宿主样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  layoutZoom,
  defaultTypography,
  fallbackTypography,
  resolveTypography,
} from '../shared/typography';
export { layoutZoom } from '../shared/typography';
export function readTypography(element = document.body, paragraph = true) {
  const source =
    (paragraph && element?.closest('p,li')) ||
    (paragraph && element?.querySelector('p,li')) ||
    element ||
    document.documentElement;
  const style = getComputedStyle(source),
    tokens = getComputedStyle(document.documentElement);
  const size = Number.parseFloat(style.fontSize) || 16;
  const titleToken = tokens.getPropertyValue('--text-base').trim();
  const titleSize = /^\d+(\.\d+)?px$/.test(titleToken) ? Number.parseFloat(titleToken) : size;
  return {
    fontFamily: style.fontFamily,
    fontSize: size,
    fontWeight: style.fontWeight,
    lineHeight: Number.parseFloat(style.lineHeight) || size * 1.6,
    letterSpacing: style.letterSpacing,
    titleFamily: tokens.getPropertyValue('--font-ui-family').trim() || style.fontFamily,
    titleSize,
    titleWeight: tokens.getPropertyValue('--font-weight-semibold').trim() || '600',
    zoom: layoutZoom(source),
  };
}
export function sessionTypography(fallback) {
  return (
    window.__codexBuddyTypography?.resolved() ||
    window.__codexBuddyTerminology?.typography?.() ||
    readTypography(fallback)
  );
}

// 缺少有效宿主节点时保留上次值；新读数连续两次一致才发布，避免切换动画和空页面闪回默认值。
export function createTypographyTracker(getRoot, getComposer) {
  let preferences = { ...defaultTypography };
  let last = { ...fallbackTypography },
    pending = '',
    pendingSource = '',
    pendingAt = 0;
  const samples = new Map();
  function visible(node) {
    return (
      node instanceof HTMLElement &&
      node.isConnected &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== 'hidden' &&
      !node.closest('[inert],[aria-hidden="true"]')
    );
  }
  function sample() {
    const root = getRoot();
    let source;
    if (preferences.source === 'composer') source = getComposer();
    else if (preferences.source === 'session')
      source = Array.from(
        document.querySelectorAll(
          'aside.app-shell-left-panel [data-marquee-text] [data-marquee-content], aside.app-shell-left-panel [data-thread-id] [class*="truncate"], aside.app-shell-left-panel a[href*="/threads/"] [class*="truncate"], aside.app-shell-left-panel a[href*="/threads/"]',
        ),
      ).find(visible);
    else if (visible(root))
      source = Array.from(
        root.querySelectorAll(
          '[data-message-author-role="assistant"] p, [data-message-author-role="user"] p, [data-content-search-turn-key] p, .markdown p',
        ),
      ).find(visible);
    if (!visible(source)) {
      pending = '';
      return samples.get(preferences.source) || last;
    }
    const next = {
      ...readTypography(source, preferences.source === 'body'),
      source: preferences.source,
    };
    const key = JSON.stringify(next);
    if (
      key === pending &&
      pendingSource === preferences.source &&
      performance.now() - pendingAt >= 200
    ) {
      last = next;
      samples.set(preferences.source, next);
    }
    if (pending !== key || pendingSource !== preferences.source) pendingAt = performance.now();
    pending = key;
    pendingSource = preferences.source;
    return samples.get(preferences.source) || last;
  }
  return {
    configure(value) {
      preferences = { ...defaultTypography, ...value };
    },
    snapshot: sample,
    resolved: () => resolveTypography(sample(), preferences),
    preferences: () => ({ ...preferences }),
  };
}
