/* [INPUT]: 宿主公开 DOM 的右侧标签、插件菜单及当前聊天标识。
 * [OUTPUT]: Dev 手动启用的 Buddy 插件页签联动；只点现有控件，切换聊天后一次恢复。
 * [POS]: 最小宿主适配，不调用私有 IPC、不读取正文、不改变插件线程绑定。
 * [PROTOCOL]: 变更时同步 codex/AGENTS.md；真实宿主由用户手动验收。 */
import { mainChatSessionId } from './context.js';
const NAME = 'CodexBuddy';
const OWN =
  '[data-codex-buddy-launcher],[data-companion-stepwise-root],[data-codex-buddy-features-root]';
const RIGHT = '[data-app-shell-focus-area="right-panel"]';
const visible = (node) =>
  node instanceof HTMLElement &&
  node.getClientRects().length > 0 &&
  getComputedStyle(node).visibility !== 'hidden' &&
  !node.closest('[hidden],[inert]');
const label = (node) =>
  (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ');
function unique(selector, names) {
  const nodes = [...document.querySelectorAll(selector)].filter(
    (node) => visible(node) && !node.closest(OWN) && names.includes(label(node)),
  );
  if (nodes.length > 1) throw Error('发现多个同名入口，未自动选择。');
  return /** @type {HTMLElement|null} */ (nodes[0] || null);
}
function tab() {
  return unique(`${RIGHT} [role="tab"]`, [NAME]);
}
const sessionKey = () => mainChatSessionId();

/** @param {{onOpened:()=>void,onStatus:(message:string)=>void}} options */
export function createPluginTabLink({ onOpened, onStatus }) {
  let stopped = false,
    enabled = false,
    running = null,
    last = sessionKey();
  let interval = 0;
  let stage = '识别聊天';
  const check = (key) => {
    if (stopped || sessionKey() !== key) throw Error('聊天已切换，已停止旧操作。');
    if (document.visibilityState !== 'visible') throw Error('当前窗口不可见，未切换页签。');
  };
  const wait = async (key, read) => {
    for (let i = 0; i < 50; i++) {
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
    node.click();
  };
  async function open() {
    stage = '识别聊天';
    const key = sessionKey();
    if (!key) throw Error('无法唯一识别当前聊天，未打开插件。');
    check(key);
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(visible))
      throw Error('请先关闭当前对话框，再打开 Buddy。');
    stage = '寻找右侧入口';
    let existing = tab();
    if (!existing) {
      const toggle = unique('button', ['显示/隐藏侧边面板', 'Toggle side panel']);
      if (toggle?.getAttribute('aria-pressed') === 'false') click(toggle, key);
      const next = await wait(
        key,
        () =>
          tab() ||
          unique('button', ['打开侧边面板标签页', 'Open side panel tab']) ||
          unique(`${RIGHT} button`, ['新标签页', 'New tab']) ||
          unique(`${RIGHT} button`, [NAME, '更多工具…', 'More tools…']),
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
              unique(`${RIGHT} button`, [NAME, '更多工具…', 'More tools…']),
          );
          click(item, key);
          if (label(item) !== NAME)
            click(await wait(key, () => unique('[role="menuitem"]', [NAME])), key);
        }
      }
      stage = '确认官方插件页签';
      existing = await wait(key, tab);
    }
    if (existing.getAttribute('aria-selected') !== 'true') click(existing, key);
    await wait(key, () => tab()?.getAttribute('aria-selected') === 'true');
    check(key);
    onOpened();
    enabled = true;
    last = key;
    onStatus('官方 Buddy 页签已选中；切换聊天时自动恢复。');
  }
  function request() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    onStatus('正在打开官方 Buddy 插件页签…');
    running = open()
      .catch((error) => {
        enabled = false;
        onStatus(`${stage}：${error.message}`);
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  // 只在首次手动成功后运行；同一聊天内收起、切换别的标签均不抢回。
  interval = window.setInterval(() => {
    const next = sessionKey();
    if (stopped || !enabled || running || document.visibilityState !== 'visible' || next === last)
      return;
    last = next;
    if (next) void request();
  }, 500);
  return {
    open: request,
    stop() {
      stopped = true;
      enabled = false;
      clearInterval(interval);
    },
  };
}
