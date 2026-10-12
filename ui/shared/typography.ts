/* [INPUT]: 宿主无正文排版快照、统一字体偏好和承载节点缩放。
 * [OUTPUT]: 字体契约、默认值、统一解析与跨表面字号补偿。
 * [POS]: 字体纯计算，所有表面共用；不选择宿主来源、不保存配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export type TypographyPreferences = {
  mode: 'follow' | 'custom';
  source: 'body' | 'session' | 'composer';
  scale: number;
  customSize: number;
};
export type Typography = {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: string;
  titleFamily: string;
  titleSize: number;
  titleWeight: string;
  zoom: number;
  source?: string;
};
export const defaultTypography: TypographyPreferences = {
  mode: 'follow',
  source: 'body',
  scale: 100,
  customSize: 16,
};
export const fallbackTypography: Typography = {
  fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
  fontSize: 16,
  fontWeight: '400',
  lineHeight: 26,
  letterSpacing: 'normal',
  titleFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
  titleSize: 16,
  titleWeight: '600',
  zoom: 1,
  source: 'fallback',
};
export function layoutZoom(element?: Element | null): number {
  let zoom = 1;
  for (
    let node = element;
    node;
    node = node.parentElement || (node.getRootNode() as ShadowRoot).host
  ) {
    const value = Number.parseFloat(getComputedStyle(node).zoom);
    if (Number.isFinite(value) && value > 0) zoom *= value;
  }
  return zoom;
}
export function resolveTypography(
  snapshot?: Typography | null,
  preferences?: Partial<TypographyPreferences>,
): Typography {
  const p = { ...defaultTypography, ...preferences },
    source = snapshot || fallbackTypography;
  const size = p.mode === 'custom' ? p.customSize : (source.fontSize * p.scale) / 100;
  const ratio = size / source.fontSize;
  return {
    ...source,
    fontSize: size,
    titleSize: size,
    lineHeight: source.lineHeight * ratio,
    letterSpacing:
      source.letterSpacing === 'normal'
        ? 'normal'
        : `${(parseFloat(source.letterSpacing) || 0) * ratio}px`,
    zoom: p.mode === 'custom' ? 1 : source.zoom,
  };
}
export function typographyStyle(
  snapshot?: Typography | null,
  preferences?: Partial<TypographyPreferences>,
  localZoom = 1,
) {
  const t = resolveTypography(snapshot, preferences),
    ratio = t.zoom / localZoom;
  return {
    fontFamily: t.fontFamily,
    fontSize: `${t.fontSize * ratio}px`,
    fontWeight: t.fontWeight,
    lineHeight: `${t.lineHeight / t.fontSize}`,
    letterSpacing:
      t.letterSpacing === 'normal' ? 'normal' : `${parseFloat(t.letterSpacing) * ratio}px`,
  };
}
