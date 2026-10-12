/* [INPUT]: 认证 SSE 中的字体快照与用户偏好。
 * [OUTPUT]: 设置文档字体和 rem 基准；未收到快照时沿用本次连接的末次读数。
 * [POS]: 仅调整自有设置网页，不访问或修改宿主页面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef } from 'react';
import {
  typographyStyle,
  layoutZoom,
  type Typography,
  type TypographyPreferences,
} from '../shared/typography';
export function useTypography(snapshot?: Typography | null, preferences?: TypographyPreferences) {
  const last = useRef<Typography | null>(null);
  if (snapshot && snapshot.source !== 'fallback') last.current = snapshot;
  useLayoutEffect(() => {
    const style = typographyStyle(
      last.current || snapshot,
      preferences,
      layoutZoom(document.documentElement),
    );
    Object.assign(document.documentElement.style, style);
    document.documentElement.style.setProperty('--buddy-type-size', style.fontSize);
    return () => {
      for (const key of [
        'font-family',
        'font-size',
        'font-weight',
        'line-height',
        'letter-spacing',
        '--buddy-type-size',
      ])
        document.documentElement.style.removeProperty(key);
    };
  }, [snapshot, preferences]);
}
