/* [INPUT]: Buddy 已识别的聊天根节点、一问一答与受限后台请求。
 * [OUTPUT]: 术语加粗标注、悬停释义与按聊天身份定位已确认范围；销毁恢复自有高亮，不改变宿主正文。
 * [POS]: 术语显示旁路；不读取输入草稿、不向主聊天写内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { readTypography } from '../codex/typography.js';
import { textIndex, semanticSpans, scrollToRange } from './text-ranges.js';
import { createMatcher } from './matcher.js';
import { createTermPopover } from './popover.js';
import { inheritedAppearance } from './appearance.js';
const HIGHLIGHT = 'codex-buddy-terms';
export function installTerminology({ request, getRoot, getExchange, isBusy }) {
  window.__codexBuddyTerminology?.destroy();
  let alive = true,
    root = null,
    observer = null,
    scanTimer = 0,
    hoverTimer = 0,
    closeTimer = 0,
    frame = 0;
  let state = {
    preferences: { enabled: true, cardStyle: 'plain', mastered: [], semantic: false },
    entries: [],
  };
  let annotations = [],
    locations = [],
    locateTimer = 0,
    semanticMatches = [],
    active = null,
    pending = '',
    lastAnalysis = '',
    lastText = '',
    loading = false;
  let phase = 'waiting',
    lastReport = '',
    reportQueue = Promise.resolve(),
    retryAt = 0,
    failures = 0;
  const cache = new Map();
  const ACTIVE = HIGHLIGHT + '-active';
  const LOCATED = HIGHLIGHT + '-located';
  let point = { x: 0, y: 0 },
    appearanceKey = '';
  const popup = createTermPopover({
    onEnter: () => clearTimeout(closeTimer),
    onLeave: () => {
      closeTimer = window.setTimeout(() => hide(), 170);
    },
    onClose: () => {
      active = null;
      CSS.highlights?.delete(ACTIVE);
    },
  });
  const highlightStyle = document.createElement('style');
  highlightStyle.dataset.buddyTerms = 'true';
  document.head.append(highlightStyle);
  function appearance() {
    const panel =
      /** @type {{ __companionFloatingPanel?: { panelAppearance?: () => import('../surfaces/theme/appearance').Appearance } }} */ (
        window
      );
    return panel.__companionFloatingPanel?.panelAppearance?.() || inheritedAppearance();
  }
  function updateTheme() {
    const theme = appearance(),
      key = JSON.stringify([theme, active && typography(active)]);
    if (key === appearanceKey) return;
    appearanceKey = key;
    const supplied = theme.colors?.accent;
    const accent = supplied && CSS.supports('color', supplied) ? supplied : 'currentColor';
    const dark =
      theme.theme === 'dark' ||
      (!theme.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    // 暗色下提亮标注并减少下划线透明度，避免深色强调色融入背景；正文颜色保持继承。
    const mark = dark ? `color-mix(in srgb,${accent} 70%,#fff)` : accent;
    // Highlight 不支持 font-weight；同色、无模糊描粗保留原文字节点和排版。
    highlightStyle.textContent = `::highlight(${HIGHLIGHT}),::highlight(${ACTIVE}),::highlight(${LOCATED}){text-shadow:-.45px 0 0 currentColor,.45px 0 0 currentColor}::highlight(${HIGHLIGHT}){background-color:color-mix(in srgb,${mark} ${dark ? 18 : 11}%,transparent);text-decoration:underline;text-decoration-color:color-mix(in srgb,${mark} ${dark ? 86 : 58}%,transparent);text-decoration-thickness:2.5px;text-underline-offset:3px}::highlight(${ACTIVE}),::highlight(${LOCATED}){background-color:color-mix(in srgb,${mark} ${dark ? 28 : 19}%,transparent);text-decoration-color:color-mix(in srgb,${mark} ${dark ? 100 : 88}%,transparent)}`;
    if (active) popup.update(active.term, cardOptions(active));
  }
  const api = async (payload, path = '/terminology') => {
    const value = await request(path, payload);
    if (value.error) throw Error(value.error);
    return value;
  };
  function hide(immediate = false) {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    return popup.hide(immediate);
  }
  function clear() {
    void hide(true);
    annotations = [];
    locations = [];
    clearTimeout(locateTimer);
    CSS.highlights?.delete(LOCATED);
    CSS.highlights?.delete(HIGHLIGHT);
    CSS.highlights?.delete(ACTIVE);
  }
  function valid(a) {
    return (
      alive &&
      state.preferences.enabled &&
      root === getRoot() &&
      root?.contains(a.range.startContainer) &&
      a.range.toString() === a.text
    );
  }
  function typography(a) {
    if (window.__codexBuddyTypography) return window.__codexBuddyTypography.resolved();
    const source = a?.range.startContainer;
    return readTypography(
      source ? (source.nodeType === Node.ELEMENT_NODE ? source : source.parentElement) : root,
    );
  }
  function cardOptions(a) {
    return {
      preferences: state.preferences,
      appearance: { ...appearance(), typography: typography(a) },
      favorite: state.preferences.favorites?.includes(a.term.id),
      mastered: state.preferences.mastered.includes(a.term.id),
      onFavorite: async (id, value) => {
        state = await api({ action: value ? 'favorite' : 'unfavorite', id });
      },
      onMaster: async (id, value) => {
        state = await api({ action: value ? 'master' : 'restore', id });
        window.setTimeout(() => {
          if (!alive) return;
          if (popup.termId === id)
            void hide().then((closed) => {
              if (alive && closed) scan();
            });
          else scan();
        }, 160);
      },
    };
  }
  function show(a, keyboard = false) {
    if (!valid(a)) return void hide(true);
    clearTimeout(closeTimer);
    active = a;
    updateTheme();
    if (CSS.highlights && typeof Highlight !== 'undefined') {
      const highlight = new Highlight(a.range);
      highlight.priority = 1;
      CSS.highlights.set(ACTIVE, highlight);
    }
    popup.show(
      a.term,
      () => {
        if (!valid(a)) return null;
        const rects = [...a.range.getClientRects()].filter((r) => r.width && r.height);
        const line =
          rects.find(
            (r) =>
              point.y >= r.top && point.y <= r.bottom && point.x >= r.left && point.x <= r.right,
          ) || rects[0];
        if (!line || keyboard) return line;
        return new DOMRect(
          Math.max(line.left, Math.min(point.x, line.right)),
          line.top,
          1,
          line.height,
        );
      },
      { ...cardOptions(a), keyboard },
    );
  }
  function contextKey() {
    return root && root === getRoot() ? String(getExchange()?.sessionId || '') : '';
  }
  function report(ids = []) {
    const payload = {
      action: 'observe',
      context: contextKey(),
      ids: [...new Set(ids)].sort(),
      phase: state.preferences.enabled ? phase : 'disabled',
      contextVerified: !!state.preferences.semantic,
      message: apiObject.lastError || '',
    };
    const signature = JSON.stringify(payload);
    if (signature === lastReport) return;
    lastReport = signature;
    reportQueue = reportQueue
      .catch(() => {})
      .then(async () => {
        if (!alive || payload.context !== contextKey()) return;
        await api(payload);
      })
      .catch(() => {
        lastReport = '';
      });
  }
  function scan() {
    clearTimeout(scanTimer);
    if (!alive) return;
    clear();
    if (!root || root !== getRoot() || !state.preferences.enabled) {
      report();
      return;
    }
    const index = textIndex(root),
      terms = new Map(state.entries.map((t) => [t.id, t]));
    // 语义模式下字面命中只作候选，绝不盖过已核对的词义。
    const hits = state.preferences.semantic ? [] : createMatcher(state.entries)(index.text);
    const confirmed = state.preferences.semantic
      ? [...cache.values()]
          .filter((entry) => entry.context === contextKey())
          .flatMap((entry) => entry.matches)
      : [];
    for (const hint of confirmed) {
      const term = terms.get(hint.id);
      if (!term) continue;
      for (const span of semanticSpans(index.text, hint.quote, term)) {
        if (!hits.some((h) => h.start < span.end && h.end > span.start))
          hits.push({ ...span, term, semantic: true });
      }
    }
    const involved = hits.map((h) => h.term.id);
    // 定位保留所有已确认范围，已掌握或超过绘制上限的词条仍可显式跳转。
    for (const h of hits.sort((a, b) => b.start - a.start)) {
      const range = index.range(h.start, h.end);
      if (range) locations.push({ ...h, range, text: range.toString() });
    }
    annotations = locations
      .filter((h) => !state.preferences.mastered.includes(h.term.id))
      .slice(0, 400);
    if (CSS.highlights && typeof Highlight !== 'undefined')
      CSS.highlights.set(HIGHLIGHT, new Highlight(...annotations.map((a) => a.range)));
    report(involved);
  }
  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 500);
  }
  async function refresh() {
    if (loading || !alive) return;
    loading = true;
    try {
      const value = await api({ action: 'state' });
      if (!alive) return;
      const entriesChanged = JSON.stringify(value.entries) !== JSON.stringify(state.entries);
      const changed =
        JSON.stringify([value.preferences, value.entries]) !==
        JSON.stringify([state.preferences, state.entries]);
      const toggled =
        value.preferences.semantic !== state.preferences.semantic ||
        value.preferences.enabled !== state.preferences.enabled;
      state = value;
      if (changed) {
        if (toggled || entriesChanged) {
          cache.clear();
          pending = '';
          lastAnalysis = '';
          failures = 0;
        }
        scan();
      }
    } catch (e) {
      apiObject.lastError = e.message;
    } finally {
      loading = false;
    }
  }
  function identity() {
    if (!root || getRoot() !== root) return null;
    const exchange = getExchange();
    if (!exchange?.answer || (isBusy() && !exchange.complete)) return null;
    return {
      ...exchange,
      key: JSON.stringify([exchange.sessionId, exchange.question, exchange.answer]),
    };
  }
  async function analyze() {
    if (!state.preferences.enabled || !state.preferences.semantic || pending) return;
    const exchange = identity();
    if (!exchange || exchange.key === lastAnalysis || Date.now() < retryAt) return;
    if (cache.has(exchange.key) && cache.get(exchange.key).complete !== false) {
      semanticMatches = cache.get(exchange.key).matches;
      lastAnalysis = exchange.key;
      phase = 'ready';
      scan();
      return;
    }
    const id = `terms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pending = id;
    lastAnalysis = exchange.key;
    const originalRoot = root;
    phase = 'analyzing';
    apiObject.lastError = '';
    scan();
    try {
      const result = await api(
        {
          requestId: id,
          title: exchange.title,
          question: exchange.question,
          answer: exchange.answer,
        },
        '/terminology/analyze',
      );
      if (!alive || pending !== id || root !== originalRoot || identity()?.key !== exchange.key)
        return;
      semanticMatches = result.matches || [];
      cache.set(exchange.key, { context: exchange.sessionId, matches: semanticMatches });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      failures = 0;
      retryAt = 0;
      phase = result.warning ? 'error' : 'ready';
      apiObject.lastError = result.warning || '';
      const updated = await api({ action: 'state' });
      if (!alive || pending !== id) return;
      state = updated;
      scan();
    } catch (e) {
      if (alive && pending === id) {
        apiObject.lastError = e.message;
        phase = 'error';
        failures++;
        if (failures < 3) {
          lastAnalysis = '';
          retryAt = Date.now() + 30000;
        }
        scan();
      }
    } finally {
      if (pending === id) pending = '';
    }
  }
  function tick() {
    if (!alive) return;
    updateTheme();
    const next = getRoot();
    if (next !== root) {
      observer?.disconnect();
      root = next;
      semanticMatches = [];
      pending = '';
      lastAnalysis = '';
      lastText = '';
      failures = 0;
      retryAt = 0;
      phase = 'waiting';
      lastReport = '';
      clear();
      report();
      if (root) {
        observer = new MutationObserver(schedule);
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        schedule();
      }
    }
    const exchange = identity();
    const key = exchange?.key || '';
    if (lastText !== key) {
      lastText = key;
      pending = '';
      semanticMatches = [];
      phase = exchange ? 'ready' : 'waiting';
      failures = 0;
      retryAt = 0;
      schedule();
    } else if (key) void analyze();
  }
  function move(e) {
    if (popup.contains(e)) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const hit = annotations.find(
        (a) =>
          valid(a) &&
          [...a.range.getClientRects()].some(
            (r) =>
              e.clientX >= r.left - 3 &&
              e.clientX <= r.right + 3 &&
              e.clientY >= r.top &&
              e.clientY <= r.bottom,
          ),
      );
      if (hit) point = { x: e.clientX, y: e.clientY };
      if (hit === active) {
        if (hit) popup.reposition();
        clearTimeout(closeTimer);
        return;
      }
      clearTimeout(hoverTimer);
      if (hit) {
        clearTimeout(closeTimer);
        hoverTimer = window.setTimeout(() => show(hit), 60);
      } else if (active) {
        clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => hide(), 170);
      }
    });
  }
  function keydown(e) {
    if (e.key === 'Escape' && active) {
      hide();
      return;
    }
    if (e.altKey && e.shiftKey && e.code === 'KeyT') {
      const hit = annotations.find(
        (a) =>
          valid(a) &&
          a.range.getBoundingClientRect().bottom > 0 &&
          a.range.getBoundingClientRect().top < innerHeight,
      );
      if (hit) {
        e.preventDefault();
        show(hit, true);
      }
    }
  }
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('keydown', keydown);
  const changed = () => void refresh();
  document.addEventListener('buddy-terminology-change', changed);
  const ticker = setInterval(tick, 1000),
    poll = setInterval(refresh, 15000);
  const apiObject = {
    lastError: '',
    contextKey,
    locate(id, context) {
      if (!alive || !context || context !== contextKey() || !state.preferences.enabled)
        return false;
      // 重新采集当前根内的范围，拒绝重绘失效节点和其他聊天的旧请求。
      scan();
      const hit = locations.find((a) => a.term.id === id && valid(a));
      if (!hit || context !== contextKey() || !scrollToRange(hit.range)) return false;
      if (CSS.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set(LOCATED, new Highlight(hit.range));
        locateTimer = window.setTimeout(() => CSS.highlights.delete(LOCATED), 1800);
      }
      return true;
    },
    typography: () => (root?.isConnected ? typography() : null),
    verify: (id) => alive && pending === id && identity()?.key === lastAnalysis,
    refresh,
    async progress(id, matches) {
      if (!alive || pending !== id || identity()?.key !== lastAnalysis) return false;
      const updated = await api({ action: 'state' });
      if (
        !alive ||
        pending !== id ||
        identity()?.key !== lastAnalysis ||
        !updated.preferences.enabled ||
        !updated.preferences.semantic
      )
        return false;
      state = updated;
      semanticMatches = matches;
      cache.set(lastAnalysis, { context: contextKey(), matches, complete: false });
      scan();
      return true;
    },
    destroy() {
      alive = false;
      pending = '';
      clear();
      observer?.disconnect();
      clearTimeout(scanTimer);
      cancelAnimationFrame(frame);
      clearInterval(ticker);
      clearInterval(poll);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('buddy-terminology-change', changed);
      popup.destroy();
      highlightStyle.remove();
      if (window.__codexBuddyTerminology === apiObject) delete window.__codexBuddyTerminology;
    },
  };
  window.__codexBuddyTerminology = apiObject;
  tick();
  void refresh();
  return apiObject;
}
