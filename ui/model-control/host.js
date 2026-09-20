/*
 * [INPUT]: 官方 DOM 菜单、稳定聊天标记和关联的 model/list 消息；不依赖工作台锁定。
 * [OUTPUT]: window.__codexBuddyModelControl 的异步 snapshot/apply 和同步 cancel/dispose。
 * [POS]: include_str / Page.addScriptToEvaluateOnNewDocument 可独立安装的宿主边界。
 * [PROTOCOL]: 父任务维护集成和地图；本文件不写 React、存储或发送模型请求。
 * snapshot(false) 不操作 DOM；refresh=true 显式探测菜单。target 无法确认时 id/title 为空。
 * apply 返回 {status,message,snapshot,previous}；status 为 success/partial/failed，细节在 message 与 snapshot.status。
 * restore 是调用方恢复意图标记；selection 仍须完整且通过全部校验，无隐式回滚。
 * revision 是实例内不透明的乐观并发令牌，包含目标/DOM/能力/可观察配置变化。
 *
 * Adapted from Model Deck v0.3.9: https://github.com/0xTotoroX/model-deck/blob/main/src/index.js
 * projectModels/tierSupportsFast, canonicalReasoning, accessibleText/isVisible,
 * normalizeModelLabel, sectionRow/menuItems/itemLabel, dispatchPointerActivation,
 * model/list request correlation and official menu probing patterns.
 * MIT License — Copyright (c) 2026 0xTotoroX
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(() => {
  'use strict';
  const KEY = '__codexBuddyModelControl';
  window[KEY]?.dispose?.();
  const OWN = '[data-companion-stepwise-root],[data-codex-buddy-dock],[data-codexpp-qmp-root]';
  const EDITOR = '.ProseMirror,[contenteditable="true"],textarea';
  const MENU =
    '[role="menu"][data-state="open"],[role="listbox"],[data-radix-menu-content][data-state="open"]';
  const IDS = ['data-conversation-id', 'data-thread-id', 'data-session-id'];
  const MARKERS = ['data-above-composer-conversation-id', 'data-response-annotation-conversation'];
  const PREFIX = {
    model: /^(?:model|模型)\s*/iu,
    reasoning: /^(?:reasoning(?: effort| level)?|推理强度)\s*/iu,
    speed: /^(?:speed|速度)\s*/iu,
  };
  const aliases = {
    无: 'none',
    极低: 'minimal',
    light: 'low',
    轻度: 'low',
    中: 'medium',
    高: 'high',
    'extra high': 'xhigh',
    极高: 'xhigh',
    maximum: 'max',
    最大: 'max',
    最高: 'max',
    超高: 'ultra',
  };
  const life = new AbortController();
  const requests = new Map();
  const nodeIds = new WeakMap();
  const epoch = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  let disposed = false,
    models = [],
    capabilityVersion = 0,
    requestSequence = 0,
    acceptedSequence = 0;
  let lastInteraction = null,
    cache = null,
    operation = null,
    dispatching = false;
  let nodeSequence = 0,
    revision = 0,
    fingerprint = '',
    observer;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const text = (node) =>
    String(
      node?.getAttribute('aria-label') || node?.getAttribute('title') || node?.textContent || '',
    )
      .replace(/\s+/g, ' ')
      .trim();
  const canonical = (value) => {
    const key = String(value ?? '')
      .trim()
      .toLowerCase();
    return aliases[key] || key;
  };
  const normalized = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^gpt[-\s]*/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
  const one = (values) => (values.length === 1 ? values[0] : null);
  const all = (root, selector) => [...root.querySelectorAll(selector)];
  const visible = (node) =>
    node instanceof HTMLElement &&
    node.isConnected &&
    !node.closest('[hidden],[inert],[aria-hidden="true"]') &&
    getComputedStyle(node).visibility === 'visible' &&
    node.getBoundingClientRect().width > 0 &&
    node.getBoundingClientRect().height > 0;
  const owned = (node) => Boolean(node?.closest(OWN));
  const disabled = (node) =>
    !node ||
    node.disabled ||
    node.getAttribute('aria-disabled') === 'true' ||
    node.hasAttribute('data-disabled');
  function nodeKey(node) {
    if (!node) return 0;
    if (!nodeIds.has(node)) nodeIds.set(node, ++nodeSequence);
    return nodeIds.get(node);
  }
  function projectModels(records) {
    if (!Array.isArray(records)) return [];
    const result = [],
      seen = new Set();
    for (const item of records) {
      const id = typeof item?.model === 'string' ? item.model.trim() : '';
      const label = typeof item?.displayName === 'string' ? item.displayName.trim() : '';
      const reasoning = [
        ...new Set(
          (Array.isArray(item?.supportedReasoningEfforts) ? item.supportedReasoningEfforts : [])
            .map((v) => canonical(typeof v === 'string' ? v : v?.reasoningEffort))
            .filter(Boolean),
        ),
      ];
      if (!id || !label || !reasoning.length || seen.has(id)) continue;
      seen.add(id);
      const fast = (Array.isArray(item.serviceTiers) ? item.serviceTiers : []).some((tier) => {
        if (typeof tier === 'string') return /^(priority|fast)$/i.test(tier);
        return (
          String(tier?.id ?? tier?.key ?? tier?.value ?? tier?.tier ?? '').toLowerCase() ===
            'priority' ||
          String(tier?.name ?? tier?.displayName ?? tier?.label ?? '').toLowerCase() === 'fast'
        );
      });
      result.push({ id, label, reasoning, fast });
    }
    return result;
  }
  function accept(records) {
    const next = projectModels(records);
    if (JSON.stringify(next) !== JSON.stringify(models)) {
      models = next;
      capabilityVersion++;
      cache = null;
    }
  }
  try {
    accept(window.__codexPlusQuickModelPresets?.getModelListCache?.());
  } catch {}
  const originalDispatch = window.dispatchEvent;
  function wrappedDispatch(event) {
    const detail = event?.detail,
      request = detail?.request;
    if (
      !disposed &&
      event?.type === 'codex-message-from-view' &&
      detail?.type === 'mcp-request' &&
      request?.method === 'model/list' &&
      request.id != null
    ) {
      for (const [key, value] of requests) if (Date.now() - value.at > 60000) requests.delete(key);
      if (requests.size >= 128) requests.delete(requests.keys().next().value);
      requests.set(JSON.stringify(request.id), { sequence: ++requestSequence, at: Date.now() });
    }
    return originalDispatch.call(this, event);
  }
  window.dispatchEvent = wrappedDispatch;
  window.addEventListener(
    'message',
    (event) => {
      if (
        disposed ||
        (event.source && event.source !== window) ||
        event.data?.type !== 'mcp-response'
      )
        return;
      const rpc = event.data.message ?? event.data.response;
      const key = JSON.stringify(rpc?.id),
        pending = requests.get(key);
      if (!pending) return;
      requests.delete(key);
      if (
        Date.now() - pending.at > 60000 ||
        pending.sequence < acceptedSequence ||
        rpc.error ||
        !Array.isArray(rpc?.result?.data)
      )
        return;
      acceptedSequence = pending.sequence;
      accept(rpc.result.data);
    },
    { capture: true, signal: life.signal },
  );
  function identity(root, scope, roots) {
    const values = new Set();
    for (const name of MARKERS) {
      if (root.hasAttribute(name)) values.add(root.getAttribute(name));
      all(scope, `[${name}]`).forEach((node) => values.add(node.getAttribute(name)));
    }
    for (let node = root; node && node !== document.body; node = node.parentElement) {
      if (roots.filter((entry) => node.contains(entry)).length > 1) break;
      IDS.forEach((name) => {
        if (node.getAttribute(name)) values.add(node.getAttribute(name));
      });
    }
    // Only the sole main chat may inherit the route; never links in message content or pane/tab indices.
    if (!values.size && roots.length === 1 && !root.closest('[role="dialog"],aside')) {
      const match = location.pathname.match(/\/(?:c|conversation|threads)\/([^/?#]+)/i);
      if (match) values.add(match[1]);
    }
    const id = one([...values].filter(Boolean));
    return id && id.length <= 256 ? id : '';
  }
  function candidates() {
    const roots = all(document, '.thread-scroll-container').filter(
      (root) => visible(root) && !owned(root),
    );
    return roots
      .map((root) => {
        let scope = root;
        while (scope && scope !== document.body) {
          if (roots.filter((entry) => scope.contains(entry)).length !== 1) return null;
          if (all(scope, EDITOR).some((node) => visible(node) && !owned(node))) break;
          scope = scope.parentElement;
        }
        if (!scope || scope === document.body) return null;
        const composer = one(all(scope, EDITOR).filter((node) => visible(node) && !owned(node)));
        if (!composer) return null;
        const id = identity(root, scope, roots);
        const triggers = all(
          scope,
          'button[aria-haspopup="menu"],[role="button"][aria-haspopup="menu"]',
        ).filter((node) => {
          if (!visible(node) || owned(node)) return false;
          return (
            node.hasAttribute('data-selected-reasoning-effort') ||
            models.some((model) => normalized(text(node)).includes(normalized(model.label))) ||
            /\b(?:gpt[-\s]*)?\d+\.\d+/i.test(text(node))
          );
        });
        const trigger = one(triggers);
        const title = text(scope.querySelector('header')) || `Chat ${id.slice(-8)}`;
        return { id, title: title.slice(0, 100), root, scope, composer, trigger };
      })
      .filter(Boolean);
  }
  function resolveTarget() {
    let choices = candidates();
    const dialogs = all(document, '[role="dialog"],dialog[open]').filter(
      (node) => visible(node) && !owned(node),
    );
    if (dialogs.length) {
      const modal = one(
        dialogs.filter(
          (node) => node.getAttribute('aria-modal') === 'true' || node.matches(':modal'),
        ),
      );
      const foreground =
        modal ||
        one(dialogs.filter((node) => node.contains(document.activeElement))) ||
        one(dialogs);
      if (!foreground?.matches('section[class*="floatingSurface"]')) return null;
      choices = choices.filter((entry) => foreground.contains(entry.root));
    }
    const focused = one(
      choices.filter(
        (entry) => entry.scope.contains(document.activeElement) && !owned(document.activeElement),
      ),
    );
    const tracked =
      lastInteraction &&
      one(
        choices.filter(
          (entry) =>
            entry.id === lastInteraction.id &&
            entry.root === lastInteraction.root &&
            entry.composer === lastInteraction.composer,
        ),
      );
    const target = tracked || focused || one(choices);
    if (
      !target?.id ||
      !target.trigger ||
      candidates().filter((entry) => entry.id === target.id).length !== 1
    )
      return null;
    return target;
  }
  function generating(target) {
    if (!target) return false;
    return all(target.scope, 'button,[role="button"],[data-is-streaming],[data-streaming]').some(
      (node) =>
        !owned(node) &&
        visible(node) &&
        (/^(stop(?: generating| response)?|停止(?:生成|回答)?)$/i.test(text(node)) ||
          node.getAttribute('data-is-streaming') === 'true' ||
          node.getAttribute('data-streaming') === 'true' ||
          all(node, 'svg path').some((path) =>
            /H14\.25C14\.9404 4\.5 15\.5 5\.05964 15\.5 5\.75V14\.25C15\.5 14\.9404/.test(
              path.getAttribute('d') || '',
            ),
          )),
    );
  }
  const triggerStamp = (target) =>
    target
      ? JSON.stringify([
          text(target.trigger),
          ...[...target.trigger.attributes]
            .map((a) => [a.name, a.value])
            .filter(([name]) => name.startsWith('data-selected-')),
        ])
      : '';
  const sameTarget = (a, b) =>
    Boolean(
      a && b && ['id', 'root', 'scope', 'composer', 'trigger'].every((key) => a[key] === b[key]),
    );
  function track(event) {
    if (dispatching || disposed || !(event.target instanceof Element) || owned(event.target))
      return;
    const candidate = one(candidates().filter((entry) => entry.scope.contains(event.target)));
    if (candidate) lastInteraction = candidate;
    if (
      event.isTrusted &&
      event.type !== 'focusin' &&
      operation &&
      (event.target.closest(MENU) || event.target === operation.target.trigger)
    )
      operation.aborted = '用户接管官方菜单';
    if (event.isTrusted && !operation && event.target.closest(MENU)) cache = null;
    checkLive();
  }
  document.addEventListener('pointerdown', track, { capture: true, signal: life.signal });
  document.addEventListener('focusin', track, { capture: true, signal: life.signal });
  document.addEventListener('keydown', track, { capture: true, signal: life.signal });
  function checkLive() {
    if (!operation || operation.aborted) return;
    if (disposed) operation.aborted = '适配器已销毁';
    else if (window.__codexPlusQuickModelPresets) operation.aborted = 'Model Deck 正在运行';
    else if (!sameTarget(operation.target, resolveTarget()))
      operation.aborted = '目标聊天或 DOM 已变化';
    else if (generating(operation.target)) operation.aborted = '目标聊天开始生成';
    else if (capabilityVersion !== operation.capabilityVersion) {
      if (operation.refresh) operation.capabilityVersion = capabilityVersion;
      else operation.aborted = '官方模型能力已变化';
    }
  }
  observer = new MutationObserver((records) => {
    if (
      operation &&
      records.some(
        (record) =>
          [...record.removedNodes].some((node) =>
            ['root', 'composer', 'trigger'].some((key) => node.contains(operation.target[key])),
          ) ||
          (record.type === 'attributes' &&
            [...IDS, ...MARKERS].includes(record.attributeName) &&
            operation.target.scope.contains(record.target) &&
            record.oldValue !== record.target.getAttribute(record.attributeName)),
      )
    )
      operation.aborted = '目标身份或 DOM 已替换';
    checkLive();
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
  });
  function passive() {
    const target = resolveTarget(),
      busy = generating(target);
    const current =
      cache &&
      sameTarget(cache.target, target) &&
      cache.stamp === triggerStamp(target) &&
      cache.capabilityVersion === capabilityVersion
        ? cache.current
        : null;
    const stateKey = JSON.stringify([
      target?.id,
      nodeKey(target?.root),
      nodeKey(target?.scope),
      nodeKey(target?.composer),
      nodeKey(target?.trigger),
      triggerStamp(target),
      capabilityVersion,
      current,
      busy,
      Boolean(window.__codexPlusQuickModelPresets),
      disposed,
    ]);
    if (stateKey !== fingerprint) {
      fingerprint = stateKey;
      revision++;
    }
    let status = 'ready',
      message = '';
    if (disposed) {
      status = 'unavailable';
      message = '适配器已销毁';
    } else if (window.__codexPlusQuickModelPresets) {
      status = 'conflict';
      message = 'Model Deck 正在运行，请显式关闭后重试';
    } else if (!target) {
      status = 'unavailable';
      message = '无法唯一确认聊天身份与输入框，请选择目标聊天';
    } else if (operation || busy) {
      status = 'busy';
      message = busy ? '等待目标聊天生成完成' : '模型菜单操作进行中';
    } else if (!models.length) {
      status = 'waiting';
      message = '等待关联的官方 model/list 数据；可刷新官方模型菜单后重试，无需重启';
    } else if (!current) {
      status = 'waiting';
      message = '需要显式刷新官方菜单以读取完整配置';
    }
    return clone({
      target: { id: target?.id || '', title: target?.title || '' },
      revision: `${epoch}:${revision}`,
      status,
      message,
      current: disposed ? null : current,
      models,
      generating: busy,
    });
  }
  function guard(op, node) {
    checkLive();
    if (op.controller.signal.aborted || performance.now() >= op.deadline)
      op.aborted ||= String(op.controller.signal.reason || '操作超过 11 秒截止时间');
    if (op.aborted) {
      op.controller.abort(op.aborted);
      throw new Error(op.aborted);
    }
    if (node && (!visible(node) || disabled(node))) throw new Error('官方控件已失效');
  }
  function pause(op, delay) {
    guard(op);
    return new Promise((resolve, reject) => {
      const signal = op.controller.signal;
      const done = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(done, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(new Error(String(signal.reason)));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function waitFor(op, read, timeout = 1600) {
    const deadline = performance.now() + timeout;
    do {
      guard(op);
      const value = read();
      if (value) return value;
      await pause(op, 25);
      guard(op);
    } while (performance.now() < deadline);
    throw new Error('等待官方菜单或配置回读超时');
  }
  function activate(op, node, mutation = false) {
    guard(op, node);
    if (mutation) {
      op.mutated = true;
      cache = null;
    }
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      pointerType: 'mouse',
      isPrimary: true,
    };
    dispatching = true;
    try {
      for (const [name, EventType, buttons] of [
        ['pointerdown', PointerEvent, 1],
        ['pointerup', PointerEvent, 0],
        ['click', MouseEvent, 0],
      ]) {
        guard(op, node);
        node.dispatchEvent(new EventType(name, { ...options, buttons, detail: 1 }));
      }
    } finally {
      dispatching = false;
    }
    guard(op);
  }
  const menus = () => all(document, MENU).filter((node) => visible(node) && !owned(node));
  const sectionRow = (menu, section) =>
    one(
      all(menu, '[role="menuitem"][aria-haspopup="menu"]').filter((item) =>
        PREFIX[section].test(text(item)),
      ),
    );
  const rowValue = (row, section) => text(row).replace(PREFIX[section], '').trim();
  const items = (menu) =>
    all(menu, '[role="menuitem"],[role="option"],[role="menuitemradio"]').filter(
      (node) => visible(node) && !disabled(node) && node.getAttribute('aria-haspopup') !== 'menu',
    );
  const label = (node) =>
    node.getAttribute('aria-label') ||
    all(node, 'span')
      .filter((span) => !span.querySelector('span') && text(span))[0]
      ?.textContent.trim() ||
    text(node);
  const matchModel = (value) =>
    one(
      models.filter((model) =>
        [model.id, model.label].some((name) => normalized(name) === normalized(value)),
      ),
    );
  const speedValue = (value) =>
    /^(?:fast|快速)(?:\s|$)/i.test(value)
      ? 'fast'
      : /^(?:standard|标准)(?:\s|$)/i.test(value)
        ? 'standard'
        : null;
  function readMain(op, main) {
    guard(op, main);
    const model = matchModel(rowValue(sectionRow(main, 'model'), 'model'));
    const reasoning = canonical(rowValue(sectionRow(main, 'reasoning'), 'reasoning'));
    const speedRow = sectionRow(main, 'speed');
    const speed = speedRow
      ? speedValue(rowValue(speedRow, 'speed'))
      : model && !model.fast
        ? 'standard'
        : null;
    if (!model || !model.reasoning.includes(reasoning) || !speed)
      throw new Error('官方完整配置无法精确回读');
    return { model: model.id, reasoning, speed };
  }
  function remember(op, current) {
    guard(op);
    cache = { target: op.target, current, stamp: triggerStamp(op.target), capabilityVersion };
    return current;
  }
  async function openMain(op) {
    guard(op);
    if (menus().length) throw new Error('官方菜单正在使用中');
    op.main = null;
    activate(op, op.target.trigger);
    const main = await waitFor(op, () => {
      const id = op.target.trigger.getAttribute('aria-controls');
      const found = menus().filter((menu) => sectionRow(menu, 'model') && (!id || menu.id === id));
      return one(found);
    });
    guard(op, main);
    op.main = main;
    return main;
  }
  async function closeMenu(op) {
    guard(op);
    if (!op.main || !visible(op.main)) {
      op.main = null;
      return;
    }
    // Escape is scoped to our menu; never click body or clean up after a target change.
    dispatching = true;
    try {
      op.main.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
    } finally {
      dispatching = false;
    }
    await waitFor(op, () => !visible(op.main), 500);
    guard(op);
    op.main = null;
  }
  async function submenu(op, main, section) {
    const row = sectionRow(main, section);
    if (!row) throw new Error(`官方 ${section} 菜单不可用`);
    const before = new Set(menus());
    activate(op, row);
    const menu = await waitFor(op, () => {
      const id = row.getAttribute('aria-controls');
      return one(
        menus().filter(
          (entry) =>
            entry !== main && items(entry).length && (id ? entry.id === id : !before.has(entry)),
        ),
      );
    });
    guard(op, main);
    guard(op, row);
    guard(op, menu);
    return menu;
  }
  async function readOfficial(op) {
    const main = await openMain(op);
    guard(op, main);
    const current = readMain(op, main);
    await closeMenu(op);
    guard(op);
    return remember(op, current);
  }
  async function choose(op, section, wanted) {
    const main = await openMain(op);
    guard(op, main);
    const menu = await submenu(op, main, section);
    guard(op, main);
    guard(op, menu);
    const item = one(
      items(menu).filter((entry) =>
        section === 'model'
          ? matchModel(label(entry))?.id === wanted
          : section === 'reasoning'
            ? canonical(label(entry)) === wanted
            : speedValue(label(entry)) === wanted,
      ),
    );
    if (!item) throw new Error(`官方 ${section} 选项不存在、重复或被禁用`);
    activate(op, item, true);
    // Menu can close before the host commits its asynchronous update.
    await closeMenu(op);
    guard(op);
    const deadline = performance.now() + 1800;
    do {
      const actual = await readOfficial(op);
      guard(op);
      if (actual[section] === wanted) return actual;
      await pause(op, 40);
      guard(op);
    } while (performance.now() < deadline);
    throw new Error(`官方 ${section} 切换未生效`);
  }
  function begin(refresh = false) {
    const target = resolveTarget();
    if (!target || generating(target)) throw new Error('目标不可用或正在生成');
    operation = {
      target,
      capabilityVersion,
      refresh,
      mutated: false,
      aborted: '',
      main: null,
      focus: document.activeElement,
      controller: new AbortController(),
      deadline: performance.now() + 11000,
    };
    const active = operation;
    active.timer = setTimeout(() => active.controller.abort('操作超过 11 秒截止时间'), 11000);
    guard(operation);
    return operation;
  }
  async function finish(op) {
    try {
      await closeMenu(op);
    } catch (cause) {
      op.cleanupError = cause.message;
    }
    clearTimeout(op.timer);
    if (
      !op.aborted &&
      !op.controller.signal.aborted &&
      sameTarget(op.target, resolveTarget()) &&
      visible(op.focus) &&
      op.target.scope.contains(op.focus) &&
      !generating(op.target) &&
      (document.activeElement === document.body ||
        document.activeElement === op.target.trigger ||
        document.activeElement?.closest(MENU))
    ) {
      dispatching = true;
      try {
        op.focus.focus({ preventScroll: true });
      } finally {
        dispatching = false;
      }
    }
    checkLive();
    if (operation === op) operation = null;
    return op.aborted || op.cleanupError || '';
  }
  async function snapshot(refresh = false) {
    const before = passive();
    if (!refresh || operation || ['unavailable', 'busy', 'conflict'].includes(before.status))
      return before;
    const op = begin(true);
    let error = '';
    try {
      // A hot injection can provoke a normal host capability fetch by opening its menu.
      const main = await openMain(op);
      guard(op, main);
      if (models.length) remember(op, readMain(op, main));
    } catch (cause) {
      error = cause.message;
      cache = null;
    }
    const cleanupError = await finish(op);
    error ||= cleanupError;
    const result = passive();
    if (error) {
      result.message = error;
      if (models.length && ['ready', 'waiting'].includes(result.status))
        result.status = 'unavailable';
    }
    return result;
  }
  async function apply(request = {}) {
    let before = passive(),
      previous = null;
    const result = (status, message) => ({
      status: status === 'applied' ? 'success' : status === 'partial' ? 'partial' : 'failed',
      message,
      snapshot: passive(),
      previous,
    });
    if (operation || ['busy', 'unavailable', 'conflict'].includes(before.status))
      return result(before.status, before.message);
    if (request?.target?.id !== before.target.id || request?.expectedRevision !== before.revision)
      return result('conflict', '目标或修订号已过期，请刷新后重试');
    const selection = { ...request?.selection };
    const model = models.find((entry) => entry.id === selection?.model);
    if (!models.length) return result('waiting', before.message);
    if (
      !model ||
      !model.reasoning.includes(selection?.reasoning) ||
      !['standard', 'fast'].includes(selection?.speed) ||
      (selection.speed === 'fast' && !model.fast)
    )
      return result('invalid', '完整配置不受官方能力支持，未做任何修改');
    const op = begin();
    let status = 'applied',
      message = '';
    try {
      previous = await readOfficial(op);
      guard(op);
      if (before.current && JSON.stringify(previous) !== JSON.stringify(before.current))
        throw new Error('官方配置已变化，请刷新后重试');
      let actual = previous;
      for (const section of ['model', 'reasoning', 'speed']) {
        guard(op);
        if (actual[section] !== selection[section])
          actual = await choose(op, section, selection[section]);
        guard(op);
      }
      actual = await readOfficial(op);
      guard(op);
      if (['model', 'reasoning', 'speed'].some((key) => actual[key] !== selection[key]))
        throw new Error('官方完整配置与请求不一致');
    } catch (cause) {
      status = op.mutated ? 'partial' : op.aborted ? 'conflict' : 'unavailable';
      message = cause.message;
      cache = null;
      if (!op.aborted && op.mutated) {
        try {
          await closeMenu(op);
          guard(op);
          await readOfficial(op);
          guard(op);
        } catch {
          cache = null;
        }
      }
    }
    const cleanupError = await finish(op);
    if (cleanupError && status === 'applied') {
      status = op.mutated ? 'partial' : 'unavailable';
      message = cleanupError;
      cache = null;
    }
    return result(status, message);
  }
  function cancel() {
    if (!operation) return false;
    operation.aborted = '操作已取消';
    operation.controller.abort(operation.aborted);
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    life.abort();
    observer.disconnect();
    requests.clear();
    cache = null;
    if (window.dispatchEvent === wrappedDispatch) window.dispatchEvent = originalDispatch;
    if (window[KEY] === api) delete window[KEY];
  }
  const api = { snapshot, apply, cancel, dispose };
  window[KEY] = api;
})();
