/* [INPUT]: Per-surface material and host appearance. [OUTPUT]: Shared colors and material styles.
 * [POS]: Presentation only; used by feature views and container tabs. [PROTOCOL]: Keep AGENTS.md in sync. */
import type { CSSProperties } from 'react';
export type SurfaceTheme = {
  theme: 'black' | 'matte' | 'frosted' | 'native-glass';
  liquidVariant: 'regular' | 'clear';
};
export type Appearance = {
  theme?: string | null;
  fontSize?: number;
  fontSizes?: import('../../shared/features').FontSizes;
  legacyFontSize?: number;
  colors?: Record<string, string>;
  surface?: SurfaceTheme;
};
declare global {
  interface Window {
    ipc?: { postMessage: (message: string) => void };
    __buddyNativeSurface?: boolean;
    __buddyNativeGlass?: boolean;
  }
}
export function surfaceStyle(appearance: Appearance, native = false): CSSProperties {
  const material = appearance.surface?.theme || 'matte';
  const black = material === 'black';
  const dark =
    black ||
    appearance.theme === 'dark' ||
    (!appearance.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const glass = material === 'native-glass';
  const translucent = material === 'frosted' || (glass && (!native || window.__buddyNativeGlass));
  const colors = black ? {} : appearance.colors || {};
  const ink = black ? '#eee' : colors.text || (dark ? '#f3f3f3' : '#202020');
  const paper = black ? '#000' : colors['surface-opaque'] || (dark ? '#2b2b2b' : '#fafafa');
  const tint =
    material === 'frosted'
      ? `color-mix(in srgb, ${dark ? '#252525' : '#ededed'} 72%, transparent)`
      : 'transparent';
  return {
    colorScheme: dark ? 'dark' : 'light',
    color: ink,
    background: translucent ? (native ? 'transparent' : tint) : paper,
    backdropFilter:
      translucent && !native ? (glass ? undefined : 'blur(24px) saturate(110%)') : undefined,
    '--paper': paper,
    '--board-bg': 'transparent',
    '--surface': translucent ? `color-mix(in srgb, ${paper} 28%, transparent)` : paper,
    '--ink': ink,
    '--muted': black ? '#999' : colors.muted || (dark ? '#aaa' : '#6f6f6f'),
    '--accent': black ? '#75a7ff' : colors.accent || '#4d8dff',
    '--hover': colors.hover || `color-mix(in srgb, ${ink} 6%, transparent)`,
    '--line': colors.divider || `color-mix(in srgb, ${ink} 9%, transparent)`,
    fontSize: appearance.fontSize ? `${appearance.fontSize}px` : undefined,
  } as CSSProperties;
}
