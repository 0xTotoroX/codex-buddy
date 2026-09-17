/*
 * [INPUT]: runtime/state.js、宿主主题及 presentation.js 的主题投影。
 * [OUTPUT]: 弹出跟随系统明暗； 三材质、停靠场景独立偏好及液态分支迁移与实际效果映射、字体、主题、图标与尺寸归一化辅助函数。
 * [POS]: 共享胶囊外观计算层；内嵌模式通过 appearance 事件通知 SVG 液态运行时。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  DEVELOPMENT,
  LEGACY_THEME_MODE_KEY,
  DEFAULT_FONT,
  DEFAULT_MATERIAL,
  FONT_KEY,
  FONT_OFFSET_KEY,
  HEIGHT_KEY,
  IS_POPOUT,
  LABEL_ONLY_KEY,
  LEGACY_MATERIAL_KEY,
  LEGACY_MATERIAL_MODES,
  LEGACY_OUTLINE_FONT_KEY,
  LEGACY_OUTLINE_FONT_OFFSET_KEY,
  MATERIAL_KEY,
  LIQUID_VARIANT_KEY,
  PREVIOUS_V3_MATERIAL_KEY,
  LEGACY_GLASS_STYLE_KEY,
  MATERIAL_MIGRATION_KEY,
  MATERIAL_MODES,
  MATERIAL_ORIGIN_KEY,
  MAX_FONT,
  MIN_FONT,
  PANEL_HEIGHT,
  PANEL_MAX_HEIGHT,
  PANEL_MAX_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_SAFE_MARGIN,
  PANEL_WIDTH,
  PREVIOUS_MATERIAL_KEY,
  WIDTH_KEY,
} from '../runtime/constants.js';
import { clamp, roundPixel, shellState, storage } from '../runtime/state.js';
import {
  detectCodexTheme,
  readHostTypography,
  typographyFingerprint,
} from '../host/host-appearance.js';
import { emitSignal } from '../runtime/signals.js';
import { resetGlassPointer } from './effects.js';

function clampPanelWidth(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PANEL_WIDTH;
  return Math.round(clamp(parsed, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH));
}

function readPanelWidth() {
  const raw = storage.get(WIDTH_KEY);
  return raw == null || raw === '' ? PANEL_WIDTH : clampPanelWidth(raw);
}

function panelHeightCap() {
  if (IS_POPOUT) return PANEL_MAX_HEIGHT;
  const viewportCap = Math.max(
    PANEL_MIN_HEIGHT,
    Math.floor((window.innerHeight || PANEL_MAX_HEIGHT) - PANEL_SAFE_MARGIN * 2),
  );
  return Math.min(PANEL_MAX_HEIGHT, viewportCap);
}

function clampPanelHeight(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(PANEL_HEIGHT, panelHeightCap());
  return Math.round(clamp(parsed, PANEL_MIN_HEIGHT, panelHeightCap()));
}

function readPanelHeight() {
  const raw = storage.get(HEIGHT_KEY);
  return raw == null || raw === '' ? clampPanelHeight(PANEL_HEIGHT) : clampPanelHeight(raw);
}

function clampFontSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT;
  return Math.round(clamp(parsed, MIN_FONT, MAX_FONT));
}

function clampFontOffset(value, baseItemFontSize = DEFAULT_FONT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const parsedBase = Number(baseItemFontSize);
  const base = Number.isFinite(parsedBase) ? parsedBase : DEFAULT_FONT;
  return roundPixel(clamp(parsed, MIN_FONT - base, MAX_FONT - base));
}

function readFontOffset() {
  const storedOffset = storage.get(FONT_OFFSET_KEY);
  if (storedOffset != null && storedOffset !== '' && Number.isFinite(Number(storedOffset))) {
    return clampFontOffset(storedOffset);
  }

  const legacyStepwiseFont = storage.get(FONT_KEY);
  if (legacyStepwiseFont != null && legacyStepwiseFont !== '') {
    const migrated = clampFontOffset(clampFontSize(legacyStepwiseFont) - DEFAULT_FONT);
    storage.set(FONT_OFFSET_KEY, String(migrated));
    return migrated;
  }

  const outlineOffset = storage.get(LEGACY_OUTLINE_FONT_OFFSET_KEY);
  if (outlineOffset != null && outlineOffset !== '' && Number.isFinite(Number(outlineOffset))) {
    const migrated = clampFontOffset(outlineOffset);
    storage.set(FONT_OFFSET_KEY, String(migrated));
    return migrated;
  }

  const outlineFont = storage.get(LEGACY_OUTLINE_FONT_KEY);
  const migrated =
    outlineFont == null || outlineFont === ''
      ? 0
      : clampFontOffset(clampFontSize(outlineFont) - DEFAULT_FONT);
  storage.set(FONT_OFFSET_KEY, String(migrated));
  return migrated;
}

function effectiveFontSize(typography = shellState.hostTypography) {
  return clampFontSize(typography.baseItemFontSize + shellState.fontOffset);
}

function persistFontPreference() {
  storage.set(FONT_OFFSET_KEY, String(shellState.fontOffset));
  storage.set(FONT_KEY, String(effectiveFontSize()));
}

function setPixelVariable(element, property, value) {
  if (!(element instanceof HTMLElement)) return;
  const next = `${roundPixel(value)}px`;
  if (element.style.getPropertyValue(property) !== next) {
    element.style.setProperty(property, next);
  }
}

function applyTypographyVariables() {
  if (!shellState.root) return;
  shellState.root.style.setProperty('--csw-font-family', shellState.hostTypography.fontFamily);
  shellState.root.style.setProperty(
    '--csw-font-weight',
    String(shellState.hostTypography.fontWeight),
  );
  shellState.root.style.setProperty(
    '--csw-label-weight',
    String(shellState.hostTypography.labelWeight),
  );
  setPixelVariable(shellState.root, '--csw-item-font', effectiveFontSize());
  setPixelVariable(shellState.root, '--csw-chrome-font', shellState.hostTypography.chromeFontSize);
  setPixelVariable(shellState.root, '--csw-icon-font', shellState.hostTypography.iconFontSize);
}

function installTypographyObserver() {
  if (shellState.typographyObserver || !document.documentElement) return;
  shellState.typographyObserver = new MutationObserver(() => syncHostTypography());
  const options = {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-appearance', 'data-color-mode'],
  };
  shellState.typographyObserver.observe(document.documentElement, options);
  if (document.body) shellState.typographyObserver.observe(document.body, options);
}

function writeFontSize(value) {
  const parsed = Number(value);
  const requested = clampFontSize(Number.isFinite(parsed) ? parsed : effectiveFontSize());
  const baseItemFontSize = shellState.hostTypography.baseItemFontSize;
  shellState.fontOffset = clampFontOffset(requested - baseItemFontSize, baseItemFontSize);
  persistFontPreference();
  applyTypographyVariables();
}

function bumpFontSize(delta) {
  writeFontSize(effectiveFontSize() + delta);
  if (shellState.open) emitSignal('render', { preserveMorph: true });
}

function fontSizeLabel() {
  return `${effectiveFontSize()}px`;
}

function normalizeMaterial(value) {
  if (MATERIAL_MODES.includes(value)) return value;
  return (
    {
      glass: 'frosted',
      solid: 'matte',
      opaque: 'matte',
    }[value] || DEFAULT_MATERIAL
  );
}

function migrateLegacyMaterial(value) {
  return LEGACY_MATERIAL_MODES[value] || DEFAULT_MATERIAL;
}

function migrateMaterialStorageV3() {
  const previous = storage.get(PREVIOUS_MATERIAL_KEY);
  const legacy = storage.get(LEGACY_MATERIAL_KEY);
  const previousIsUserChoice =
    MATERIAL_MODES.includes(previous) &&
    (legacy === null || previous !== migrateLegacyMaterial(legacy));
  return previousIsUserChoice
    ? { material: previous, origin: 'user' }
    : { material: DEFAULT_MATERIAL, origin: 'default' };
}

// 停靠外观只属于当前宿主场景，不写入胶囊/原生窗口的共享偏好。
function dockAppearanceScope() {
  if (IS_POPOUT || shellState.root?.dataset.workbench !== 'true') return '';
  const slot = shellState.root?.closest('[data-codex-buddy-dock]');
  if (!slot) return '';
  return slot.closest('[data-codex-buddy-chat-row]') ? 'chat' : 'main';
}

function currentAppearance() {
  const scope = dockAppearanceScope();
  if (!scope) return { material: shellState.material, liquidVariant: shellState.liquidVariant };
  const material = storage.get(`${MATERIAL_KEY}:dock-${scope}`);
  const liquidVariant = storage.get(`${LIQUID_VARIANT_KEY}:dock-${scope}`);
  return {
    material: MATERIAL_MODES.includes(material)
      ? material
      : scope === 'main'
        ? 'native-glass'
        : 'matte',
    liquidVariant: ['regular', 'clear'].includes(liquidVariant)
      ? liquidVariant
      : scope === 'main'
        ? 'clear'
        : 'regular',
  };
}

function materialLabel(value = currentAppearance().material) {
  return {
    frosted: '磨砂',
    'native-glass': '液态',
    matte: '哑光',
  }[normalizeMaterial(value)];
}

function nextMaterial(value = currentAppearance().material) {
  const index = MATERIAL_MODES.indexOf(normalizeMaterial(value));
  return MATERIAL_MODES[(index + 1) % MATERIAL_MODES.length];
}

function readMaterial() {
  const stored = storage.get(MATERIAL_KEY);
  if (MATERIAL_MODES.includes(stored)) return stored;
  const previous = storage.get(PREVIOUS_V3_MATERIAL_KEY);
  if (MATERIAL_MODES.includes(previous)) {
    const migrated =
      previous === 'native-glass' && storage.get(LEGACY_GLASS_STYLE_KEY) !== 'clear'
        ? 'frosted'
        : previous;
    storage.set(MATERIAL_KEY, migrated);
    storage.remove(LEGACY_GLASS_STYLE_KEY);
    return migrated;
  }
  if (['clear', 'liquid', 'crystal', 'liquid2'].includes(stored)) {
    storage.set(MATERIAL_KEY, DEFAULT_MATERIAL);
    return DEFAULT_MATERIAL;
  }
  if (storage.get(MATERIAL_MIGRATION_KEY) === 'true') {
    storage.set(MATERIAL_KEY, DEFAULT_MATERIAL);
    storage.set(MATERIAL_ORIGIN_KEY, 'default');
    return DEFAULT_MATERIAL;
  }
  const migrated = migrateMaterialStorageV3();
  storage.set(MATERIAL_KEY, migrated.material);
  storage.set(MATERIAL_ORIGIN_KEY, migrated.origin);
  storage.set(MATERIAL_MIGRATION_KEY, 'true');
  return migrated.material;
}

function materialButtonLabel() {
  return `外观：${materialLabel()}；切换为${materialLabel(nextMaterial())}`;
}

function materialValueLabel() {
  return materialLabel();
}

function applyMaterial(options = {}) {
  const appearance = currentAppearance();
  const mode = normalizeMaterial(appearance.material);
  const animate = options.animate !== false;
  shellState.root?.setAttribute('data-material', mode);
  shellState.root?.setAttribute('data-liquid-variant', appearance.liquidVariant);
  const variant = shellState.panel?.querySelector('[data-action=liquid-variant]');
  if (variant) {
    variant.hidden = mode !== 'native-glass';
    variant.title =
      appearance.liquidVariant === 'clear' ? '已开启通透液态，点击恢复标准' : '开启通透液态';
    variant.setAttribute('aria-pressed', String(appearance.liquidVariant === 'clear'));
  }
  const nativeGlass = Boolean(window.__companionNativeGlass);
  const effective = IS_POPOUT
    ? mode === 'frosted'
      ? 'native-frosted'
      : mode === 'native-glass' && nativeGlass
        ? 'native-glass'
        : 'matte'
    : mode === 'native-glass'
      ? 'frosted'
      : mode;
  shellState.root?.setAttribute('data-effective-material', effective);
  shellState.popover?.setAttribute('data-effective-material', effective);
  shellState.popover?.setAttribute('data-material', mode);
  if (shellState.materialAnimTimer) window.clearTimeout(shellState.materialAnimTimer);
  shellState.materialAnimTimer = 0;
  if (animate) {
    shellState.popover?.setAttribute('data-material-animating', 'true');
    shellState.materialAnimTimer = window.setTimeout(() => {
      shellState.popover?.removeAttribute('data-material-animating');
      shellState.materialAnimTimer = 0;
    }, 260);
  } else {
    shellState.popover?.removeAttribute('data-material-animating');
  }
  const button = shellState.panel?.querySelector("[data-action='material']");
  if (button) {
    button.dataset.material = mode;
    button.removeAttribute('aria-pressed');
    button.setAttribute('aria-label', materialButtonLabel());
    button.setAttribute('title', materialButtonLabel());
    const value = button.querySelector('[data-material-value]');
    const fallback = IS_POPOUT && mode !== effective && !effective.startsWith('native-');
    if (value)
      value.textContent = fallback ? `${materialLabel()}（当前哑光）` : materialValueLabel();
    if (fallback)
      button.title = '当前系统不支持液态玻璃，暂用哑光；液态需 macOS 26+，磨砂仍可使用。';
  }
  resetGlassPointer();
  if (!IS_POPOUT) window.dispatchEvent(new Event('codex-buddy:appearance'));
}

function writeMaterial(value) {
  const scope = dockAppearanceScope();
  if (scope) {
    const material = normalizeMaterial(value);
    storage.set(`${MATERIAL_KEY}:dock-${scope}`, material);
    applyMaterial();
    return material;
  }
  shellState.material = normalizeMaterial(value);
  storage.set(MATERIAL_KEY, shellState.material);
  storage.set(MATERIAL_ORIGIN_KEY, 'user');
  storage.set(MATERIAL_MIGRATION_KEY, 'true');
  applyMaterial();
  return shellState.material;
}

function readLiquidVariant() {
  return storage.get(LIQUID_VARIANT_KEY) === 'clear' ? 'clear' : 'regular';
}
function toggleLiquidVariant(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const liquidVariant = currentAppearance().liquidVariant === 'clear' ? 'regular' : 'clear';
  const scope = dockAppearanceScope();
  if (scope) storage.set(`${LIQUID_VARIANT_KEY}:dock-${scope}`, liquidVariant);
  else {
    shellState.liquidVariant = liquidVariant;
    storage.set(LIQUID_VARIANT_KEY, liquidVariant);
  }
  applyMaterial({ animate: false });
  emitSignal('render', { preserveMorph: true });
}
function toggleMaterial(event) {
  event?.preventDefault();
  event?.stopPropagation();
  return writeMaterial(nextMaterial());
}

function toggleLabelOnly(event) {
  event?.preventDefault();
  event?.stopPropagation();
  shellState.labelOnly = !shellState.labelOnly;
  storage.set(LABEL_ONLY_KEY, String(shellState.labelOnly));
  if (shellState.open) emitSignal('render', { preserveMorph: true });
  return shellState.labelOnly;
}

function syncTheme() {
  if (IS_POPOUT) {
    shellState.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    shellState.root?.setAttribute('data-theme', shellState.theme);
    applyTypographyVariables();
    return;
  }
  localStorage.removeItem(LEGACY_THEME_MODE_KEY);
  shellState.themeMode = 'auto';
  shellState.theme = detectCodexTheme();
  shellState.root?.setAttribute('data-theme', shellState.theme);
  shellState.root?.setAttribute('data-theme-mode', shellState.themeMode);
  syncHostTypography();
}

function syncHostTypography(force = false) {
  if (!shellState.root) return;
  const next = readHostTypography();
  const changed =
    force || typographyFingerprint(next) !== typographyFingerprint(shellState.hostTypography);
  if (changed) shellState.hostTypography = next;
  applyTypographyVariables();
  if (changed || force) persistFontPreference();
}

function themeLabel() {
  const target = IS_POPOUT ? 'macOS' : 'Codex';
  return `${target} 明暗：${shellState.theme === 'dark' ? '深色；切换到浅色' : '浅色；切换到深色'}`;
}

function iconSvg(name) {
  const common = `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
  if (name === 'next') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M5 7.5h8.5M5 12h11M5 16.5h7"/><path ${common} d="m15.5 7.5 3 2.5-3 2.5"/></svg>`;
  }
  if (name === 'outline') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M8 6h11M8 12h8M8 18h6"/><circle fill="currentColor" cx="4.5" cy="6" r="1.2"/><circle fill="currentColor" cx="4.5" cy="12" r="1.2"/><circle fill="currentColor" cx="4.5" cy="18" r="1.2"/></svg>`;
  }
  if (name === 'settings') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"/><path ${common} d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.06a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.06A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.04-.04A2 2 0 1 1 7.05 4.2l.04.04a1.7 1.7 0 0 0 1.88.34H9A1.7 1.7 0 0 0 10 3.06V3a2 2 0 0 1 4 0v.06a1.7 1.7 0 0 0 1.03 1.56h.03a1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88v.03A1.7 1.7 0 0 0 20.94 10H21a2 2 0 0 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15Z"/></svg>`;
  }
  if (name === 'open-config') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M3.5 6h7M14.5 6h6M3.5 12h3M10.5 12h10M3.5 18h9M16.5 18h4"/><path ${common} d="M12.5 3.8v4.4M8.5 9.8v4.4M14.5 15.8v4.4"/></svg>`;
  }
  if (name === 'star')
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.9 9.6l6.3-.9Z"/></svg>`;
  if (name === 'moon') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M20.1 14.8A8.2 8.2 0 0 1 9.2 3.9a.9.9 0 0 0-1.1-1.1 9.8 9.8 0 1 0 13.1 13.1.9.9 0 0 0-1.1-1.1Z"/></svg>`;
  }
  if (name === 'sun') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><circle ${common} cx="12" cy="12" r="4.3"/><path ${common} d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.35 5.35 6.9 6.9M17.1 17.1l1.55 1.55M18.65 5.35 17.1 6.9M6.9 17.1l-1.55 1.55"/></svg>`;
  }
  if (name === 'refresh') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M20 11a8 8 0 0 0-14.1-5.2L4 8"/><path ${common} d="M4 4v4h4"/><path ${common} d="M4 13a8 8 0 0 0 14.1 5.2L20 16"/><path ${common} d="M20 20v-4h-4"/></svg>`;
  }
  if (name === 'connection') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="m8.2 15.8-1.4 1.4a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2A3.4 3.4 0 0 1 10 9"/><path ${common} d="m15.8 8.2 1.4-1.4a3.4 3.4 0 0 1 4.8 4.8l-3.2 3.2A3.4 3.4 0 0 1 14 15"/><path ${common} d="m8.5 15.5 7-7"/></svg>`;
  }
  if (name === 'turn-start') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M5 5h14M12 19V8m-4 4 4-4 4 4"/></svg>`;
  }
  if (name === 'turn-end') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M5 19h14M12 5v11m-4-4 4 4 4-4"/></svg>`;
  }
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path ${common} d="M6 6l12 12M18 6 6 18"/></svg>`;
}

function themeIcon() {
  return shellState.theme === 'dark' ? iconSvg('sun') : iconSvg('moon');
}

function installThemeObserver() {
  if (shellState.themeObserver) return;

  let frame = 0;
  const update = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const before = `${shellState.themeMode}:${shellState.theme}`;
      syncTheme();
      if (shellState.open && before !== `${shellState.themeMode}:${shellState.theme}`)
        emitSignal('render', undefined);
    });
  };

  if (IS_POPOUT) {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => {
      syncTheme();
      emitSignal('render', undefined);
    };
    media.addEventListener('change', changed);
    shellState.themeObserver = { disconnect: () => media.removeEventListener('change', changed) };
    return;
  }
  shellState.themeObserver = new MutationObserver(update);
  [document.documentElement, document.body].filter(Boolean).forEach((node) => {
    shellState.themeObserver.observe(node, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'color-scheme'],
    });
  });
}

export {
  applyMaterial,
  currentAppearance,
  bumpFontSize,
  clampFontOffset,
  clampPanelHeight,
  clampPanelWidth,
  effectiveFontSize,
  fontSizeLabel,
  iconSvg,
  installThemeObserver,
  installTypographyObserver,
  materialButtonLabel,
  materialValueLabel,
  normalizeMaterial,
  readFontOffset,
  readMaterial,
  readLiquidVariant,
  toggleLiquidVariant,
  readPanelHeight,
  readPanelWidth,
  syncTheme,
  themeIcon,
  themeLabel,
  toggleLabelOnly,
  toggleMaterial,
  writeMaterial,
};
