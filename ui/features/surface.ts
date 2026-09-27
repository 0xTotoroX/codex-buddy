/* [INPUT]: Per-surface material and host appearance. [OUTPUT]: Shared colors and material styles.
 * [POS]: Presentation only; used by feature views and container tabs. [PROTOCOL]: Keep AGENTS.md in sync. */
import type { CSSProperties } from 'react';
export type SurfaceTheme = {
  theme: 'black' | 'matte' | 'frosted' | 'native-glass';
  liquidVariant: 'regular' | 'clear';
};
export type Appearance = { theme?: string | null; fontSize?: number; surface?: SurfaceTheme };
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
  const ink = dark ? '#e8e8e1' : '#2c2e2b';
  const paper = black ? '#090909' : dark ? '#232420' : '#faf9f6';
  const tint =
    appearance.surface?.liquidVariant === 'clear'
      ? dark
        ? '#12121210'
        : '#ffffff10'
      : dark
        ? '#23242070'
        : '#faf9f680';
  return {
    colorScheme: dark ? 'dark' : 'light',
    color: ink,
    background: translucent ? (native ? 'transparent' : tint) : paper,
    backdropFilter: translucent && !native ? `blur(${glass ? 4 : 18}px)` : undefined,
    '--paper': paper,
    '--board-bg': 'transparent',
    '--surface': translucent ? (dark ? '#25272070' : '#fffefb80') : paper,
    '--ink': ink,
    '--muted': dark ? '#a3a59a' : '#777b73',
    '--line': dark ? '#ffffff20' : '#00000018',
    fontSize: appearance.fontSize ? `${appearance.fontSize}px` : undefined,
  } as CSSProperties;
}
