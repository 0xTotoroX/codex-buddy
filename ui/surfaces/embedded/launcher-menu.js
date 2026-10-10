/* [INPUT]: The independent eyes anchor and current action/default/capability callbacks.
 * [OUTPUT]: One viewport-aware upward menu with cancellable hover and keyboard access.
 * [POS]: Launcher presentation only; actions remain in the runtime coordinator.
 * [PROTOCOL]: Keep embedded/AGENTS.md in sync. */
import { createSvgGlass } from '../theme/glass/svg.js';
import { iconSvg } from '../../shared/icons/index.js';
const actions = [
  ['inside', '内', '在聊天内打开', 'dock'],
  ['outside', '外', '在桌面打开', 'detach'],
  ['settings', '设置', '打开设置', 'settings'],
];
export function createLauncherMenu(anchor, options) {
  const host = document.createElement('div');
  host.setAttribute('data-codex-buddy-launcher-menu', '');
  host.inert = true;
  host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host {font-family:system-ui,sans-serif;color:var(--menu-fg,#292929);}
    .menu-shell {position:absolute;left:var(--menu-left,-28px);top:var(--menu-top,-198px);width:56px;height:176px;pointer-events:none;}
    .shape {position:absolute;inset:0;border-radius:18px;pointer-events:none;opacity:0;
      transform:translateY(var(--enter-y,10px)) scale(.95);transform-origin:center bottom;
      transition:opacity 130ms ease-out,transform 180ms cubic-bezier(.2,.8,.2,1);}
    :host([data-flip-y]) .shape {transform-origin:center top;}
    .glass {clip-path:inset(0 round 18px);background:color-mix(in srgb,var(--menu-bg,#f9f9f9) 28%,transparent);backdrop-filter:blur(12px);}
    :host([data-theme='dark']) .glass {background:color-mix(in srgb,var(--menu-bg,#202020) 24%,transparent);}
    .glass::after {content:'';position:absolute;inset:0;background:linear-gradient(135deg,#ffffff3b,transparent 62%);pointer-events:none;}
    .glass>svg {position:absolute;width:0;height:0;}
    .rim {box-shadow:0 6px 18px #00000020,inset 0 1px 0 #ffffffa6,inset 0 -1px 0 #ffffff40,inset 0 0 0 1px #ffffff36;}
    :host([data-reduced-transparency]) .glass {background:var(--menu-bg,#f9f9f9);backdrop-filter:none;}
    .hit {position:absolute;inset:0;border-radius:18px;pointer-events:none;}
    .hit::after {content:'';position:absolute;left:0;right:0;bottom:-4px;height:4px;}
    :host([data-flip-y]) .hit::after {top:-4px;bottom:auto;}
    button {position:absolute;left:6px;top:var(--top);display:flex;flex-direction:column;align-items:center;justify-content:center;
      width:44px;height:50px;box-sizing:border-box;padding:4px;border:0;border-radius:12px;background:transparent;color:inherit;
      font:500 11px/1.3 system-ui;gap:4px;cursor:pointer;opacity:0;pointer-events:none;
      transform:translateY(var(--enter-y,10px));transition:opacity 100ms ease-out,transform 180ms cubic-bezier(.2,.85,.2,1),background-color 120ms ease-out;}
    button>svg {width:18px;height:18px;flex:none;}
    button:hover {background:var(--menu-hover,#00000009);}button:active {background:var(--menu-hover,#00000012);}
    button:focus-visible {outline:2px solid currentColor;outline-offset:1px;}
    button[aria-current='true']::after {content:'';position:absolute;right:4px;top:5px;width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.5;}
    button:disabled {opacity:.3!important;cursor:default;}
    :host([data-open]) .shape {opacity:1;transform:translateY(0) scale(1);}
    :host([data-open]) .hit {pointer-events:auto;}
    :host([data-open]) button {opacity:1;pointer-events:auto;transform:translateY(0);transition-delay:var(--delay,0ms);}
    :host([data-keyboard]) * {transition:none!important;}
    .status {position:absolute;left:34px;top:-30px;width:210px;font-size:12px;}
    @media(prefers-reduced-motion:reduce) {*{transition:none!important;}}
  </style><div class="menu-shell"><div class="shape glass"></div><div class="shape rim"></div><div class="hit"></div><div role="menu" aria-label="CodexBuddy 快捷菜单">${actions.map(([id, label, title, icon], i) => `<button type="button" role="menuitem" data-action="${id}" aria-label="${title}" title="${title}" style="--top:${6 + i * 57}px;--delay:${(2 - i) * 20}ms" tabindex="-1">${iconSvg(icon)}<span>${label}</span></button>`).join('')}</div></div><span class="status" role="status"></span>`;
  document.body.append(host);
  let glass = null;
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  function refreshGlass() {
    host.toggleAttribute('data-reduced-transparency', reducedTransparency.matches);
    if (reducedTransparency.matches) {
      host.dataset.glassBackend = 'solid';
      glass?.destroy();
      glass = null;
      return;
    }
    if (!glass) {
      try {
        glass = createSvgGlass(shadow.querySelector('.glass'));
        host.dataset.glassBackend = 'svg';
      } catch {
        host.dataset.glassBackend = 'fallback';
      }
    }
    glass?.refresh('regular');
  }
  let open = false,
    enterTimer = 0,
    leaveTimer = 0,
    busy = false,
    destroyed = false;
  const events = new AbortController();
  const listen = (node, event, handler) =>
    node.addEventListener(event, handler, { signal: events.signal });
  function place() {
    const box = anchor.getBoundingClientRect();
    const x = box.left + box.width / 2,
      y = box.top + box.height / 2;
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    const below = box.top < 184;
    const top = below ? Math.min(box.bottom + 4, innerHeight - 180) : box.top - 180;
    const left = Math.max(4, Math.min(x - 28, innerWidth - 60));
    host.toggleAttribute('data-flip-y', below);
    host.style.setProperty('--menu-top', `${Math.max(4, top) - y}px`);
    host.style.setProperty('--menu-left', `${left - x}px`);
    host.style.setProperty('--enter-y', below ? '-10px' : '10px');
    const root = anchor.getRootNode();
    const rail = root instanceof ShadowRoot ? root.host.parentElement || anchor : anchor;
    const style = getComputedStyle(rail);
    const colors = options().colors || {};
    host.dataset.theme = options().theme || 'light';
    host.style.setProperty('--menu-fg', colors.text || style.color);
    host.style.setProperty('--menu-bg', colors['surface-opaque'] || '#f9f9f9');
    host.style.setProperty(
      '--menu-hover',
      colors.hover || `color-mix(in srgb, ${style.color} 8%, transparent)`,
    );
    host.style.setProperty(
      '--menu-border',
      colors.divider || `color-mix(in srgb, ${style.color} 12%, transparent)`,
    );
  }
  function update() {
    const value = options();
    for (const button of shadow.querySelectorAll('button')) {
      button.disabled =
        busy || (button.dataset.action === 'outside' && value.outsideAvailable === false);
      button.setAttribute(
        'aria-current',
        String(button.dataset.action === (value.defaultAction || 'inside')),
      );
    }
    if (open) place();
  }
  function show(keyboard = false) {
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
    if (destroyed || !anchor.isConnected) return;
    place();
    update();
    refreshGlass();
    open = true;
    host.inert = false;
    host.toggleAttribute('data-keyboard', keyboard);
    host.setAttribute('data-open', '');
    anchor.setAttribute('aria-expanded', 'true');
    for (const button of shadow.querySelectorAll('button')) button.tabIndex = 0;
    if (keyboard)
      [...shadow.querySelectorAll('button')].find((button) => !button.disabled)?.focus();
  }
  function close(returnFocus = false) {
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
    open = false;
    host.removeAttribute('data-open');
    if (!returnFocus && shadow.activeElement instanceof HTMLElement) shadow.activeElement.blur();
    host.inert = true;
    anchor.setAttribute('aria-expanded', 'false');
    for (const button of shadow.querySelectorAll('button')) button.tabIndex = -1;
    if (returnFocus) anchor.focus();
  }
  function leave() {
    if (destroyed) return;
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      if (!busy && !shadow.activeElement) close();
    }, 180);
  }
  listen(anchor, 'pointerenter', (e) => {
    if (e.pointerType !== 'touch') {
      clearTimeout(leaveTimer);
      enterTimer = window.setTimeout(() => show(), 110);
    }
  });
  listen(anchor, 'pointerleave', leave);
  listen(host, 'pointerenter', () => {
    clearTimeout(leaveTimer);
  });
  listen(host, 'pointerleave', leave);
  listen(anchor, 'keydown', (e) => {
    if (['ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      show(true);
    } else if (e.key === 'Escape') close();
  });
  listen(shadow, 'keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const items = [...shadow.querySelectorAll('button')].filter((button) => !button.disabled);
      const i = items.findIndex((item) => item === shadow.activeElement);
      items[
        (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : items.length - 1)) % items.length
      ]?.focus();
    }
  });
  listen(shadow, 'focusout', () => {
    setTimeout(() => {
      if (!shadow.activeElement) leave();
    }, 0);
  });
  listen(document, 'pointerdown', (e) => {
    if (!e.composedPath().includes(anchor) && !e.composedPath().includes(host)) close();
  });
  listen(reducedTransparency, 'change', () => {
    if (open) refreshGlass();
  });
  listen(window, 'blur', () => close());
  listen(window, 'resize', () => close());
  listen(document, 'scroll', () => {
    if (open) place();
  });
  for (const button of shadow.querySelectorAll('button'))
    listen(button, 'click', async (e) => {
      e.stopPropagation();
      if (busy) return;
      busy = true;
      update();
      shadow.querySelector('.status').textContent = '';
      try {
        await options().action?.(button.dataset.action);
        if (!destroyed) close();
      } catch (error) {
        if (!destroyed) shadow.querySelector('.status').textContent = String(error);
      } finally {
        busy = false;
        if (!destroyed) update();
      }
    });
  anchor.setAttribute('aria-haspopup', 'menu');
  return {
    update,
    close,
    destroy() {
      destroyed = true;
      close();
      events.abort();
      glass?.destroy();
      host.remove();
      anchor.removeAttribute('aria-haspopup');
      anchor.removeAttribute('aria-expanded');
    },
  };
}
