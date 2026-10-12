/* [INPUT]: Buddy 已识别的聊天根节点、一问一答与受限后台请求。
 * [OUTPUT]: 细下划线、悬停圈注与释义卡；销毁恢复自有高亮，不改变宿主正文。
 * [POS]: 术语显示旁路；不读取输入草稿、不向主聊天写内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { textIndex, semanticSpans } from './text-ranges.js';
import { createMatcher } from './matcher.js';
import { cardStyles, createCard } from './card.js';
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
  const host = document.createElement('div');
  host.dataset.buddyTerms = 'true';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent =
    cardStyles +
    ':host{color-scheme:light dark}.popover{position:fixed;pointer-events:auto}.outline{position:fixed;box-sizing:border-box;outline:1px solid var(--term-muted,#888);border-radius:5px;pointer-events:none}.keyhint{position:fixed;left:-10000px}';
  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  const rings = document.createElement('div');
  shadow.append(style, rings, popover);
  document.documentElement.append(host);
  const highlightStyle = document.createElement('style');
  highlightStyle.dataset.buddyTerms = 'true';
  highlightStyle.textContent = `::highlight(${HIGHLIGHT}){text-decoration:underline;text-decoration-color:currentColor;text-decoration-thickness:1px;text-underline-offset:3px}`;
  document.head.append(highlightStyle);
  const api = async (payload, path = '/terminology') => {
    const value = await request(path, payload);
    if (value.error) throw Error(value.error);
    return value;
  };
  function hide() {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    active = null;
    popover.hidden = true;
    popover.replaceChildren();
    rings.replaceChildren();
  }
  function clear() {
    hide();
    annotations = [];
    CSS.highlights?.delete(HIGHLIGHT);
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
  function show(a, keyboard = false) {
    if (!valid(a)) return hide();
    hide();
    active = a;
    const dark =
      document.documentElement.classList.contains('dark') ||
      getComputedStyle(document.documentElement).colorScheme === 'dark';
    host.style.setProperty('--term-bg', dark ? '#242427' : '#ffffff');
    host.style.setProperty('--term-fg', dark ? '#efeff1' : '#25262b');
    host.style.setProperty('--term-muted', dark ? '#aaaab3' : '#74747f');
    host.style.setProperty('--term-border', dark ? '#424249' : '#dedee3');
    const rects = [...a.range.getClientRects()].filter((r) => r.width && r.height);
    if (!rects.length) return hide();
    for (const r of rects) {
      const ring = document.createElement('div');
      ring.className = 'outline';
      ring.style.cssText = `left:${r.left - 3}px;top:${r.top - 2}px;width:${r.width + 6}px;height:${r.height + 4}px`;
      rings.append(ring);
    }
    const card = createCard(a.term, {
      style: state.preferences.cardStyle,
      semantic: a.semantic,
      favorite: state.preferences.favorites?.includes(a.term.id),
      onFavorite: async (id, value) => {
        state = await api({ action: value ? 'favorite' : 'unfavorite', id });
      },
      onMaster: async (id) => {
        state = await api({ action: 'master', id });
        hide();
        scan();
      },
    });
    popover.append(card);
    popover.hidden = false;
    const anchor = rects[rects.length - 1],
      box = card.getBoundingClientRect();
    popover.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12))}px`;
    popover.style.top = `${Math.max(12, Math.min(anchor.bottom + 10, innerHeight - box.height - 12))}px`;
    if (anchor.bottom + box.height + 20 > innerHeight && rects[0].top > box.height + 20)
      popover.style.top = `${rects[0].top - box.height - 10}px`;
    if (keyboard) card.querySelector('button')?.focus();
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
    const hits = createMatcher(state.entries)(index.text);
    for (const hint of semanticMatches) {
      const term = terms.get(hint.id);
      if (!term) continue;
      for (const span of semanticSpans(index.text, hint.quote)) {
        if (!hits.some((h) => h.start < span.end && h.end > span.start))
          hits.push({ ...span, term, semantic: true });
      }
    }
    const involved = hits.map((h) => h.term.id);
    // 仅限制屏幕绘制量，当前聊天词条集合仍完整收集，已掌握不再绘制。
    for (const h of hits
      .filter((h) => !state.preferences.mastered.includes(h.term.id))
      .sort((a, b) => b.start - a.start)
      .slice(0, 400)) {
      const range = index.range(h.start, h.end);
      if (range) annotations.push({ ...h, range, text: range.toString() });
    }
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
      const changed =
        JSON.stringify([value.preferences, value.entries]) !==
        JSON.stringify([state.preferences, state.entries]);
      const toggled =
        value.preferences.semantic !== state.preferences.semantic ||
        value.preferences.enabled !== state.preferences.enabled;
      state = value;
      if (changed) {
        if (toggled) {
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
      let phase = 'waiting',
        lastReport = '',
        reportQueue = Promise.resolve(),
        retryAt = 0,
        failures = 0;
      const cache = new Map();
    }
  }
  function identity() {
    if (isBusy() || !root || getRoot() !== root) return null;
    const exchange = getExchange();
    if (!exchange?.answer) return null;
    return {
      ...exchange,
      key: JSON.stringify([exchange.sessionId, exchange.question, exchange.answer]),
    };
  }
  async function analyze() {
    if (!state.preferences.enabled || !state.preferences.semantic || pending) return;
    const exchange = identity();
    if (!exchange || exchange.key === lastAnalysis || Date.now() < retryAt) return;
    if (cache.has(exchange.key)) {
      semanticMatches = cache.get(exchange.key);
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
      cache.set(exchange.key, semanticMatches);
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
      phase = isBusy() ? 'waiting' : 'ready';
      failures = 0;
      retryAt = 0;
      schedule();
    } else if (key) void analyze();
  }
  function move(e) {
    if (e.composedPath().includes(host)) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const hit = annotations.find(
        (a) =>
          valid(a) &&
          [...a.range.getClientRects()].some(
            (r) =>
              e.clientX >= r.left - 3 &&
              e.clientX <= r.right + 3 &&
              e.clientY >= r.top - 3 &&
              e.clientY <= r.bottom + 3,
          ),
      );
      if (hit === active) {
        clearTimeout(closeTimer);
        return;
      }
      clearTimeout(hoverTimer);
      if (hit) {
        clearTimeout(closeTimer);
        hoverTimer = window.setTimeout(() => show(hit), 220);
      } else if (active) {
        clearTimeout(closeTimer);
        closeTimer = window.setTimeout(hide, 300);
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
  function enter() {
    clearTimeout(closeTimer);
  }
  function leave() {
    closeTimer = window.setTimeout(hide, 300);
  }
  popover.addEventListener('pointerenter', enter);
  popover.addEventListener('pointerleave', leave);
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('keydown', keydown);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  const ticker = setInterval(tick, 1000),
    poll = setInterval(refresh, 15000);
  const apiObject = {
    lastError: '',
    contextKey,
    verify: (id) => alive && pending === id && identity()?.key === lastAnalysis,
    refresh,
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
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      host.remove();
      highlightStyle.remove();
      if (window.__codexBuddyTerminology === apiObject) delete window.__codexBuddyTerminology;
    },
  };
  window.__codexBuddyTerminology = apiObject;
  tick();
  void refresh();
  return apiObject;
}
