/*
 * [INPUT]: 宿主页面标记、字体与主题。
 * [OUTPUT]: 宿主字体、主题、可用内容区域只读适配。
 * [POS]: 宿主外观适配边界，不依赖胶囊视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  CHROME_FONT_RATIO,
  HOST_FONT_FAMILY_FALLBACK,
  HOST_FONT_SIZE_FALLBACK,
  HOST_FONT_SIZE_MAX,
  HOST_FONT_SIZE_MIN,
  ICON_FONT_RATIO,
  IS_POPOUT,
  ITEM_FONT_RATIO,
  PANEL_SAFE_MARGIN,
} from '../runtime/constants.js';
import { clamp, roundPixel } from '../runtime/state.js';

function contentSafeBounds() {
  if (IS_POPOUT)
    return {
      left: 12,
      top: 12,
      right: window.innerWidth - 12,
      bottom: window.innerHeight - 12,
      width: window.innerWidth - 24,
      height: window.innerHeight - 24,
    };
  const viewportWidth = Math.max(80, window.innerWidth || 0);
  const viewportHeight = Math.max(80, window.innerHeight || 0);
  let left = PANEL_SAFE_MARGIN;
  let top = PANEL_SAFE_MARGIN;
  let right = viewportWidth - PANEL_SAFE_MARGIN;
  let bottom = viewportHeight - PANEL_SAFE_MARGIN;

  const leftPanel = document.querySelector('aside.app-shell-left-panel');
  if (leftPanel instanceof Element) {
    const rect = leftPanel.getBoundingClientRect();
    if (rect.width >= 48 && rect.right > 40 && rect.right < viewportWidth * 0.62) {
      left = Math.max(left, rect.right + PANEL_SAFE_MARGIN);
    }
  }

  const mainStage = document.querySelector(
    'main.main-surface, .app-shell-main-content-viewport, .app-shell-main-content-frame',
  );
  if (mainStage instanceof Element) {
    const rect = mainStage.getBoundingClientRect();
    if (rect.width >= 160) {
      if (rect.left > 40 && rect.left < viewportWidth * 0.62) {
        left = Math.max(left, rect.left + PANEL_SAFE_MARGIN);
      }
      if (rect.right > left + 80 && rect.right <= viewportWidth + 2) {
        right = Math.min(right, rect.right - PANEL_SAFE_MARGIN);
      }
      if (rect.top >= 0 && rect.top < viewportHeight * 0.4) {
        top = Math.max(top, rect.top + PANEL_SAFE_MARGIN);
      }
      if (rect.bottom > top + 80 && rect.bottom <= viewportHeight + 2) {
        bottom = Math.min(bottom, rect.bottom - PANEL_SAFE_MARGIN);
      }
    }
  }

  const rightRail = document.querySelector(
    "aside.app-shell-right-panel, [data-testid='right-sidebar'], aside.app-shell-secondary-panel",
  );
  if (rightRail instanceof Element) {
    const rect = rightRail.getBoundingClientRect();
    if (rect.width >= 48 && rect.left > viewportWidth * 0.45 && rect.left < viewportWidth - 40) {
      right = Math.min(right, rect.left - PANEL_SAFE_MARGIN);
    }
  }

  document
    .querySelectorAll(
      ".app-header-tint, .draggable.flex.h-toolbar, [class*='h-toolbar'].draggable, header",
    )
    .forEach((bar) => {
      if (!(bar instanceof Element)) return;
      const rect = bar.getBoundingClientRect();
      if (rect.height < 28 || rect.height > 96) return;
      if (rect.top > 24 || rect.width < viewportWidth * 0.45) return;
      top = Math.max(top, rect.bottom + PANEL_SAFE_MARGIN);
    });

  if (bottom - top < CHIP_HEIGHT) {
    top = PANEL_SAFE_MARGIN;
  }

  if (right - left < CHIP_WIDTH) {
    left = PANEL_SAFE_MARGIN;
    right = viewportWidth - PANEL_SAFE_MARGIN;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function fallbackHostTypography() {
  const hostFontSize = HOST_FONT_SIZE_FALLBACK;
  return {
    source: 'fallback',
    fontFamily: HOST_FONT_FAMILY_FALLBACK,
    fontWeight: 400,
    labelWeight: 500,
    hostFontSize,
    baseItemFontSize: roundPixel(hostFontSize * ITEM_FONT_RATIO),
    chromeFontSize: roundPixel(hostFontSize * CHROME_FONT_RATIO),
    iconFontSize: roundPixel(hostFontSize * ICON_FONT_RATIO),
  };
}

function hostTypographySource() {
  const trigger = visibleTypographyNode('[data-codex-intelligence-trigger]');
  if (trigger) return { element: trigger, source: 'model-trigger' };
  const composer = visibleTypographyNode(
    '[data-codex-composer] .ProseMirror, [data-codex-composer] [contenteditable="true"], .ProseMirror, [contenteditable="true"]',
  );
  if (composer) return { element: composer, source: 'composer' };
  const textarea = visibleTypographyNode('textarea');
  if (textarea) return { element: textarea, source: 'textarea' };
  if (document.body) return { element: document.body, source: 'body' };
  return { element: document.documentElement, source: 'document' };
}

function readHostTypography() {
  const { element, source } = hostTypographySource();
  if (!(element instanceof Element)) return fallbackHostTypography();
  const computed = getComputedStyle(element);
  const parsedSize = Number.parseFloat(computed.fontSize);
  const parsedWeight = Number.parseInt(computed.fontWeight, 10);
  const hostFontSize = clamp(
    Number.isFinite(parsedSize) ? parsedSize : HOST_FONT_SIZE_FALLBACK,
    HOST_FONT_SIZE_MIN,
    HOST_FONT_SIZE_MAX,
  );
  const fontWeight = Number.isFinite(parsedWeight) ? parsedWeight : 400;
  return {
    source,
    fontFamily: computed.fontFamily || HOST_FONT_FAMILY_FALLBACK,
    fontWeight,
    labelWeight: clamp(fontWeight + 100, 500, 700),
    hostFontSize: roundPixel(hostFontSize),
    baseItemFontSize: roundPixel(hostFontSize * ITEM_FONT_RATIO),
    chromeFontSize: roundPixel(hostFontSize * CHROME_FONT_RATIO),
    iconFontSize: roundPixel(hostFontSize * ICON_FONT_RATIO),
  };
}

function typographyFingerprint(value) {
  return [
    value.source,
    value.fontFamily,
    value.fontWeight,
    value.hostFontSize,
    value.baseItemFontSize,
  ].join('|');
}

function parseRgb(color) {
  const match = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function luminance(rgb) {
  if (!rgb) return 0;
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

function detectCodexTheme() {
  const rootClass = document.documentElement.classList;
  if (rootClass.contains('electron-dark') || rootClass.contains('theme-dark')) return 'dark';
  if (rootClass.contains('electron-light') || rootClass.contains('theme-light')) return 'light';

  const bodyClass = document.body?.classList;
  if (bodyClass?.contains('electron-dark') || bodyClass?.contains('theme-dark')) return 'dark';
  if (bodyClass?.contains('electron-light') || bodyClass?.contains('theme-light')) return 'light';

  const explicitTokens = [
    document.documentElement.getAttribute('data-theme'),
    document.documentElement.getAttribute('color-scheme'),
    document.body?.getAttribute('data-theme'),
    getComputedStyle(document.documentElement).colorScheme,
  ].join(' ');
  if (/\bdark\b/i.test(explicitTokens)) return 'dark';
  if (/\blight\b/i.test(explicitTokens)) return 'light';

  const candidates = [
    document.querySelector('.thread-scroll-container'),
    document.querySelector('main'),
    document.body,
    document.documentElement,
  ].filter(Boolean);
  for (const node of candidates) {
    const color = getComputedStyle(node).backgroundColor;
    const rgb = parseRgb(color);
    if (rgb && rgb.a > 0.05) return luminance(rgb) < 128 ? 'dark' : 'light';
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function visibleTypographyNode(selector) {
  return (
    Array.from(document.querySelectorAll(selector)).find(
      (node) => node.getClientRects().length > 0,
    ) || null
  );
}

export {
  contentSafeBounds,
  detectCodexTheme,
  fallbackHostTypography,
  readHostTypography,
  typographyFingerprint,
};
