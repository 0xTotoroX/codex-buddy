/* [INPUT]: 已识别聊天的正文元素、宿主字体变量和祖先 CSS zoom。
 * [OUTPUT]: 可复用的只读字体快照与有效布局缩放；不包含聊天文本。
 * [POS]: 宿主排版适配；由术语两个入口消费，不修改宿主样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export function layoutZoom(element) {
  let zoom = 1;
  for (let node = element; node; node = node.parentElement || node.getRootNode()?.host) {
    const value = Number.parseFloat(getComputedStyle(node).zoom);
    if (Number.isFinite(value) && value > 0) zoom *= value;
  }
  return zoom;
}
export function readTypography(element = document.body) {
  const source =
    element?.closest('p,li') ||
    element?.querySelector('p,li') ||
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
  return window.__codexBuddyTerminology?.typography?.() || readTypography(fallback);
}
