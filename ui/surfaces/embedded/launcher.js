/* [INPUT]: 主界面开合状态及共用表情手势。
 * [OUTPUT]: 默认使用独立眼睛入口；官方按钮适配代码仅供显式试验；单击保留旧手势、普通右键保留官方菜单、Option+右键打开内置浏览器设置；官方插件页签联动仅供显式启用的 Dev 试验；导航重建后恢复，不回退胶囊。
 * [POS]: 嵌入式入口适配，不创建功能窗口、不修改业务数据。
 * [PROTOCOL]: 变更时同步 embedded/AGENTS.md。 */
import { DEVELOPMENT } from '../../shared/constants.js';
import { createPluginTabLink } from '../../codex/plugin-tab.js';
let pluginLink = null;
let pluginStatus = '';
let entry = null;
let official = null;
let settingsLink = null;
let observer = null;
let frame = 0;
let current = null;
const previewEnabled = () => DEVELOPMENT && current?.pluginTabPreview === true;

function isOfficialButton(node) {
  if (
    !(node instanceof HTMLElement) ||
    !node.closest('nav[class~="group/sidebar-rail"]') ||
    node.closest('[data-codex-buddy-launcher]')
  )
    return false;
  const name = (
    node.getAttribute('aria-label') ||
    node.textContent ||
    node.getAttribute('title') ||
    ''
  ).trim();
  return ['CodexBuddy 看板', 'CodexBuddy'].includes(name) && node.getBoundingClientRect().width > 0;
}
function canReuseOfficial() {
  return isOfficialButton(official) && current?.canUseOfficial?.() === true;
}
function officialPointer(event) {
  if (!canReuseOfficial() || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  event.stopImmediatePropagation();
  current?.pointerDown(event);
}
function officialClick(event) {
  if (!canReuseOfficial() || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  current?.click(event);
}
function officialKey(event) {
  if (canReuseOfficial() && event.altKey && event.key === 'Enter') {
    event.stopImmediatePropagation();
    current?.keyDown(event);
  }
}
function officialDouble(event) {
  if (canReuseOfficial()) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
export function openPluginSettings() {
  if (!settingsLink)
    settingsLink = createPluginTabLink({
      follow: false,
      onOpened: () => {},
      onStatus: (message) => {
        if (official) official.dataset.buddySettingsStatus = message;
      },
    });
  void settingsLink.open();
}
function officialContext(event) {
  if (!event.altKey || !canReuseOfficial() || !current?.settingsBrowser) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  current.settingsBrowser();
}
function bindOfficial(button) {
  if (official === button) return;
  if (official) {
    official.removeEventListener('pointerdown', officialPointer, true);
    official.removeEventListener('click', officialClick, true);
    official.removeEventListener('keydown', officialKey, true);
    official.removeEventListener('dblclick', officialDouble, true);
    official.removeEventListener('contextmenu', officialContext, true);
  }
  official = button;
  if (official) {
    // Remove only status text left by the previous Buddy adapter.
    if (['正在打开官方 Buddy 插件页签…', '设置已在官方侧边页签打开。'].includes(official.title))
      official.removeAttribute('title');
    official.addEventListener('pointerdown', officialPointer, true);
    official.addEventListener('click', officialClick, true);
    official.addEventListener('keydown', officialKey, true);
    official.addEventListener('dblclick', officialDouble, true);
    official.addEventListener('contextmenu', officialContext, true);
  }
}
function findOfficial(rail) {
  const buttons = [...rail.querySelectorAll('button,a')].filter(isOfficialButton);
  return buttons.length === 1 ? buttons[0] : null;
}

function schedule() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (current) syncLauncher(current);
    });
}

export function stopLauncher() {
  bindOfficial(null);
  pluginLink?.stop();
  pluginLink = null;
  settingsLink?.stop();
  settingsLink = null;
  pluginStatus = '';
  observer?.disconnect();
  observer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  window.removeEventListener('resize', schedule);
  entry?.remove();
  entry = null;
  if (current?.root) delete current.root.dataset.launcher;
  current = null;
}

export function launcherButton() {
  if (official?.isConnected) return official;
  return entry?.isConnected ? entry.shadowRoot.querySelector('button') : null;
}

/** @param {{open:boolean,root:HTMLElement|null,click:(event:MouseEvent)=>void,pointerDown:(event:PointerEvent)=>void,keyDown:(event:KeyboardEvent)=>void,settings:()=>void,settingsBrowser?:()=>void,reuseOfficial?:boolean,pluginOpened?:()=>void,pluginTabPreview?:boolean,canUseOfficial?:()=>boolean}} options */
export function syncLauncher(options) {
  current = options;
  if (!previewEnabled()) {
    pluginLink?.stop();
    pluginLink = null;
    pluginStatus = '';
  }
  if (previewEnabled() && !pluginLink)
    pluginLink = createPluginTabLink({
      onOpened: () => current?.pluginOpened?.(),
      onStatus: (message) => {
        pluginStatus = message;
        const button = launcherButton();
        if (button) button.title = message;
      },
    });
  if (!observer) {
    observer = new MutationObserver((records) => {
      if (records.some((record) => !entry?.contains(record.target))) schedule();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title'],
    });
    window.addEventListener('resize', schedule);
  }
  const rail = [...document.querySelectorAll('nav[class~="group/sidebar-rail"]')].find(
    (node) =>
      node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden',
  );
  if (!rail) {
    bindOfficial(null);
    entry?.remove();
    if (options.root) delete options.root.dataset.launcher;
    return;
  }
  bindOfficial(options.reuseOfficial === true ? findOfficial(rail) : null);
  if (official && !previewEnabled()) {
    entry?.remove();
    entry = null;
    if (options.root) options.root.dataset.launcher = 'rail';
    return;
  }
  if (!entry) {
    entry = document.createElement('div');
    entry.setAttribute('data-codex-buddy-launcher', 'true');
    entry.style.cssText = 'flex:none;align-self:stretch;min-width:0;';
    const shadow = entry.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host { color:inherit; }
      .entry { display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0; }
      .divider { width:24px;border-top:1px solid color-mix(in srgb,currentColor 16%,transparent); }
      button { appearance:none;display:grid;place-items:center;width:36px;height:36px;
        border:0;border-radius:10px;padding:0;background:transparent;color:inherit;cursor:pointer; }
      button:hover { background:color-mix(in srgb,currentColor 10%,transparent); }
      button:focus-visible { outline:2px solid currentColor;outline-offset:2px; }
      svg { width:20px;height:20px;fill:currentColor; }
    </style><div class="entry"><div class="divider" aria-hidden="true"></div>
      <button type="button" aria-label="CodexBuddy" aria-keyshortcuts="Alt+Enter" title="单击收放 · 双击窗口往返 · 右键设置">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="4" height="10" rx="2"/><rect x="15" y="7" width="4" height="10" rx="2"/></svg>
      </button></div>`;
    const button = shadow.querySelector('button');
    button.addEventListener('pointerdown', (event) => {
      if (!previewEnabled()) current?.pointerDown(event);
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (previewEnabled()) {
        if (event.detail < 2) void pluginLink?.open();
      } else current?.click(event);
    });
    button.addEventListener('keydown', (event) => {
      if (!previewEnabled()) current?.keyDown(event);
      else if (event.altKey && event.key === 'Enter') {
        event.preventDefault();
        void pluginLink?.open();
      }
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.altKey && current?.settingsBrowser) current.settingsBrowser();
      else current?.settings();
    });
  }
  if (entry.parentElement !== rail) rail.insertBefore(entry, rail.lastElementChild);
  entry.shadowRoot.querySelector('button').title = previewEnabled()
    ? pluginStatus || '打开官方 Buddy 插件页签 · 右键设置（Dev 验证）'
    : '单击收放 · 双击窗口往返 · 右键设置';
  entry.shadowRoot.querySelector('button').setAttribute('aria-expanded', String(options.open));
  if (options.root) options.root.dataset.launcher = 'rail';
}
