/* [INPUT]: The independent eyes anchor and current action/default/capability callbacks.
 * [OUTPUT]: One viewport-aware radial menu with cancellable hover and keyboard access.
 * [POS]: Launcher presentation only; actions remain in the runtime coordinator.
 * [PROTOCOL]: Keep embedded/AGENTS.md in sync. */
import { createSvgGlass } from '../theme/glass/svg.js';
import { createPathLensMap } from '../theme/glass/path-lens.js';
import { iconSvg } from '../../shared/icons/index.js';
const outline =
  'M 4 92 L 4 10 Q 4 3 11 4 A 142 142 0 0 1 158 145 Q 158 154 149 154 L 52 154 A 53 53 0 0 0 4 92 Z';
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
  const highlightId = `fan-highlight-${crypto.randomUUID()}`;
  shadow.innerHTML = `<style>
    :host { font-family:system-ui,sans-serif; color:var(--fan-fg,#292929); }
    .fan { position:absolute;left:0;top:-144px;width:164px;height:164px;pointer-events:none;
      transform-origin:0 144px; }
    .shape { position:absolute;inset:0;width:164px;height:164px;overflow:visible;pointer-events:none;
      opacity:0;transform:scale(.78);transform-origin:0 144px;
      transition:opacity 140ms ease-out,transform 200ms cubic-bezier(.2,.8,.2,1);
      }
    .glass {clip-path:path('${outline}');background:color-mix(in srgb,var(--fan-bg,#f9f9f9) 28%,transparent);backdrop-filter:blur(12px);}
    :host([data-theme='dark']) .glass {background:color-mix(in srgb,var(--fan-bg,#202020) 24%,transparent);}
    .glass::after {content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 28% 10%,#ffffff42,transparent 64%);pointer-events:none;}
    .glass>svg {position:absolute;width:0;height:0;}
    .rim {filter:drop-shadow(0 5px 12px #00000028);}
    .rim path {fill:#ffffff09;stroke:url(#${highlightId});stroke-width:1.2;}
    :host([data-reduced-transparency]) .glass {background:var(--fan-bg,#f9f9f9);backdrop-filter:none;}

    .hit {position:absolute;inset:0;clip-path:polygon(0 0,164px 0,164px 164px,26px 164px,26px 118px,0 118px);pointer-events:none;}
    button {position:absolute;left:0;top:144px;display:flex;flex-direction:column;align-items:center;justify-content:center;
      width:44px;height:50px;box-sizing:border-box;padding:4px;border:0;border-radius:13px;
      background:transparent;color:inherit;font:500 11px/1.3 system-ui;gap:4px;cursor:pointer;
      opacity:0;pointer-events:none;transform:translate(calc(var(--x)*.55 - 22px),calc(var(--y)*.55 - 25px)) scale(.82);
      transition:opacity 110ms ease-out,transform 200ms cubic-bezier(.2,.85,.2,1),background-color 120ms ease-out; }
    svg.icon {width:18px;height:18px;flex:none;} button>svg {width:18px;height:18px;flex:none;}
    button:hover {background:var(--fan-hover,#00000009);}button:active {background:var(--fan-hover,#00000012);}
    button:focus-visible {outline:2px solid currentColor;outline-offset:2px;}
    button[aria-current='true']::after {content:'';position:absolute;right:4px;top:5px;width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.5;}
    button:disabled {opacity:.3!important;cursor:default;}
    :host([data-open]) .shape {opacity:1;transform:scale(.9);}
    :host([data-open]) .hit {pointer-events:auto;}
    :host([data-open]) button {opacity:1;pointer-events:auto;transform:translate(calc(var(--x) - 22px),calc(var(--y) - 25px)) scale(1);transition-delay:var(--delay,0ms);}
    :host([data-keyboard]) * {transition:none!important;}
    :host([data-flip-x]) .fan {transform:scaleX(-1);} :host([data-flip-x]) button {direction:ltr;}
    .label {display:contents;}
    :host([data-flip-x]) button>* {transform:scaleX(-1);}
    :host([data-flip-y]) .fan {transform:scaleY(-1);}
    :host([data-flip-y]) button>* {transform:scaleY(-1);}
    :host([data-flip-x][data-flip-y]) .fan {transform:scale(-1);}
    :host([data-flip-x][data-flip-y]) button>* {transform:scale(-1);}
    .status {position:absolute;left:20px;top:20px;width:210px;font-size:12px;}
    @media(prefers-reduced-motion:reduce) {*{transition:none!important;}}
  </style><div class="fan"><div class="shape glass"></div><svg class="shape rim" viewBox="0 0 164 164" aria-hidden="true"><defs><linearGradient id="${highlightId}" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="white" stop-opacity=".9"/><stop offset=".42" stop-color="white" stop-opacity=".2"/><stop offset="1" stop-color="white" stop-opacity=".6"/></linearGradient></defs><path d="${outline}"/></svg><div class="hit"></div><div role="menu" aria-label="CodexBuddy 快捷菜单">${actions.map(([id, label, title, icon], i) => `<button type="button" role="menuitem" data-action="${id}" aria-label="${title}" title="${title}" style="--x:${[28, 72, 105][i]}px;--y:${[-95, -69, -23][i]}px;--delay:${i * 22}ms" tabindex="-1">${iconSvg(icon)}<span>${label}</span></button>`).join('')}</div></div><span class="status" role="status"></span>`;
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
        glass = createSvgGlass(shadow.querySelector('.glass'), (width, height) =>
          createPathLensMap(width, height, outline),
        );
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
    host.toggleAttribute('data-flip-x', x + 168 > innerWidth);
    host.toggleAttribute('data-flip-y', y < 148);
    const root = anchor.getRootNode();
    const rail = root instanceof ShadowRoot ? root.host.parentElement || anchor : anchor;
    const style = getComputedStyle(rail);
    const colors = options().colors || {};
    host.dataset.theme = options().theme || 'light';
    host.style.setProperty('--fan-fg', colors.text || style.color);
    host.style.setProperty('--fan-bg', colors['surface-opaque'] || '#f9f9f9');
    host.style.setProperty(
      '--fan-hover',
      colors.hover || `color-mix(in srgb, ${style.color} 8%, transparent)`,
    );
    host.style.setProperty(
      '--fan-border',
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
