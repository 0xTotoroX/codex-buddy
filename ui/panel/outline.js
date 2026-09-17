/*
 * [INPUT]: 当前回答 DOM、上下文、窗口投影与大纲状态。
 * [OUTPUT]: 大纲解析、刷新和定位；来源失联或锁定回答变化时拒绝旧导航。
 * [POS]: 回答大纲完整功能；宿主解析，弹出窗口消费投影。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CONVERSATION_TURN_SELECTOR,
  FLASH_MS,
  FRIENDLY_BRIDGE_ERRORS,
  HIGHLIGHT_CLASS,
  IS_POPOUT,
  MARK_ATTR,
  MAX_OUTLINE_ITEMS,
  MAX_OUTLINE_TITLE_LEN,
  MIN_OUTLINE_ITEMS,
  MIN_OUTLINE_TEXT_LEN,
  MIN_OUTLINE_TITLE_LEN,
  OUTLINE_INDENT_STEP,
  OUTLINE_PSEUDO_HEADING_SELECTOR,
  OUTLINE_PSEUDO_MIN_SCORE,
  OUTLINE_SCROLL_RECHECK_MS,
  OUTLINE_SCROLL_SETTLE_MS,
  OUTLINE_SEMANTIC_HEADING_SELECTOR,
  OUTLINE_TABLE_SELECTOR,
  OUTLINE_TARGET_TOP_OFFSET,
  PANEL_SAFE_MARGIN,
  ROOT_ATTR,
  STREAM_IDLE_MS,
} from './runtime/constants.js';
import {
  chatBusy,
  bindingSourceReady,
  contextMatches,
  contextSnapshot,
  findLatestAssistantMessage,
  labeledMessageContainer,
} from './host/context.js';
import {
  clamp,
  contextState,
  escapeAttr,
  escapeHtml,
  hashText,
  isCurrentRuntime,
  normalizeText,
  outlineEnabled,
  outlineState,
  shellState,
} from './runtime/state.js';
import { contentSafeBounds } from './host/host-appearance.js';
import { emitSignal } from './runtime/signals.js';
import { iconSvg } from './core/panel-appearance.js';
import { remotePanelAction } from './popout/transport.js';

function outlineVisible(node) {
  if (!(node instanceof Element)) return false;
  const rect = node.getBoundingClientRect();
  return Boolean(rect.width > 8 && rect.height > 8);
}

function outlineMarkdownRoot(messageNode) {
  if (!(messageNode instanceof Element)) return null;
  const preferred = messageNode.querySelector(
    [
      "[class*='markdownContent']",
      "[class*='markdown-content']",
      '.markdown',
      '.prose',
      'article',
    ].join(','),
  );
  if (preferred && !preferred.closest(`[${ROOT_ATTR}="true"]`)) return preferred;
  return messageNode;
}

function outlineProtectedSurface(node) {
  if (!(node instanceof Element)) return true;
  return Boolean(
    node.closest(
      [
        `[${ROOT_ATTR}="true"]`,
        "[contenteditable='true']",
        'textarea',
        'input',
        'form',
        '.ProseMirror',
      ].join(','),
    ),
  );
}

function outlineInCodeLike(node) {
  if (!(node instanceof Element)) return true;
  return Boolean(
    node.closest('pre, code, kbd, samp, [data-code-block], .cm-editor, .monaco-editor'),
  );
}

function outlineInTableLike(node) {
  if (!(node instanceof Element)) return true;
  return Boolean(node.closest(OUTLINE_TABLE_SELECTOR));
}

function outlineHeadingLevelFromTag(tag) {
  const match = /^h([1-6])$/i.exec(tag || '');
  return match ? Number(match[1]) : 0;
}

function outlineIsMarkerOnlyTitle(text) {
  const value = normalizeText(text);
  if (!value) return true;
  if (/^[一二三四五六七八九十百零]+[、.．)]?$/.test(value)) return true;
  if (/^\d{1,2}[\.、．)]?$/.test(value)) return true;
  if (/^[（(]\d{1,2}[）)]$/.test(value)) return true;
  return /^#{1,6}$/.test(value);
}

function outlineIsNoiseTitle(text) {
  if (!text || outlineIsMarkerOnlyTitle(text)) return true;
  if (text.length < MIN_OUTLINE_TITLE_LEN || text.length > MAX_OUTLINE_TITLE_LEN) return true;
  if (
    text.length <= 4 &&
    !/[0-9一二三四五六七八九十#：:]/.test(text) &&
    !outlineHasChapterHeading(text)
  )
    return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[\w./~-]+\.(js|ts|json|md|py|sh|log|png|jpg)$/i.test(text)) return true;
  if (/^\$ |^>`|^```/.test(text)) return true;
  if (
    /^(复制|copy|edit|编辑|share|分享|continue|继续|retry|重试|项|实现|位置|范围|标题|跳转|折叠|刷新)$/i.test(
      text,
    )
  )
    return true;
  if (/^[\d\s:./-]+$/.test(text)) return true;
  if (/^\/Users\/|^~\/|^\.\/|^\/Volumes\//.test(text)) return true;
  return /^(OK|PASS|FAIL|true|false|null)$/i.test(text);
}

function outlineHasChapterHeading(text) {
  const value = normalizeText(text);
  if (!value) return false;
  if (
    /^(摘要|简介|概述|概览|前言|背景|目标|现状|问题(?:分析)?|原因(?:分析)?|分析|方案|解决方案|步骤|实施步骤|实现|验证|验证结果|测试|测试结果|结果|结论|最终结论|总结|建议|后续建议|注意(?:事项)?|说明|补充说明|附录|下一步)(?:\s*[：:—-]\s*\S.*)?$/.test(
      value,
    )
  ) {
    return value.length <= 24;
  }
  return (
    /^(abstract|introduction|overview|background|goals?|problems?|causes?|analysis|solutions?|steps?|implementation|verification|tests?|results?|conclusions?|summary|recommendations?|notes?|appendix|next steps?)(?:\s*[:：—-]\s*\S.*)?$/i.test(
      value,
    ) && value.length <= 32
  );
}

function outlineLooksStructuredHeading(text) {
  const value = normalizeText(text);
  if (!value || outlineIsMarkerOnlyTitle(value)) return false;
  if (/^#{1,6}\s+\S/.test(value)) return true;
  if (/^第[一二三四五六七八九十百零\d]+[章节部分步]/.test(value)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\s*\S{2,}/.test(value)) return true;
  if (/^（?[0-9]{1,2}）\s*\S{2,}/.test(value) || /^\([0-9]{1,2}\)\s*\S{2,}/.test(value))
    return true;
  if (/^\d{1,2}[\.、．\)]\s*\S{2,}/.test(value)) return true;
  return outlineHasChapterHeading(value);
}

function outlineScorePseudoHeading(text, levelHint) {
  let score = levelHint ? 20 : 0;
  if (!outlineLooksStructuredHeading(text) && !levelHint) return 0;
  if (/^#{1,6}\s+\S/.test(text)) score += 50;
  if (/^第[一二三四五六七八九十百零\d]+[章节部分步]/.test(text)) score += 30;
  if (/^[一二三四五六七八九十]+[、.．]\s*\S{2,}/.test(text)) score += 28;
  if (/^（?[0-9]{1,2}）\s*\S{2,}/.test(text) || /^\([0-9]{1,2}\)\s*\S{2,}/.test(text)) score += 24;
  if (/^\d{1,2}[\.、．\)]\s*\S{2,}/.test(text)) score += 26;
  if (/[：:]$/.test(text) && text.length <= 18 && text.length >= 4) score += 8;
  if (outlineHasChapterHeading(text)) score += 24;
  if (text.length >= 4 && text.length <= 20) score += 6;
  if (text.length >= 28) score -= 8;
  if (/[。！？]$/.test(text)) score -= 12;
  if (text.split(' ').length > 12) score -= 10;
  return score;
}

function outlineStripHeadingMarkers(text) {
  const stripped = normalizeText(text)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^([（(]?\d{1,2}[）)]|[一二三四五六七八九十]{1,3}|\d{1,2})[\.、．\)]\s*/, '');
  return stripped && !outlineIsMarkerOnlyTitle(stripped) ? stripped : normalizeText(text);
}

function outlineDisplayHeadingTitle(text) {
  const value = normalizeText(text).replace(/^#{1,6}\s+/, '');
  return value.length <= MAX_OUTLINE_TITLE_LEN
    ? value
    : `${value.slice(0, MAX_OUTLINE_TITLE_LEN - 1)}…`;
}

function outlineTitlesEquivalent(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return Boolean(
    a &&
    b &&
    (a === b ||
      outlineStripHeadingMarkers(a) === outlineStripHeadingMarkers(b) ||
      outlineDisplayHeadingTitle(a) === outlineDisplayHeadingTitle(b)),
  );
}

function outlineOwnsOwnLine(node, text) {
  if (!(node instanceof Element)) return false;
  const parent = node.parentElement;
  if (!parent) return true;
  const parentText = normalizeText(parent.innerText || parent.textContent || '');
  if (!parentText || parentText === text) return true;
  return parentText.startsWith(text) && parentText.length <= text.length + 4;
}

function outlineHeadingNumbering(text) {
  const value = normalizeText(text);
  const patterns = [
    [/^([一二三四五六七八九十]+[、.．])\s*(\S.*)$/, 'han'],
    [/^(第[一二三四五六七八九十百零\d]+[章节部分步])\s*(\S.*)$/, 'chapter'],
    [/^((?:（[0-9]{1,2}）|\([0-9]{1,2}\)))\s*(\S.*)$/, 'arabic-parenthesized'],
  ];
  for (const [pattern, key] of patterns) {
    const match = value.match(pattern);
    if (match) return { prefix: match[1], title: match[2], pattern: key };
  }
  const arabic = value.match(/^(\d{1,2}(?:(?:[\.、．\)]\d{1,2})+)?[\.、．\)]?)\s+(\S.*)$/);
  if (!arabic) return { prefix: '', title: value, pattern: '' };
  const segments = arabic[1].match(/\d{1,2}/g)?.length || 1;
  const separators = arabic[1].match(/[\.、．\)]/g)?.join('') || '.';
  return {
    prefix: arabic[1],
    title: arabic[2],
    pattern: `arabic:${separators}:${segments}`,
  };
}

function outlineHeadingCandidate(node, kind) {
  if (
    !(node instanceof Element) ||
    !outlineVisible(node) ||
    outlineProtectedSurface(node) ||
    outlineInCodeLike(node)
  )
    return null;
  if (node.closest(`[${ROOT_ATTR}="true"]`)) return null;

  const text = normalizeText(
    (node instanceof HTMLElement ? node.innerText : node.textContent) || node.textContent || '',
  );
  if (!text || text.length > MAX_OUTLINE_TITLE_LEN + 8) return null;
  const displayText = outlineDisplayHeadingTitle(text);
  if (outlineIsNoiseTitle(displayText) || outlineIsMarkerOnlyTitle(displayText)) return null;
  const numbering = outlineHeadingNumbering(displayText);

  if (kind === 'semantic') {
    const tagLevel = outlineHeadingLevelFromTag(node.tagName);
    const ariaLevel = Number(node.getAttribute('aria-level') || 0);
    return {
      el: node,
      text: displayText,
      level: clamp(tagLevel || ariaLevel || 2, 1, 6),
      numberingPattern: numbering.pattern,
      numberPrefix: numbering.prefix,
      labelText: numbering.title,
      kind,
    };
  }

  if (outlineInTableLike(node)) return null;
  const childCount = node.children?.length || 0;
  if (childCount > 3 || node.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,table,pre')) return null;

  if (node.matches('strong,b')) {
    if (!outlineOwnsOwnLine(node, text)) return null;
    const score = outlineScorePseudoHeading(text, 1) + 8;
    if (score < OUTLINE_PSEUDO_MIN_SCORE) return null;
    return {
      el: node,
      text: displayText,
      level: 3,
      numberingPattern: numbering.pattern,
      numberPrefix: numbering.prefix,
      labelText: numbering.title,
      kind,
    };
  }

  const rect = node.getBoundingClientRect();
  if (rect.height > 84 || !outlineLooksStructuredHeading(text)) return null;
  const score = outlineScorePseudoHeading(text, 0);
  if (score < OUTLINE_PSEUDO_MIN_SCORE) return null;
  return {
    el: node,
    text: displayText,
    level: numbering.pattern ? 2 : text.length <= 12 ? 2 : 3,
    numberingPattern: numbering.pattern,
    numberPrefix: numbering.prefix,
    labelText: numbering.title,
    kind,
  };
}

function outlineCollectSemanticHeadings(root) {
  if (!(root instanceof Element)) return [];
  const result = [];
  const nodes = root.querySelectorAll(OUTLINE_SEMANTIC_HEADING_SELECTOR);
  for (const node of nodes) {
    const item = outlineHeadingCandidate(node, 'semantic');
    if (item) result.push(item);
  }
  return result;
}

function outlineCollectPseudoHeadings(root) {
  if (!(root instanceof Element)) return [];
  const result = [];
  const nodes = root.querySelectorAll(OUTLINE_PSEUDO_HEADING_SELECTOR);
  for (const node of nodes) {
    if (node.closest(OUTLINE_SEMANTIC_HEADING_SELECTOR)) continue;
    const item = outlineHeadingCandidate(node, 'pseudo');
    if (item) result.push(item);
  }
  return result;
}

function outlineSortInDocumentOrder(items) {
  return items.slice().sort((left, right) => {
    if (left.el === right.el) return 0;
    const position = left.el.compareDocumentPosition(right.el);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function outlineCollectHeadingElements(root) {
  const semanticItems = outlineCollectSemanticHeadings(root);
  if (semanticItems.length >= MIN_OUTLINE_ITEMS) return outlineSortInDocumentOrder(semanticItems);
  return outlineSortInDocumentOrder([...semanticItems, ...outlineCollectPseudoHeadings(root)]);
}

function outlineDedupeItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.level}|${item.text}`;
    if (seen.has(key)) continue;
    const previous = result.at(-1);
    if (
      previous &&
      (previous.text === item.text ||
        previous.el.contains(item.el) ||
        item.el.contains(previous.el))
    ) {
      continue;
    }
    seen.add(key);
    result.push(item);
    if (result.length >= MAX_OUTLINE_ITEMS) break;
  }
  return result;
}

function outlineNormalizeDisplayLevels(items) {
  if (!items.length) return items;
  const minimumLevel = Math.min(...items.map((item) => item.level));
  const numberedLevels = new Map();
  items.forEach((item) => {
    const baseLevel = item.level - minimumLevel;
    if (!item.numberingPattern) {
      item.displayLevel = baseLevel;
      return;
    }
    if (!numberedLevels.has(item.numberingPattern))
      numberedLevels.set(item.numberingPattern, baseLevel);
    item.displayLevel = numberedLevels.get(item.numberingPattern);
  });
  return items;
}

function outlineMarkItems(items) {
  items.forEach((item, index) => {
    const id = `stepwise-outline-${hashText(`${index}:${item.text}`)}-${index + 1}`;
    item.id = id;
    item.el.setAttribute(MARK_ATTR, id);
  });
  return items;
}

function outlineClearMarks(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(`[${MARK_ATTR}]`).forEach((node) => node.removeAttribute(MARK_ATTR));
  root
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((node) => node.classList.remove(HIGHLIGHT_CLASS));
}

function outlineFindScrollContainer(fromElement) {
  let node = fromElement instanceof Element ? fromElement.parentElement : null;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY || style.overflow;
    if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4)
      return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function outlineIsDocumentScroller(container) {
  return (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  );
}

function outlineScrollBounds(container) {
  const maxDistance = Math.max(0, container.scrollHeight - container.clientHeight);
  const style = window.getComputedStyle(container);
  const reversed =
    !outlineIsDocumentScroller(container) &&
    (style.flexDirection === 'column-reverse' || container.scrollTop < -1);
  return reversed ? { min: -maxDistance, max: 0 } : { min: 0, max: maxDistance };
}

function outlineScrollViewportTop(container) {
  const safeTop = Math.max(0, contentSafeBounds().top - PANEL_SAFE_MARGIN);
  if (outlineIsDocumentScroller(container)) return safeTop;
  return Math.max(safeTop, container.getBoundingClientRect().top);
}

function outlineScrollScale(container) {
  const layoutHeight = container.clientHeight;
  const visualHeight = container.getBoundingClientRect().height;
  if (!(layoutHeight > 0) || !(visualHeight > 0)) return 1;
  const scale = visualHeight / layoutHeight;
  return Number.isFinite(scale) && scale > 0.01 ? scale : 1;
}

function outlineTargetScrollTop(element, container) {
  const bounds = outlineScrollBounds(container);
  const elementTop = element.getBoundingClientRect().top;
  const targetViewportTop = outlineScrollViewportTop(container) + OUTLINE_TARGET_TOP_OFFSET;
  const delta = elementTop - targetViewportTop;
  const deltaInScrollSpace = delta / outlineScrollScale(container);
  return clamp(container.scrollTop + deltaInScrollSpace, bounds.min, bounds.max);
}

function outlineScheduleScrollSettle(element, container) {
  outlineState.outlineScrollCleanup?.();
  let settleTimer = 0;
  let recheckTimer = 0;
  let finished = false;
  const cleanup = () => {
    if (settleTimer) window.clearTimeout(settleTimer);
    if (recheckTimer) window.clearTimeout(recheckTimer);
    settleTimer = 0;
    recheckTimer = 0;
    container.removeEventListener('scrollend', settle);
    container.removeEventListener('wheel', cancel);
    container.removeEventListener('pointerdown', cancel);
    if (outlineState.outlineScrollCleanup === cancel) outlineState.outlineScrollCleanup = null;
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
  const correct = () => {
    if (!isCurrentRuntime() || !element.isConnected || !container.isConnected) return false;
    const targetTop = outlineTargetScrollTop(element, container);
    if (Math.abs(container.scrollTop - targetTop) > 1) container.scrollTop = targetTop;
    return true;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
  const settle = () => {
    if (finished) return;
    container.removeEventListener('scrollend', settle);
    if (settleTimer) window.clearTimeout(settleTimer);
    settleTimer = 0;
    if (!correct()) {
      finish();
      return;
    }
    recheckTimer = window.setTimeout(() => {
      recheckTimer = 0;
      correct();
      finish();
    }, OUTLINE_SCROLL_RECHECK_MS);
  };
  outlineState.outlineScrollCleanup = cancel;
  container.addEventListener('scrollend', settle, { once: true });
  container.addEventListener('wheel', cancel, { once: true, passive: true });
  container.addEventListener('pointerdown', cancel, { once: true, passive: true });
  settleTimer = window.setTimeout(settle, OUTLINE_SCROLL_SETTLE_MS);
}

function outlineScrollToElement(element) {
  const container = outlineFindScrollContainer(element);
  if (!(container instanceof Element)) return false;
  // Use one bounded destination instead of chaining scrollIntoView with a corrective scroll.
  const targetTop = outlineTargetScrollTop(element, container);
  if (!Number.isFinite(targetTop)) return false;
  if (Math.abs(container.scrollTop - targetTop) < 0.5) {
    outlineState.outlineScrollCleanup?.();
    return true;
  }
  outlineScheduleScrollSettle(element, container);
  try {
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  } catch {
    outlineState.outlineScrollCleanup?.();
    container.scrollTop = targetTop;
  }
  return true;
}

function outlineScrollToEnd(fromElement) {
  const container = outlineFindScrollContainer(fromElement);
  if (!(container instanceof Element)) return false;
  outlineState.outlineScrollCleanup?.();
  const targetTop = outlineScrollBounds(container).max;
  if (Math.abs(container.scrollTop - targetTop) < 0.5) return true;
  try {
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  } catch {
    container.scrollTop = targetTop;
  }
  return true;
}

function outlineResolveElement(id) {
  const item = outlineState.outlineItems.find((entry) => entry.id === id) || null;
  if (item?.el?.isConnected) return item.el;
  const marked = Array.from(document.querySelectorAll(`[${MARK_ATTR}]`)).find(
    (node) => node.getAttribute(MARK_ATTR) === String(id),
  );
  if (marked instanceof Element) {
    if (item) item.el = marked;
    return marked;
  }
  const latest = outlineState.outlineMessage?.isConnected
    ? { node: outlineState.outlineMessage }
    : findLatestAssistantMessage();
  const root = outlineMarkdownRoot(latest?.node);
  if (!root || !item?.text) return null;
  const kind = item.kind === 'semantic' ? 'semantic' : 'pseudo';
  const selector =
    kind === 'semantic' ? OUTLINE_SEMANTIC_HEADING_SELECTOR : OUTLINE_PSEUDO_HEADING_SELECTOR;
  const candidates = root.querySelectorAll(selector);
  for (const node of candidates) {
    if (kind === 'pseudo' && node.closest(OUTLINE_SEMANTIC_HEADING_SELECTOR)) continue;
    const candidate = outlineHeadingCandidate(node, kind);
    if (!candidate || !outlineTitlesEquivalent(candidate.text, item.text)) continue;
    node.setAttribute(MARK_ATTR, id);
    item.el = node;
    return node;
  }
  return null;
}

function outlineFlash(element) {
  if (!(element instanceof Element)) return;
  element.classList.add(HIGHLIGHT_CLASS);
  if (outlineState.flashTimer) window.clearTimeout(outlineState.flashTimer);
  outlineState.flashTimer = window.setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
    outlineState.flashTimer = 0;
  }, FLASH_MS);
}

function outlineSetActiveTarget({ id = '', anchor = '' } = {}) {
  shellState.panel
    ?.querySelectorAll('[data-outline-id],[data-outline-anchor]')
    .forEach((button) => {
      const isActive = id
        ? button.dataset.outlineId === id
        : anchor && button.dataset.outlineAnchor === anchor;
      button.dataset.active = isActive ? 'true' : 'false';
      if (isActive) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
}

function outlineJumpTo(id) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) {
    void remotePanelAction('outline-jump', { id }).then((ok) => {
      if (ok) outlineSetActiveTarget({ id });
    });
    return true;
  }
  if (contextState.chatBinding.mode === 'locked' && !contextMatches(contextSnapshot()))
    return false;
  const element = outlineResolveElement(id);
  if (!(element instanceof Element)) return false;
  outlineSetActiveTarget({ id });
  outlineScrollToElement(element);
  outlineFlash(element);
  return true;
}

function outlineCurrentMessageElement() {
  if (outlineState.outlineMessage?.isConnected) return outlineState.outlineMessage;
  const latest = findLatestAssistantMessage();
  return latest?.node instanceof Element ? latest.node : null;
}

function outlineTurnStartElement(message) {
  const turn =
    message?.closest?.(CONVERSATION_TURN_SELECTOR) ||
    (contextState.latestTurnAnchor?.turnNode?.isConnected
      ? contextState.latestTurnAnchor.turnNode
      : null);
  if (!(turn instanceof Element)) return message;
  return labeledMessageContainer(turn, 'user') || turn;
}

function outlineJumpToAnchor(anchor) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) {
    void remotePanelAction('outline-anchor', { anchor }).then((ok) => {
      if (ok) outlineSetActiveTarget({ anchor });
    });
    return true;
  }
  if (contextState.chatBinding.mode === 'locked' && !contextMatches(contextSnapshot()))
    return false;
  const message = outlineCurrentMessageElement();
  if (!(message instanceof Element)) return false;
  if (anchor === 'start') {
    const startElement = outlineTurnStartElement(message);
    if (!(startElement instanceof Element)) return false;
    outlineSetActiveTarget({ anchor });
    outlineScrollToElement(startElement);
    outlineFlash(startElement);
    return true;
  }
  if (anchor === 'end') {
    outlineSetActiveTarget({ anchor });
    return outlineScrollToEnd(message);
  }
  return false;
}

function outlineBuild(message, sourceHash) {
  if (!message?.node) {
    outlineClearMarks();
    return { items: [], fingerprint: sourceHash || '', message: null };
  }
  const textLength = message.text.length;
  const raw = outlineCollectHeadingElements(outlineMarkdownRoot(message.node));
  const items = outlineNormalizeDisplayLevels(outlineDedupeItems(raw));
  const structuredEnough = items.length >= Math.max(MIN_OUTLINE_ITEMS, 3) && textLength >= 160;
  outlineClearMarks();
  if (
    (textLength < MIN_OUTLINE_TEXT_LEN && !structuredEnough) ||
    items.length < MIN_OUTLINE_ITEMS
  ) {
    return { items: [], fingerprint: `${sourceHash}|empty`, message: message.node };
  }
  outlineMarkItems(items);
  return {
    items,
    fingerprint: `${sourceHash}|${hashText(items.map((item) => `${item.level}:${item.text}`).join('|'))}`,
    message: message.node,
  };
}

function invalidateOutline(message = null, sourceHash = '') {
  outlineClearMarks();
  outlineState.outlineItems = [];
  outlineState.outlineStatus = chatBusy() ? 'pending' : 'idle';
  outlineState.outlineError = '';
  outlineState.outlineFingerprint = '';
  outlineState.outlineSourceHash = '';
  outlineState.outlineMessage = message?.node || null;
  if (
    (shellState.layoutMode === 'workbench' || shellState.activeTab === 'outline') &&
    shellState.panel
  )
    emitSignal('render', { preserveMorph: true });
}

async function refreshOutline(options = {}) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) return remotePanelAction('outline-refresh');
  if (!isCurrentRuntime() || !outlineEnabled()) return;
  if (outlineState.outlineRefreshPromise) return outlineState.outlineRefreshPromise;
  const requestContext = contextSnapshot();
  const requestEpoch = outlineState.outlineEpoch;
  const requestCurrent = () =>
    outlineEnabled() &&
    requestEpoch === outlineState.outlineEpoch &&
    contextMatches(requestContext);
  outlineState.outlineStatus = 'pending';
  outlineState.outlineError = '';
  if (shellState.layoutMode === 'workbench' || shellState.activeTab === 'outline')
    emitSignal('render', { preserveMorph: true });

  const task = Promise.resolve()
    .then(() => {
      if (!requestCurrent()) return;
      const message = options.message || findLatestAssistantMessage();
      const sourceHash = options.assistantHash || hashText(message?.text || '');
      if (chatBusy()) {
        outlineState.outlineError = '回答尚未完成，完成后再试';
        outlineState.outlineStatus = 'pending';
        emitSignal('scan', STREAM_IDLE_MS);
        return;
      }
      const result = outlineBuild(message, sourceHash);
      if (!requestCurrent()) return;
      outlineState.outlineItems = result.items;
      outlineState.outlineFingerprint = result.fingerprint;
      outlineState.outlineSourceHash = sourceHash;
      outlineState.outlineMessage = result.message;
      outlineState.outlineStatus = result.items.length ? 'ready' : 'empty';
      outlineState.outlineError = '';
    })
    .catch((error) => {
      if (!requestCurrent()) return;
      outlineClearMarks();
      outlineState.outlineItems = [];
      outlineState.outlineStatus = 'error';
      outlineState.outlineError = error?.message || '大纲暂不可用';
    })
    .finally(() => {
      if (!requestCurrent()) return;
      if (outlineState.outlineRefreshPromise === task) outlineState.outlineRefreshPromise = null;
      if (shellState.layoutMode === 'workbench' || shellState.activeTab === 'outline')
        emitSignal('render', { preserveMorph: true });
    });
  outlineState.outlineRefreshPromise = task;
  return task;
}

function alignOutlineNestedText() {
  const rows = Array.from(
    shellState.panel?.querySelectorAll?.('.csw-outline-row[data-outline-id]') || [],
  );
  const numberedAncestors = [];
  rows.forEach((row) => {
    const level = Math.max(0, Number(row.dataset.level) || 0);
    while (numberedAncestors.length && numberedAncestors.at(-1).level >= level)
      numberedAncestors.pop();

    const ancestor = numberedAncestors.at(-1);
    if (row.dataset.numbered === 'true') {
      row.style.removeProperty('--csw-outline-hanging-indent');
      const prefix = row.querySelector('.csw-outline-prefix');
      numberedAncestors.push({
        level,
        width: Math.max(0, (prefix?.getBoundingClientRect().width || 0) + 8 - OUTLINE_INDENT_STEP),
      });
      return;
    }

    row.style.setProperty('--csw-outline-hanging-indent', ancestor ? `${ancestor.width}px` : '0px');
  });
}

function outlineHtml() {
  if (outlineState.outlineStatus === 'pending' && !outlineState.outlineItems.length) {
    return `<div class="csw-empty" data-kind="outline" role="status">
        <div class="csw-empty-title">等待回答完成</div>
      </div>`;
  }
  if (outlineState.outlineStatus === 'error') {
    return `<div class="csw-empty" data-kind="outline">
        <div class="csw-empty-title">${escapeHtml(outlineErrorTitle())}</div>
      </div>`;
  }
  if (!outlineState.outlineItems.length) {
    return `<div class="csw-empty" data-kind="outline">
        <div class="csw-empty-title">暂无大纲</div>
      </div>`;
  }
  return `<div class="csw-outline-view">
      <div class="csw-outline-list" role="list">${outlineState.outlineItems
        .map((item) => {
          const displayLevel = item.displayLevel ?? 0;
          const numberPrefix = item.numberPrefix || '';
          const labelText = item.labelText || item.text;
          return `
        <button class="csw-outline-row" type="button" role="listitem" data-outline-id="${escapeAttr(item.id)}" data-level="${displayLevel}" data-numbered="${numberPrefix ? 'true' : 'false'}" aria-label="${escapeAttr(item.text)}" style="--csw-outline-indent:${Math.min(3, Math.max(0, displayLevel)) * OUTLINE_INDENT_STEP}px">
          <span class="csw-outline-heading-marker" aria-hidden="true"></span>
          <span class="csw-outline-prefix" aria-hidden="true">${escapeHtml(numberPrefix)}</span>
          <span class="csw-outline-label">${escapeHtml(labelText)}</span>
        </button>
      `;
        })
        .join('')}
      </div>
      <div class="csw-outline-toolbar" role="toolbar" aria-label="本轮导航">
        <button class="csw-outline-nav-button" type="button" data-outline-anchor="start" title="本轮开头" aria-label="定位到本轮开头">${iconSvg('turn-start')}</button>
        <button class="csw-outline-nav-button" type="button" data-outline-anchor="end" title="本轮结尾" aria-label="定位到本轮结尾">${iconSvg('turn-end')}</button>
      </div>
    </div>`;
}

function attachOutlineEvents(root = shellState.panel) {
  root.querySelectorAll('[data-outline-id]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!outlineJumpTo(button.dataset.outlineId)) {
        outlineState.outlineStatus = 'error';
        outlineState.outlineError = '找不到对应的小节，刷新后再试。';
        emitSignal('render', { preserveMorph: true });
      }
    });
  });
  root.querySelectorAll('[data-outline-anchor]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!outlineJumpToAnchor(button.dataset.outlineAnchor)) {
        outlineState.outlineStatus = 'error';
        outlineState.outlineError = '找不到当前回答位置，刷新后再试。';
        emitSignal('render', { preserveMorph: true });
      }
    });
  });
}

function resetOutlineFeature() {
  outlineState.outlineEpoch += 1;
  outlineState.outlineScrollCleanup?.();
  outlineState.outlineScrollCleanup = null;
  outlineClearMarks();
  outlineState.outlineItems = [];
  outlineState.outlineRefreshPromise = null;
  outlineState.outlineMessage = null;
  outlineState.outlineSourceHash = '';
  outlineState.outlineFingerprint = '';
  outlineState.outlineStatus = 'idle';
  outlineState.outlineError = '';
}

function outlineErrorTitle(error = outlineState.outlineError) {
  const text = normalizeText(error);
  if (/找不到对应的小节/i.test(text)) return '找不到对应内容，刷新后再试';
  return (
    FRIENDLY_BRIDGE_ERRORS.find((item) => item.pattern.test(text))?.title ||
    '大纲暂不可用，稍后重试'
  );
}

export {
  alignOutlineNestedText,
  attachOutlineEvents,
  invalidateOutline,
  outlineClearMarks,
  outlineHtml,
  outlineJumpTo,
  outlineJumpToAnchor,
  refreshOutline,
  resetOutlineFeature,
};
