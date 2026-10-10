/* [INPUT]: 宿主公开 DOM 的右侧标签、插件菜单及当前聊天标识。
 * [OUTPUT]: Buddy 插件页签联动；设置入口只手动打开，Dev 试验可选择切换聊天后恢复。
 * [POS]: 最小宿主适配，不调用私有 IPC、不读取正文、不改变插件线程绑定。
 * [PROTOCOL]: 变更时同步 codex/AGENTS.md；真实宿主由用户手动验收。 */
import { mainChatSessionId } from './context.js';
const NAME = 'CodexBuddy';
const OWN =
  '[data-codex-buddy-launcher],[data-companion-stepwise-root],[data-codex-buddy-features-root]';
const RIGHT = '[data-app-shell-focus-area="right-panel"]';
const visible = (node) => {
  if (
    !(node instanceof HTMLElement) ||
    node.closest('[hidden],[inert],[aria-hidden="true"]') ||
    !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
    return false;
  const box = node.getBoundingClientRect();
  const left = Math.max(0, box.left),
    right = Math.min(innerWidth, box.right);
  const top = Math.max(0, box.top),
    bottom = Math.min(innerHeight, box.bottom);
  if (right <= left || bottom <= top) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return !!hit && node.contains(hit);
};
const label = (node) =>
  (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ');
function unique(selector, names) {
  const nodes = [...document.querySelectorAll(selector)].filter(
    (node) => visible(node) && !node.closest(OWN) && names.includes(label(node)),
  );
  if (nodes.length > 1)
    throw Error(`发现多个同名入口（${names.join(' / ')}，${nodes.length}个），未自动选择。`);
  return /** @type {HTMLElement|null} */ (nodes[0] || null);
}
function tab() {
  return unique(
    `${RIGHT} [role="tab"],[role="tablist"][aria-label="任务选项卡"] [role="tab"],[role="tablist"][aria-label="Task tabs"] [role="tab"],[data-tab-id] [role="tab"]`,
    [NAME],
  );
}
const sessionKey = () => mainChatSessionId();
class SourceChanged extends Error {
  constructor() {
    super('聊天正在切换，旧操作已取消。');
  }
}

/** @param {{onOpened:()=>void,onStatus:(message:string)=>void,follow?:boolean}} options */
export function createPluginTabLink({ onOpened, onStatus, follow = true }) {
  let stopped = false,
    enabled = false,
    running = null,
    last = sessionKey(),
    candidate = last,
    candidateAt = 0;
  let interval = 0;
  let stage = '识别聊天';
  const attempts = new Map();
  const check = (key) => {
    if (stopped || sessionKey() !== key) throw new SourceChanged();
    if (document.visibilityState !== 'visible') throw Error('当前窗口不可见，未切换页签。');
  };
  const wait = async (key, read, recoverSplit = false) => {
    let splitRequested = false;
    for (let i = 0; i < 50; i++) {
      if (stopped) throw new SourceChanged();
      const current = sessionKey();
      if (current && current !== key) throw new SourceChanged();
      if (!current) {
        if (recoverSplit && !splitRequested && tab()) {
          const split = unique('button', ['进入分屏视图', 'Enter split view']);
          if (
            split &&
            split.getAttribute('aria-pressed') !== 'true' &&
            !split.matches(':disabled,[aria-disabled="true"]')
          ) {
            splitRequested = true;
            split.click();
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }
      check(key);
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw Error('未找到官方 Buddy 页签，请确认插件已启用；可再次点击重试。');
  };
  const click = (node, key) => {
    check(key);
    if (!visible(node) || node.matches(':disabled,[aria-disabled="true"]'))
      throw Error('官方入口当前不可用。');
    if (node.getAttribute('aria-haspopup') === 'menu') {
      const handled = !node.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
      node.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
      if (handled) return;
    }
    node.click();
  };
  async function open(expectedKey) {
    stage = '恢复分屏';
    if (expectedKey && sessionKey() && sessionKey() !== expectedKey) throw new SourceChanged();
    if (document.visibilityState !== 'visible') throw Error('当前窗口不可见，未切换页签。');
    const split = unique('button', ['进入分屏视图', 'Enter split view']);
    if (split && split.getAttribute('aria-pressed') !== 'true') {
      if (split.matches(':disabled,[aria-disabled="true"]'))
        throw Error('官方分屏入口当前不可用。');
      split.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (stopped) return;
    }
    stage = '识别聊天';
    const key = sessionKey();
    if (!key) throw Error('无法唯一识别当前聊天，未打开插件。');
    if (expectedKey && key !== expectedKey) throw new SourceChanged();
    check(key);
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(visible))
      throw Error('请先关闭当前对话框，再打开 Buddy。');
    stage = '寻找右侧入口';
    let existing = tab();
    if (!existing) {
      const toggle = unique('button', [
        '显示/隐藏侧边面板',
        'Toggle side panel',
        '显示标签页',
        'Show tabs',
      ]);
      if (
        toggle &&
        (toggle.getAttribute('aria-pressed') === 'false' ||
          ['显示标签页', 'Show tabs'].includes(label(toggle)))
      )
        click(toggle, key);
      const next = await wait(
        key,
        () =>
          tab() ||
          unique('button', ['打开侧边面板标签页', 'Open side panel tab']) ||
          unique('button', ['新建标签页', 'New tab']) ||
          unique(`${RIGHT} button`, ['新标签页', 'New tab']) ||
          unique('button', ['新标签页', 'New tab']) ||
          unique(`${RIGHT} button`, [NAME, '更多工具…', 'More tools…']) ||
          unique('button', ['更多工具…', 'More tools…']),
      );
      if (next.getAttribute('role') !== 'tab') {
        if ([...document.querySelectorAll('[role="menu"]')].some(visible))
          throw Error('请先关闭当前菜单，再打开 Buddy。');
        stage = '打开插件菜单';
        if (['新标签页', 'New tab'].includes(label(next))) {
          // 新版左击会创建浏览器页；右键才打开包含官方插件的标签菜单。
          check(key);
          if (next.matches(':disabled,[aria-disabled="true"]')) throw Error('官方入口当前不可用。');
          next.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
          );
        } else click(next, key);
        if (label(next) !== NAME) {
          stage = '选择 CodexBuddy 插件';
          const item = await wait(
            key,
            () =>
              unique('[role="menuitem"]', [NAME]) ||
              unique(`${RIGHT} button`, [NAME, '更多工具…', 'More tools…']) ||
              unique('button', ['更多工具…', 'More tools…']),
          );
          click(item, key);
          if (label(item) !== NAME)
            click(await wait(key, () => unique('[role="menuitem"]', [NAME])), key);
        }
      }
      stage = '确认官方插件页签';
      existing = await wait(key, tab, true);
    }
    if (existing.getAttribute('aria-selected') !== 'true') click(existing, key);
    // 官方标签切换可能带入该聊天保存的完整视图；选择后再核对并恢复分屏。
    const finalSplit = unique('button', ['进入分屏视图', 'Enter split view']);
    if (finalSplit && finalSplit.getAttribute('aria-pressed') !== 'true') {
      const current = sessionKey();
      if (current && current !== key) throw new SourceChanged();
      if (!finalSplit.matches(':disabled,[aria-disabled="true"]')) finalSplit.click();
    }
    let confirmations = 0;
    await wait(key, () => {
      const split = unique('button', ['进入分屏视图', 'Enter split view']);
      const ready =
        tab()?.getAttribute('aria-selected') === 'true' &&
        (!split || split.getAttribute('aria-pressed') === 'true');
      confirmations = ready ? confirmations + 1 : 0;
      return confirmations >= 2;
    });
    check(key);
    onOpened();
    enabled = true;
    last = candidate = key;
    attempts.delete(key);
    onStatus(follow ? '官方 Buddy 页签已选中；切换聊天时自动恢复。' : '设置已在官方侧边页签打开。');
  }
  function request(expectedKey = sessionKey(), automatic = false) {
    if (stopped) return Promise.resolve();
    if (running) return running;
    if (!automatic) attempts.delete(expectedKey);
    const attempt = (attempts.get(expectedKey) || 0) + 1;
    attempts.set(expectedKey, attempt);
    if (attempts.size > 32) attempts.delete(attempts.keys().next().value);
    onStatus('正在打开官方 Buddy 插件页签…');
    running = open(expectedKey)
      .catch((error) => {
        if (stopped) return;
        // 切换取消不等于关闭跟随；新聊天稳定后继续。相同聊天最多重试一次。
        if (error instanceof SourceChanged) {
          if (enabled && attempt < 2 && (!sessionKey() || sessionKey() === expectedKey)) {
            last = null;
            candidateAt = Date.now();
          }
        }
        onStatus(`${stage}：${error.message}`);
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  // 只在首次手动成功后运行；同一聊天内收起、切换别的标签均不抢回。
  interval = window.setInterval(() => {
    if (!follow || stopped || !enabled || running || document.visibilityState !== 'visible') return;
    const next = sessionKey();
    if (next !== candidate) {
      candidate = next;
      candidateAt = Date.now();
      return;
    }
    if (!next || next === last || Date.now() - candidateAt < 750) return;
    last = next;
    void request(next, true);
  }, 250);
  return {
    open: () => request(),
    stop() {
      stopped = true;
      enabled = false;
      clearInterval(interval);
    },
  };
}
