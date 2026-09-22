/*
 * [INPUT]: 宿主 DOM、上下文状态和基础可见性工具。
 * [OUTPUT]: 工作台跟随/锁定策略、稳定聊天身份重绑与来源可用性；限定容器内的输入目标、完整相邻问答及上下文变更通知。
 * [POS]: 宿主读取边界，不修改 Stepwise 或大纲的内部状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CHAT_BINDING_KEY,
  CHIP_HEIGHT,
  CHIP_WIDTH,
  CONVERSATION_TURN_SELECTOR,
  IS_POPOUT,
  ROOT_ATTR,
} from '../runtime/constants.js';
import {
  storage,
  hashText,
  contextState,
  directText,
  elementText,
  isCurrentRuntime,
  normalizeText,
  runtimeState,
  shellState,
  stripOwnUi,
} from '../runtime/state.js';
import { emitSignal } from '../runtime/signals.js';
import {
  pushDiagnostic,
  rectSummary,
  visibleElement,
  visibleRect,
} from '../runtime/diagnostics.js';

import { foregroundSurface } from './surfaces.js';

function roleFromElement(node) {
  if (!(node instanceof Element)) return '';
  const explicit = node.getAttribute('data-message-author-role');
  if (explicit) return explicit.toLowerCase();

  const text = elementText(node);
  if (/^(assistant|codex|assistant\s+said)\b/i.test(text)) return 'assistant';
  if (/^(user|you)\b/i.test(text)) return 'user';
  return '';
}

function threadRoots() {
  return Array.from(document.querySelectorAll('.thread-scroll-container'))
    .filter((node) => node instanceof HTMLElement)
    .filter((node) => visibleElement(node) && !shellState.root?.contains(node));
}

function threadRootOf(node) {
  if (!(node instanceof Element)) return null;
  return node.closest?.('.thread-scroll-container') || null;
}

function interactionThreadRoot(target) {
  const direct = threadRootOf(target);
  if (direct) return direct;
  // 输入框和聊天标题可能是消息区的兄弟节点，只接受唯一的同容器聊天。
  let container = target.parentElement;
  while (container && container !== document.body) {
    const roots = container.querySelectorAll('.thread-scroll-container');
    if (roots.length === 1) return roots[0];
    if (roots.length > 1) return null;
    container = container.parentElement;
  }
  return null;
}

function stablePaneKeyForRoot(root) {
  if (!(root instanceof Element)) return '';
  const dialog = root.closest('section[role="dialog"][class*="floatingSurface"]');
  if (dialog) return `pane:${nodeIdentity(dialog, 'dialog')}`;
  let current = root;
  for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
    const controller = current.getAttribute('data-app-shell-tab-panel-controller');
    if (controller) return `pane:controller:${controller}`;
    const focusArea = current.getAttribute('data-app-shell-focus-area');
    if (focusArea) return `pane:focus:${focusArea}`;
    const anchorHost = current.getAttribute('data-pip-anchor-host');
    if (anchorHost)
      return `pane:anchor:${anchorHost === 'codex-main-thread' ? 'main' : anchorHost}`;
  }

  const roots = threadRoots();
  if (roots.length <= 1) return 'pane:main';
  const ordered = roots
    .map((node) => ({ node, left: visibleRect(node)?.left ?? Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.left - right.left);
  const index = Math.max(
    0,
    ordered.findIndex((item) => item.node === root),
  );
  return index === 0 ? 'pane:main' : `pane:secondary:${index}`;
}

function nodeIdentity(node, prefix = 'node') {
  if (!(node instanceof Element)) return '';
  const explicit = [
    node.getAttribute('data-conversation-id'),
    node.getAttribute('data-session-id'),
    node.getAttribute('data-thread-id'),
    node.getAttribute('data-message-id'),
    node.getAttribute('data-turn-id'),
    node.id,
  ].find(Boolean);
  if (explicit) return `${prefix}:${explicit}`;
  if (!contextState.nodeKeys.has(node)) {
    contextState.nodeKeySeq += 1;
    contextState.nodeKeys.set(node, `${prefix}:${contextState.nodeKeySeq}`);
  }
  return contextState.nodeKeys.get(node);
}

function sessionIdForRoot(root) {
  if (!(root instanceof Element)) return '';

  const conversationMarkers = [
    'data-above-composer-conversation-id',
    'data-response-annotation-conversation',
  ];
  for (const attribute of conversationMarkers) {
    const marker = root.hasAttribute?.(attribute) ? root : root.querySelector?.(`[${attribute}]`);
    const value = marker?.getAttribute?.(attribute);
    if (value) return String(value);
  }

  let current = root;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    const value = [
      current.getAttribute?.('data-conversation-id'),
      current.getAttribute?.('data-session-id'),
      current.getAttribute?.('data-thread-id'),
    ].find(Boolean);
    if (value) return String(value);
  }

  // Side chats do not expose the main conversation marker; their tab ID is stable.
  current = root;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    const tabId = current.getAttribute?.('data-tab-id');
    if (tabId) return String(tabId);
  }

  const descendant = root.querySelector?.(
    '[data-conversation-id], [data-session-id], [data-thread-id]',
  );
  const descendantValue = [
    descendant?.getAttribute?.('data-conversation-id'),
    descendant?.getAttribute?.('data-session-id'),
    descendant?.getAttribute?.('data-thread-id'),
  ].find(Boolean);
  if (descendantValue) return String(descendantValue);
  const links = Array.from(root.querySelectorAll("a[href*='/c/'], a[href*='/conversation/']"));
  for (const link of links) {
    const match = String(link.getAttribute('href') || '').match(/\/(?:c|conversation)\/([^/?#]+)/i);
    if (match?.[1]) return match[1];
  }
  const routeMatch = location.pathname.match(/\/(?:c|conversation)\/([^/?#]+)/i);
  const paneKey = stablePaneKeyForRoot(root);
  if ((paneKey === 'pane:anchor:main' || paneKey === 'pane:main') && routeMatch?.[1])
    return routeMatch[1];
  if (threadRoots().length <= 1 && routeMatch?.[1]) return routeMatch[1];
  return paneKey;
}

function assistantMessageId(message) {
  if (message?.turnKey) return `turn:${message.turnKey}`;
  const node = message?.node;
  if (!(node instanceof Element)) return '';
  return nodeIdentity(node, 'assistant');
}

function resetContextContent() {
  contextState.latestTurnAnchor = null;
  contextState.lastAssistantHash = '';
  contextState.lastAssistantAt = 0;
  emitSignal('context', undefined);
}

function installContextTracking() {
  if (!contextState.pointerHandler) {
    contextState.pointerHandler = (event) => {
      if (pinThreadFromTarget(event.target, 'pointer')) emitSignal('scan', 0);
    };
    document.addEventListener('pointerdown', contextState.pointerHandler, true);
  }
  if (!contextState.focusHandler) {
    contextState.focusHandler = (event) => {
      if (pinThreadFromTarget(event.target, 'focus')) emitSignal('scan', 0);
    };
    document.addEventListener('focusin', contextState.focusHandler, true);
  }
  if (!contextState.selectionHandler) {
    contextState.selectionHandler = () => {
      const selection = document.getSelection();
      const node = selection?.anchorNode;
      const target = node instanceof Element ? node : node?.parentElement;
      if (target && pinThreadFromTarget(target, 'selection')) emitSignal('scan', 0);
    };
    document.addEventListener('selectionchange', contextState.selectionHandler, true);
  }
}

function removeContextTracking() {
  if (contextState.pointerHandler)
    document.removeEventListener('pointerdown', contextState.pointerHandler, true);
  if (contextState.focusHandler)
    document.removeEventListener('focusin', contextState.focusHandler, true);
  if (contextState.selectionHandler)
    document.removeEventListener('selectionchange', contextState.selectionHandler, true);
  contextState.pointerHandler = null;
  contextState.focusHandler = null;
  contextState.selectionHandler = null;
}

// 只允许宿主明确标记的聊天身份用于长期锁定；位置、引用链接不能代替聊天身份。
function lockableRoot(root) {
  if (!(root instanceof Element) || !root.isConnected) return false;
  const id = sessionIdForRoot(root);
  if (!id || id.startsWith('pane:') || id.length > 256) return false;
  let ancestor = root;
  for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
    for (const name of ['data-conversation-id', 'data-session-id', 'data-thread-id']) {
      const explicit = ancestor.getAttribute(name);
      if (explicit && explicit !== id) return false;
    }
  }
  const markers = '[data-above-composer-conversation-id],[data-response-annotation-conversation]';
  return Boolean(
    root.matches(markers) ||
    root.querySelector(markers) ||
    root.closest('[data-conversation-id],[data-session-id],[data-thread-id]'),
  );
}

function sourceLabel(root) {
  const foreground = foregroundSurface();
  const title =
    foreground?.thread === root
      ? foreground.dialog.querySelector('header')?.textContent?.trim().slice(0, 90)
      : '';
  return title ? `聊天 · ${title}` : `Codex · 任务 ${sessionIdForRoot(root).slice(-8)}`;
}

function selectedThreadRoot() {
  const roots = threadRoots();
  const selected = roots.find(
    (root) =>
      root === contextState.pinnedThreadRoot &&
      sessionIdForRoot(root) === contextState.pinnedSessionId,
  );
  return selected || foregroundSurface()?.thread || roots[0] || null;
}

function chatBindingStatus() {
  const binding = contextState.chatBinding;
  const current = contextState.activeContext.paneRoot;
  const selected = selectedThreadRoot();
  return {
    ...binding,
    available: binding.mode !== 'locked' || contextState.bindingAvailable,
    canLock: lockableRoot(current),
    canRetarget: lockableRoot(selected) && sessionIdForRoot(selected) !== binding.sessionId,
    selectedSessionId: lockableRoot(selected) ? sessionIdForRoot(selected) : '',
  };
}

function changeChatBinding(action, expectedSessionId = '') {
  if (!['follow', 'lock', 'current'].includes(action))
    return { ok: false, message: '不支持的聊天关联操作。' };
  const root = action === 'lock' ? resolveActiveThreadRoot() : selectedThreadRoot();
  if (
    action !== 'follow' &&
    (!lockableRoot(root) || (expectedSessionId && sessionIdForRoot(root) !== expectedSessionId))
  )
    return { ok: false, message: '聊天来源已经变化或无法确认身份，请重新选择。' };
  contextState.chatBinding =
    action === 'follow'
      ? { mode: 'follow', sessionId: '', label: '' }
      : { mode: 'locked', sessionId: sessionIdForRoot(root), label: sourceLabel(root) };
  storage.set(CHAT_BINDING_KEY, JSON.stringify(contextState.chatBinding));
  if (root) setActiveThreadRoot(root, 'binding');
  if (action !== 'follow') resolveActiveThreadRoot();
  emitSignal('render', undefined);
  emitSignal('scan', 0);
  return { ok: true };
}

function lockedThreadRoot(roots) {
  const matches = roots.filter(
    (root) =>
      lockableRoot(root) &&
      sessionIdForRoot(root) === contextState.chatBinding.sessionId &&
      getComputedStyle(root).visibility === 'visible' &&
      !root.closest('[inert],[aria-hidden="true"]'),
  );
  const root = matches.length === 1 ? matches[0] : null;
  const available = Boolean(root);
  if (contextState.bindingAvailable !== available) {
    contextState.bindingAvailable = available;
    if (!available) emitSignal('bindingUnavailable', undefined);
    // 不重置结果或上下文身份；请求 epoch 在失联时失效，阅读状态保留。
  }
  if (root) setActiveThreadRoot(root, 'locked');
  return root;
}

function bindingSourceReady() {
  if (IS_POPOUT)
    return Boolean(
      shellState.remoteSource && shellState.remoteSource.association?.available !== false,
    );
  return contextState.chatBinding.mode !== 'locked' || Boolean(resolveActiveThreadRoot());
}

function setActiveThreadRoot(root, reason = 'resolve') {
  if (!(root instanceof HTMLElement) || !root.isConnected) return false;
  const paneKey = stablePaneKeyForRoot(root);
  const sessionId = sessionIdForRoot(root);
  const previous = contextState.activeContext;
  const sessionChanged = previous.sessionId !== sessionId;
  const identityChanged =
    sessionChanged ||
    (previous.paneKey !== paneKey &&
      contextState.chatBinding.mode !== 'locked' &&
      reason !== 'binding');
  if (!identityChanged && previous.paneRoot === root) return false;
  if (!identityChanged) {
    contextState.activeContext = {
      ...previous,
      paneKey,
      paneRoot: root,
    };
    if (contextState.pinnedPaneKey === paneKey && contextState.pinnedSessionId === sessionId) {
      contextState.pinnedThreadRoot = root;
    }
    pushDiagnostic('context:rebound', {
      reason,
      paneKey,
      sessionId,
      generation: contextState.activeContext.generation,
      paneCount: threadRoots().length,
      paneRect: rectSummary(root),
    });
    emitSignal('render', undefined);
    return true;
  }
  contextState.activeContext = {
    paneRoot: root,
    paneKey,
    sessionId,
    assistantMessageId: '',
    generation: previous.generation + 1,
  };
  if (contextState.pinnedPaneKey === paneKey && contextState.pinnedThreadRoot === root) {
    contextState.pinnedSessionId = sessionId;
  }
  resetContextContent();
  pushDiagnostic('context:changed', {
    reason,
    paneKey,
    sessionId,
    sessionChanged,
    generation: contextState.activeContext.generation,
    paneCount: threadRoots().length,
    paneRect: rectSummary(root),
  });
  emitSignal('render', undefined);
  return true;
}

function contextSnapshot() {
  return {
    runtimeGeneration: runtimeState.runtimeGeneration,
    generation: contextState.activeContext.generation,
    paneKey: contextState.activeContext.paneKey,
    sessionId: contextState.activeContext.sessionId,
    assistantMessageId: contextState.activeContext.assistantMessageId,
  };
}

function contextMatches(snapshot) {
  if (!snapshot) return false;
  if (!isCurrentRuntime(snapshot.runtimeGeneration)) return false;
  if (!bindingSourceReady() || (!IS_POPOUT && !resolveActiveThreadRoot())) return false;
  const current = contextState.activeContext;
  if (contextState.chatBinding.mode === 'locked') {
    const message = findLatestAssistantMessage();
    if (hashText(normalizeText(message?.text || '')) !== contextState.lastAssistantHash)
      return false;
  }
  return (
    snapshot.generation === current.generation &&
    snapshot.sessionId === current.sessionId &&
    snapshot.assistantMessageId === current.assistantMessageId
  );
}

function pinThreadFromTarget(target, reason) {
  if (
    !(target instanceof Element) ||
    shellState.root?.contains(target) ||
    target.closest('[data-codex-buddy-dock]')
  )
    return false;
  const root = interactionThreadRoot(target);
  if (!root) return false;
  contextState.pinnedPaneKey = stablePaneKeyForRoot(root);
  contextState.pinnedSessionId = sessionIdForRoot(root);
  contextState.pinnedThreadRoot = root;
  contextState.pinnedThreadAt = Date.now();
  if (contextState.chatBinding.mode === 'locked') {
    emitSignal('render', undefined);
    return false;
  }
  return setActiveThreadRoot(root, reason);
}

function rootMatchesContext(root, paneKey, sessionId) {
  if (!(root instanceof Element) || !paneKey) return false;
  if (stablePaneKeyForRoot(root) !== paneKey) return false;
  return !sessionId || sessionIdForRoot(root) === sessionId;
}

function rootForContext(paneKey, sessionId, roots = threadRoots(), allowPaneFallback = false) {
  if (contextState.chatBinding.mode === 'locked') {
    if (sessionId !== contextState.chatBinding.sessionId) return null;
    return lockedThreadRoot(roots);
  }
  if (!paneKey) return null;
  return (
    roots.find((root) => rootMatchesContext(root, paneKey, sessionId)) ||
    (allowPaneFallback && roots.find((root) => stablePaneKeyForRoot(root) === paneKey)) ||
    null
  );
}

function resolveActiveThreadRoot() {
  const roots = threadRoots();
  if (contextState.chatBinding.mode === 'locked') return lockedThreadRoot(roots);
  if (!roots.length) {
    contextState.activeContext.paneRoot = null;
    return null;
  }
  if (shellState.layoutMode === 'workbench') {
    const foreground = foregroundSurface();
    if (foreground?.thread instanceof HTMLElement && roots.includes(foreground.thread)) {
      setActiveThreadRoot(foreground.thread, 'foreground-chat');
      return foreground.thread;
    }
  }
  const current = contextState.activeContext.paneRoot;
  if (current?.isConnected && roots.includes(current)) {
    const sessionId = sessionIdForRoot(current);
    if (sessionId !== contextState.activeContext.sessionId)
      setActiveThreadRoot(current, 'session-change');
    return current;
  }
  const pinned =
    rootForContext(contextState.pinnedPaneKey, contextState.pinnedSessionId, roots, true) ||
    (contextState.pinnedThreadRoot?.isConnected && roots.includes(contextState.pinnedThreadRoot)
      ? contextState.pinnedThreadRoot
      : null);
  if (pinned) {
    contextState.pinnedThreadRoot = pinned;
    setActiveThreadRoot(pinned, 'pinned');
    return pinned;
  }
  const rebound = rootForContext(
    contextState.activeContext.paneKey,
    contextState.activeContext.sessionId,
    roots,
    true,
  );
  if (rebound) {
    setActiveThreadRoot(rebound, 'active-rebound');
    return rebound;
  }
  const focused = threadRootOf(document.activeElement);
  if (focused && roots.some((root) => root === focused)) {
    setActiveThreadRoot(focused, 'focus');
    return focused;
  }
  const fallback = roots[0];
  setActiveThreadRoot(fallback, roots.length === 1 ? 'single-pane' : 'fallback');
  return fallback;
}

function activePaneCue() {
  if (IS_POPOUT) return { direction: 'single', angle: null };
  const roots = threadRoots();
  const active = contextState.activeContext.paneRoot;
  const centerCue = paneCueForTrack({ direction: 'single', angle: null }, CHIP_HEIGHT);
  if (roots.length < 2 || !active?.isConnected) return centerCue;
  const activeRect = visibleRect(active);
  if (!activeRect) return centerCue;
  const rects = roots.map(visibleRect).filter(Boolean);
  if (rects.length < 2) return centerCue;
  const bounds = {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
  const offsetX =
    (activeRect.left + activeRect.width / 2 - (bounds.left + boundsWidth / 2)) / (boundsWidth / 2);
  const offsetY =
    (activeRect.top + activeRect.height / 2 - (bounds.top + boundsHeight / 2)) / (boundsHeight / 2);
  if (Math.abs(offsetX) < 0.01 && Math.abs(offsetY) < 0.01) return centerCue;
  const angle = Math.atan2(offsetY, offsetX);
  const direction =
    Math.abs(offsetX) >= Math.abs(offsetY)
      ? offsetX < 0
        ? 'left'
        : 'right'
      : offsetY < 0
        ? 'top'
        : 'bottom';
  return paneCueForTrack({ direction, angle }, CHIP_HEIGHT);
}

function paneCueForTrack(paneCue, trackHeight = CHIP_HEIGHT) {
  if (paneCue.direction === 'single' || !Number.isFinite(paneCue.angle)) {
    return { direction: 'single', angle: null, x: CHIP_WIDTH / 2, y: trackHeight / 2 };
  }
  const point = capsuleBoundaryPoint(paneCue.angle, CHIP_WIDTH, trackHeight);
  return {
    direction: paneCue.direction,
    angle: paneCue.angle,
    x: point.x,
    y: point.y,
  };
}

function capsuleBoundaryPoint(angle, width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = halfHeight;
  const innerHalfWidth = Math.max(0, halfWidth - radius);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  let inside = 0;
  let outside = Math.hypot(halfWidth, halfHeight) + radius;
  for (let index = 0; index < 24; index += 1) {
    const distance = (inside + outside) / 2;
    const x = Math.abs(cosine * distance) - innerHalfWidth;
    const y = Math.abs(sine * distance);
    const outsideX = Math.max(x, 0);
    const outsideY = Math.max(y, 0);
    const signedDistance = Math.hypot(outsideX, outsideY) + Math.min(Math.max(x, y), 0) - radius;
    if (signedDistance <= 0) inside = distance;
    else outside = distance;
  }
  return {
    x: Math.round((halfWidth + cosine * inside) * 10) / 10,
    y: Math.round((halfHeight + sine * inside) * 10) / 10,
  };
}

function chatRoot() {
  return resolveActiveThreadRoot();
}

function elementCenter(rect) {
  if (!rect) return { x: 0, y: 0 };
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function horizontalOverlapRatio(left, right) {
  if (!left || !right) return 0;
  const overlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  return overlap / Math.max(1, Math.min(left.width, right.width));
}

function ignoredComposerContainer(node, targetRoot = null) {
  if (!(node instanceof Element)) return true;
  if (shellState.root?.contains(node)) return true;
  const activeRoot = targetRoot || chatRoot();
  const surface = foregroundSurface();
  const allowedDialog = surface?.thread === activeRoot ? surface.dialog : null;
  if (surface && (!allowedDialog || !allowedDialog.contains(node))) return true;
  const blockedAncestor = node.closest(
    [
      `[${ROOT_ATTR}="true"]`,
      '[data-codex-buddy-dock]',
      'nav',
      "[role='dialog']",
      "[aria-modal='true']",
      "[role='menu']",
      "[role='listbox']",
    ].join(','),
  );
  if (blockedAncestor && blockedAncestor !== allowedDialog) return true;

  if (activeRoot?.contains(node)) return false;

  const nodeAside = node.closest('aside');
  if (!nodeAside) return false;

  const activeAside = activeRoot?.closest('aside');
  return !(activeAside && nodeAside === activeAside);
}

function composerCandidateScore(node, rootRect, targetRoot = null) {
  const rect = visibleRect(node);
  if (!rect || !rootRect) return -Infinity;
  if (rect.width < 120 || rect.height < 20) return -Infinity;
  if (rect.bottom < window.innerHeight * 0.35) return -Infinity;
  if (ignoredComposerContainer(node, targetRoot)) return -Infinity;

  const overlap = horizontalOverlapRatio(rect, rootRect);
  const center = elementCenter(rect);
  const rootCenter = elementCenter(rootRect);
  const centerDrift = Math.abs(center.x - rootCenter.x) / Math.max(1, rootRect.width);
  const centerInsideRoot = center.x >= rootRect.left - 24 && center.x <= rootRect.right + 24;
  if (overlap < 0.45 && !centerInsideRoot) return -Infinity;

  const lowerScreen = rect.bottom / Math.max(1, window.innerHeight);
  const widthMatch =
    Math.min(rect.width, rootRect.width) / Math.max(1, Math.max(rect.width, rootRect.width));
  return overlap * 100 + lowerScreen * 24 + widthMatch * 18 - centerDrift * 48;
}

function mainComposerCandidate(candidates, targetRoot = null) {
  const root = targetRoot || chatRoot();
  const rootRect = visibleRect(root);
  const ranked = candidates
    .map((node) => ({ node, score: composerCandidateScore(node, rootRect, root) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score);
  if (ranked[0]?.node) return ranked[0].node;

  if (targetRoot || threadRoots().length > 1) return null;

  const fallback = candidates
    .map((node) => ({ node, score: globalComposerCandidateScore(node) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score)[0];
  if (fallback?.node) {
    pushDiagnostic('composer:global-fallback', {
      score: fallback.score,
      targetTag: fallback.node.tagName || '',
      targetRole: fallback.node.getAttribute?.('role') || '',
      targetClass: String(fallback.node.className || '').slice(0, 120),
      targetRect: rectSummary(fallback.node),
    });
  }
  return fallback?.node || null;
}

function globalComposerCandidateScore(node) {
  const rect = visibleRect(node);
  if (!rect || rect.width < 120 || rect.height < 20) return -Infinity;
  if (rect.bottom < window.innerHeight * 0.35 || ignoredComposerContainer(node)) return -Infinity;

  const label = normalizeText(
    [
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('placeholder'),
      node.getAttribute?.('data-placeholder'),
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (/search|find|查找|搜索/i.test(label)) return -Infinity;

  let score = (rect.bottom / Math.max(1, window.innerHeight)) * 40;
  score += Math.min(rect.width / Math.max(1, window.innerWidth), 1) * 20;
  if (node.matches?.('div.ProseMirror')) score += 160;
  if (node instanceof HTMLTextAreaElement) score += 130;
  if (node.getAttribute?.('role') === 'textbox') score += 90;
  if (node.isContentEditable) score += 70;
  if (/message|prompt|send|ask|消息|输入|提问|发送/i.test(label)) score += 60;
  return score;
}

// 部分宿主将输入框放在消息滚动区旁边；只扩展到恰好包含此聊天的最近父容器。
function composerScope(root) {
  if (!(root instanceof Element)) return document;
  const selector = '.ProseMirror,[data-codex-composer],textarea';
  let scope = root;
  while (scope && scope !== document.body) {
    if (scope !== root && scope.querySelectorAll('.thread-scroll-container').length !== 1) break;
    if (scope.querySelector(selector)) return scope;
    scope = scope.parentElement;
  }
  return root;
}

function composerCandidates(targetRoot = null) {
  const surface = foregroundSurface();
  const scope =
    surface?.thread === targetRoot ? surface.content || surface.dialog : composerScope(targetRoot);
  return Array.from(
    scope.querySelectorAll(
      ['textarea', "[contenteditable='true']", "[role='textbox']", 'div.ProseMirror'].join(','),
    ),
  ).filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 20) return false;
    if (rect.bottom < window.innerHeight * 0.35) return false;
    const owner = threadRootOf(node);
    if (targetRoot && owner && owner !== targetRoot) return false;
    if (ignoredComposerContainer(node, targetRoot)) return false;
    return true;
  });
}

function buttonLabel(node) {
  return normalizeText(
    node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '',
  );
}

function sendButtonLabel(label) {
  return /^(send message|send|add to queue|发送消息|发送|提交|加入队列|添加到队列)$/i.test(label);
}

function stopButtonLabel(label) {
  return /^(stop|停止)$/i.test(label);
}

function iconPathData(node) {
  return Array.from(node.querySelectorAll?.('svg path') || [])
    .map((path) => path.getAttribute('d') || '')
    .join('\n');
}

function stopButtonIcon(node) {
  const data = iconPathData(node);
  return /H14\.25C14\.9404 4\.5 15\.5 5\.05964 15\.5 5\.75V14\.25C15\.5 14\.9404/.test(data);
}

function stopButton(node) {
  return stopButtonLabel(buttonLabel(node)) || stopButtonIcon(node);
}

function disabledButton(node) {
  return Boolean(
    node.disabled ||
    node.getAttribute('aria-disabled') === 'true' ||
    node.dataset.disabled === 'true',
  );
}

function submitButtonCandidate(button, containerRect) {
  const label = buttonLabel(button);
  if (stopButton(button)) return false;
  if (sendButtonLabel(label)) return true;
  if (label) return false;

  const rect = visibleRect(button);
  if (!rect || !containerRect) return false;
  const className = String(button.className || '');
  const compactIcon =
    rect.width >= 24 && rect.width <= 48 && rect.height >= 24 && rect.height <= 48;
  const composerIcon =
    className.includes('size-token-button-composer') || className.includes('bg-token-foreground');
  const lowerRight =
    rect.left > containerRect.left + containerRect.width * 0.58 &&
    rect.top > containerRect.top + containerRect.height * 0.42;
  return compactIcon && composerIcon && lowerRight;
}

function nearbySubmitButton(target, options = {}) {
  const includeDisabled = options.includeDisabled === true;
  const targetRoot = options.root || threadRootOf(target);
  let current = target?.parentElement || null;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    if (current === document.body || current === document.documentElement) break;
    if (shellState.root?.contains(current)) return null;
    if (targetRoot && !targetRoot.contains(current)) break;
    const buttons = Array.from(current.querySelectorAll("button,[role='button']")).filter(
      (node) =>
        node instanceof HTMLElement &&
        !shellState.root?.contains(node) &&
        visibleElement(node) &&
        (includeDisabled || !disabledButton(node)),
    );

    const labeled = buttons.find((button) => sendButtonLabel(buttonLabel(button)));
    if (labeled) return labeled;

    const rect = visibleRect(current);
    if (rect && rect.width > 260 && rect.height > 52) {
      const lowerRight = buttons
        .filter((button) => !stopButton(button))
        .filter((button) => submitButtonCandidate(button, rect))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
      if (lowerRight.length) return lowerRight[0];
    }
  }
  return null;
}

function chatSurfaceReady() {
  if (!chatRoot()) return false;
  return !chatBusy();
}

function chatBusy() {
  if (IS_POPOUT) return contextState.scanBusy;
  const root = chatRoot();
  if (!root) return false;

  return Array.from(root.querySelectorAll("button,[role='button']")).some((node) => {
    if (!visibleElement(node)) return false;
    const label = normalizeText(node.getAttribute('aria-label') || node.textContent || '');
    return /^(停止|stop)$/i.test(label);
  });
}

function setScanStatus(status, details = {}) {
  const key = `${status}:${JSON.stringify(details)}`;
  contextState.scanStatus = status;
  contextState.scanBusy = status === 'manual-refresh-busy' || Boolean(details.busy);
  if (contextState.lastScanStatus === key) return false;
  contextState.lastScanStatus = key;
  pushDiagnostic(`scan:${status}`, details);
  return true;
}

function composerBusy(target, options = {}) {
  const targetRoot = options.root || threadRootOf(target);
  let hasStopButton = false;
  let current = target?.parentElement || null;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    if (current === document.body || current === document.documentElement) break;
    if (shellState.root?.contains(current)) return false;
    if (targetRoot && !targetRoot.contains(current)) break;
    const buttons = Array.from(current.querySelectorAll("button,[role='button']")).filter(
      (node) => node instanceof HTMLElement && visibleElement(node),
    );
    if (buttons.some((node) => !disabledButton(node) && sendButtonLabel(buttonLabel(node))))
      return false;
    if (buttons.some((node) => stopButton(node))) hasStopButton = true;
  }
  return hasStopButton;
}

function messageCandidates() {
  const root = chatRoot();
  if (!root) return [];

  const selectors = [
    '[data-message-author-role]',
    '[data-thread-find-target]',
    "[data-testid*='message' i]",
    "[data-test-id*='message' i]",
    'article',
  ].join(',');

  return Array.from(root.querySelectorAll(selectors))
    .map((node) => ({
      node,
      role: roleFromElement(node),
      text: elementText(node),
    }))
    .filter((item) => item.text.length > 8);
}

function actionButton(node) {
  const label = normalizeText(node.getAttribute('aria-label') || node.textContent || '');
  return /^(复制|喜欢|不喜欢|从此处开始分叉|挂钩|copy|like|dislike|fork)/i.test(label);
}

function classTokenMatch(node, token) {
  return (
    node instanceof Element &&
    Array.from(node.classList || []).some((className) => className === token)
  );
}

function assistantBubbleCandidates() {
  const root = chatRoot();
  if (!root) return [];

  return Array.from(root.querySelectorAll('.group.flex.min-w-0.flex-col'))
    .filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (shellState.root?.contains(node)) return false;
      if (classTokenMatch(node, 'items-end')) return false;
      const text = directText(node);
      if (text.length < 24) return false;
      return true;
    })
    .map((node) => ({
      node,
      role: 'assistant',
      text: elementText(node),
    }));
}

function roleFromMessageLabel(label) {
  const text = normalizeText(label?.textContent || '');
  if (/^(你说|you said|user)\s*[:：]?$/i.test(text)) return 'user';
  if (/^(ChatGPT|assistant|codex)(?:\s+说|\s+said)?\s*[:：]?$/i.test(text)) return 'assistant';
  return '';
}

function labeledMessageContainer(turn, role) {
  if (!(turn instanceof Element)) return null;
  const labels = Array.from(turn.querySelectorAll('h4.sr-only'));
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index];
    if (roleFromMessageLabel(label) !== role) continue;
    const container = label.parentElement;
    if (!(container instanceof Element)) continue;
    if (role === 'user' && !classTokenMatch(container, 'items-end')) continue;
    if (role === 'assistant' && !classTokenMatch(container, 'group')) continue;
    return container;
  }
  return null;
}

function labeledMessageText(container) {
  if (!(container instanceof Element)) return '';
  const clone = stripOwnUi(container.cloneNode(true));
  clone
    .querySelectorAll?.("h4.sr-only,button,[role='button'],svg")
    .forEach((item) => item.remove());
  return normalizeText(clone.textContent || '');
}

function conversationTurn(turn) {
  if (!(turn instanceof Element)) return null;
  const turnKey = normalizeText(turn.getAttribute('data-content-search-turn-key') || '');
  const userNode = labeledMessageContainer(turn, 'user');
  const assistantNode = labeledMessageContainer(turn, 'assistant');
  const userText = labeledMessageText(userNode);
  const assistantText = labeledMessageText(assistantNode);
  return {
    node: turn,
    turnKey,
    userText,
    assistantMounted: Boolean(assistantNode),
    assistantMessage:
      assistantText.length > 8
        ? {
            node: assistantNode,
            role: 'assistant',
            text: assistantText,
            turnKey,
          }
        : null,
  };
}

function conversationTurns() {
  const root = chatRoot();
  if (!root) return [];
  return Array.from(root.querySelectorAll(CONVERSATION_TURN_SELECTOR))
    .map(conversationTurn)
    .filter(Boolean);
}

function compareConversationTurnKeys(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function latestConversationTurnByKey(turns) {
  return turns.reduce((latest, turn) => {
    if (!turn?.turnKey) return latest;
    if (!latest || compareConversationTurnKeys(latest.turnKey, turn.turnKey) < 0) return turn;
    return latest;
  }, null);
}

function nextLatestTurnAnchor(previous, turns, sessionId) {
  const mounted = latestConversationTurnByKey(turns);
  if (!mounted) return previous;
  const sameSession = Boolean(sessionId) && previous?.sessionId === sessionId;
  if (sameSession && compareConversationTurnKeys(mounted.turnKey, previous.turnKey) < 0)
    return previous;

  const sameTurn = sameSession && previous?.turnKey === mounted.turnKey;
  const assistant = mounted.assistantMessage;
  return {
    sessionId,
    turnKey: mounted.turnKey,
    userText: mounted.userText || (sameTurn ? previous.userText : ''),
    // An empty mounted answer invalidates old text; only virtualized/unmounted content keeps its anchor.
    assistantText:
      assistant?.text || (sameTurn && !mounted.assistantMounted ? previous.assistantText : ''),
    turnNode: mounted.node || (sameTurn ? previous.turnNode : null),
    assistantNode:
      assistant?.node || (sameTurn && !mounted.assistantMounted ? previous.assistantNode : null),
  };
}

function assistantMessageFromTurnAnchor(anchor) {
  if (!anchor?.assistantText || anchor.assistantText.length <= 8) return null;
  return {
    node: anchor.assistantNode,
    role: 'assistant',
    text: anchor.assistantText,
    turnKey: anchor.turnKey,
    userText: anchor.userText,
    turnNode: anchor.turnNode,
  };
}

function updateLatestTurnAnchor(turns) {
  contextState.latestTurnAnchor = nextLatestTurnAnchor(
    contextState.latestTurnAnchor,
    turns,
    contextState.activeContext.sessionId,
  );
  return contextState.latestTurnAnchor;
}

function latestMessageByDocumentOrder(candidates) {
  return (
    candidates
      .filter((item) => item?.node instanceof Node && item.text?.length > 8)
      .sort((left, right) => {
        if (left.node === right.node) return 0;
        const position = left.node.compareDocumentPosition(right.node);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (left.node.contains(right.node)) return -1;
        if (right.node.contains(left.node)) return 1;
        return 0;
      })
      .at(-1) || null
  );
}

function actionRowForMessage(root) {
  const buttons = Array.from(root.querySelectorAll("button,[role='button']")).filter(actionButton);
  for (const button of buttons) {
    let current = button.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const rect = visibleRect(current);
      if (!rect || rect.height > 96) continue;
      const count = Array.from(current.querySelectorAll("button,[role='button']")).filter(
        actionButton,
      ).length;
      if (count >= 3) return current;
    }
  }
  return null;
}

function containsActionRow(node) {
  return Boolean(node && actionRowForMessage(node));
}

function assistantContainerForActionRow(actionRow) {
  let current = actionRow?.parentElement;

  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    const text = directText(current);
    if (text.length < 24) continue;
    if (!containsActionRow(current)) continue;
    return current;
  }

  return null;
}

function allActionRows() {
  const root = chatRoot();
  if (!root) return [];

  const rows = [];
  const seen = new Set();
  const buttons = Array.from(root.querySelectorAll("button,[role='button']")).filter(actionButton);

  for (const button of buttons) {
    let current = button.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (seen.has(current)) continue;
      if (!visibleElement(current)) continue;
      const rect = visibleRect(current);
      if (!rect || rect.height > 96) continue;
      const count = Array.from(current.querySelectorAll("button,[role='button']")).filter(
        actionButton,
      ).length;
      if (count < 3) continue;
      seen.add(current);
      rows.push(current);
      break;
    }
  }

  return rows;
}

function findLatestAssistantMessage() {
  const turns = conversationTurns();
  if (turns.length || contextState.latestTurnAnchor) {
    return assistantMessageFromTurnAnchor(updateLatestTurnAnchor(turns));
  }

  const candidates = [];
  const rows = allActionRows();
  for (let index = 0; index < rows.length; index += 1) {
    const node = assistantContainerForActionRow(rows[index]);
    const text = elementText(node);
    if (text.length > 8) candidates.push({ node, role: 'assistant', text });
  }

  candidates.push(...messageCandidates().filter((item) => item.role === 'assistant'));
  candidates.push(...assistantBubbleCandidates());
  return latestMessageByDocumentOrder(candidates);
}

function findPreviousUserText(message) {
  const snapshotUserText = normalizeText(message?.userText || '');
  if (snapshotUserText) return snapshotUserText;

  const assistantNode = message?.node || message;
  const turn = assistantNode?.closest?.(CONVERSATION_TURN_SELECTOR);
  const turnUserText = conversationTurn(turn)?.userText || '';
  if (turnUserText) return turnUserText;

  const candidates = messageCandidates();
  const before = candidates.filter((item) => {
    if (item.node === assistantNode) return false;
    if (!(item.node instanceof Node) || !(assistantNode instanceof Node)) return false;
    return Boolean(
      item.node.compareDocumentPosition(assistantNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  for (let cursor = before.length - 1; cursor >= 0; cursor -= 1) {
    const item = before[cursor];
    if (item.role === 'user') return normalizeText(item.text);
    if (/^(user|you)\b/i.test(item.text)) return normalizeText(item.text);
  }
  return '';
}

export {
  bindingSourceReady,
  chatBindingStatus,
  changeChatBinding,
  activePaneCue,
  assistantMessageId,
  buttonLabel,
  capsuleBoundaryPoint,
  chatBusy,
  chatRoot,
  chatSurfaceReady,
  composerBusy,
  composerCandidates,
  contextMatches,
  contextSnapshot,
  disabledButton,
  findLatestAssistantMessage,
  findPreviousUserText,
  iconPathData,
  installContextTracking,
  labeledMessageContainer,
  mainComposerCandidate,
  nearbySubmitButton,
  paneCueForTrack,
  removeContextTracking,
  rootForContext,
  setScanStatus,
};
