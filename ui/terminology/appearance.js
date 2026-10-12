/* [INPUT]: 术语材质偏好、宿主语义色及既有表面/液态渲染器。
 * [OUTPUT]: 两个入口共用的配色、背景与液态资源清理。
 * [POS]: 不修改宿主主题，不复制液态光学实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { layoutZoom } from '../codex/typography.js';
import { surfaceStyle } from '../surfaces/theme/appearance';
import { createSvgGlass } from '../surfaces/theme/glass/svg.js';
export function inheritedAppearance(element = document.documentElement) {
  const style = getComputedStyle(element);
  const read = (...keys) =>
    keys.map((k) => style.getPropertyValue(k).trim()).find((v) => v && CSS.supports('color', v));
  return {
    theme:
      style.colorScheme === 'dark' || document.documentElement.classList.contains('dark')
        ? 'dark'
        : undefined,
    fontSize: Number.parseFloat(style.fontSize) || 16,
    colors: {
      text: read('--ink', '--foreground') || style.color,
      muted: read('--muted-foreground', '--muted'),
      accent: read('--accent', '--primary'),
      'surface-opaque': read('--paper', '--background'),
      divider: read('--line', '--border'),
      hover: read('--hover'),
      danger: read('--destructive'),
    },
  };
}
export function attachCardAppearance(card) {
  let glass = null,
    resize = null,
    signature = '',
    frame = 0;
  const disposeGlass = () => {
    cancelAnimationFrame(frame);
    resize?.disconnect();
    resize = null;
    glass?.destroy();
    glass = null;
  };
  return {
    update(preferences = {}, appearance = {}) {
      const material =
        preferences.cardMaterial || (preferences.cardStyle === 'frost' ? 'frosted' : 'matte');
      const variant = preferences.cardLiquidVariant === 'clear' ? 'clear' : 'regular';
      const key = JSON.stringify([preferences, appearance]);
      if (key === signature) return;
      signature = key;
      disposeGlass();
      const surface = surfaceStyle({
        ...appearance,
        surface: { theme: material === 'custom' ? 'matte' : material, liquidVariant: variant },
      });
      let ink = surface['--ink'],
        paper = surface['--paper'],
        muted = surface['--muted'],
        line = surface['--line'];
      if (material === 'custom' && /^#[\da-f]{6}$/i.test(preferences.cardCustomColor || '')) {
        paper = preferences.cardCustomColor;
        const rgb = paper
          .slice(1)
          .match(/../g)
          .map((v) => parseInt(v, 16) / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        const light = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05);
        ink = light ? '#000000' : '#ffffff';
        muted = ink;
        line = `color-mix(in srgb,${ink} 12%,transparent)`;
      }
      const accent =
        appearance.colors?.accent && CSS.supports('color', appearance.colors.accent)
          ? appearance.colors.accent
          : surface['--accent'];
      for (const [name, value] of Object.entries({
        bg: paper,
        fg: ink,
        muted,
        border: line,
        accent,
        hover: surface['--hover'],
        danger: appearance.colors?.danger || '#bf4d4d',
      }))
        if (value) card.style.setProperty('--term-' + name, value);
      const typography = appearance.typography || {};
      const fontSize = Number(typography.fontSize || appearance.fontSize);
      for (const [key, value] of Object.entries({
        'font-family': typography.fontFamily || 'system-ui,-apple-system,sans-serif',
        'font-weight': typography.fontWeight || '400',
        'line-height': typography.lineHeight ? `${typography.lineHeight}px` : '1.6',
        'letter-spacing': typography.letterSpacing || 'normal',
        'title-family': typography.titleFamily || typography.fontFamily || 'inherit',
        'title-size': typography.titleSize ? `${typography.titleSize}px` : '1em',
        'title-weight': typography.titleWeight || '600',
      }))
        card.style.setProperty('--term-' + key, value);
      const zoom = (typography.zoom || 1) / layoutZoom(document.documentElement);
      card.style.zoom = String(zoom);
      card.dataset.scale = String(zoom);
      card.style.setProperty(
        '--term-font-size',
        `${Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16}px`,
      );
      card.style.colorScheme = surface.colorScheme;
      card.style.width = `${Math.max(280, Math.min(420, preferences.cardWidth || 348))}px`;
      card.dataset.material = material;
      card.dataset.variant = variant;
      card.style.background = material === 'frosted' ? surface.background : paper;
      card.style.backdropFilter = material === 'frosted' ? surface.backdropFilter || '' : 'none';
      delete card.dataset.glassFallback;
      if (material === 'native-glass') {
        card.style.background = `color-mix(in srgb,${paper} ${variant === 'clear' ? 6 : surface.colorScheme === 'dark' ? 24 : 28}%,transparent)`;
        card.style.backdropFilter = 'blur(24px)';
        try {
          glass = createSvgGlass(card);
          const refresh = () => {
            if (card.isConnected) glass?.refresh(variant);
          };
          resize = new ResizeObserver(refresh);
          resize.observe(card);
          frame = requestAnimationFrame(refresh);
        } catch {
          card.dataset.glassFallback = 'true';
          card.style.background = `color-mix(in srgb,${paper} 72%,transparent)`;
        }
      }
    },
    destroy: disposeGlass,
  };
}
