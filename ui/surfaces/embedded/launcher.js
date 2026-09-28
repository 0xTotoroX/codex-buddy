/* [INPUT]: 入口偏好、主界面开合状态及原有打开动作。
 * [OUTPUT]: 左侧导航栏中的唯一 Buddy 图标；导航重建后重新挂载，缺少导航时保留胶囊。
 * [POS]: 嵌入式入口适配，不创建功能窗口、不修改业务数据。
 * [PROTOCOL]: 变更时同步 embedded/AGENTS.md。 */
let entry = null;
let observer = null;
let frame = 0;
let current = null;

function schedule() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (current) syncLauncher(current);
    });
}

export function stopLauncher() {
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

/** @param {{mode:string,open:boolean,root:HTMLElement|null,toggle:()=>void}} options */
export function syncLauncher(options) {
  current = options;
  if (options.mode !== 'rail') {
    stopLauncher();
    return;
  }
  if (!observer) {
    observer = new MutationObserver((records) => {
      if (records.some((record) => !entry?.contains(record.target))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
  }
  const rail = [...document.querySelectorAll('nav[class~="group/sidebar-rail"]')].find(
    (node) =>
      node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden',
  );
  if (!rail) {
    entry?.remove();
    if (options.root) delete options.root.dataset.launcher;
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
      button:hover,button[aria-pressed="true"] { background:color-mix(in srgb,currentColor 10%,transparent); }
      button:focus-visible { outline:2px solid currentColor;outline-offset:2px; }
      svg { width:20px;height:20px;fill:currentColor; }
    </style><div class="entry"><div class="divider" aria-hidden="true"></div>
      <button type="button" aria-label="CodexBuddy" title="CodexBuddy">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="4" height="10" rx="2"/><rect x="15" y="7" width="4" height="10" rx="2"/></svg>
      </button></div>`;
    shadow.querySelector('button').addEventListener('click', () => current?.toggle());
  }
  if (entry.parentElement !== rail) rail.insertBefore(entry, rail.lastElementChild);
  entry.shadowRoot.querySelector('button').setAttribute('aria-pressed', String(options.open));
  if (options.root) options.root.dataset.launcher = 'rail';
}
