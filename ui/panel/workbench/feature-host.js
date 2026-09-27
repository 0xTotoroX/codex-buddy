/* [INPUT]: Authenticated feature state and shared host dock adapter.
 * [OUTPUT]: Independent feature surfaces and one shared sidebar slot.
 * [POS]: Host presentation lifecycle; business authority stays in runtime.
 * [PROTOCOL]: Keep workbench/AGENTS.md in sync. */
import { surfaceStyle } from '../../features/surface';
import { mountFeature } from '../../features/mount';
import { titles } from '../../features/types';
import { createDock } from '../host/dock.js';
import { bridgeCall, shellState, runtimeState } from '../runtime/state.js';
import { IS_POPOUT } from '../runtime/constants.js';
import { emitSignal } from '../runtime/signals.js';
import { stopWorkbench } from './layout.js';
let timer = 0,
  epoch = 0,
  polling = false,
  dock = null,
  sidebar = null,
  launcher = null,
  dockStatus = '',
  selected = '',
  independent = false;
const mounts = new Map();
/** @type {import('../../features/types').Request} */
const request = async (input) => {
  const result = await bridgeCall('/features', input);
  if (result.error) throw new Error(result.error);
  return result;
};
export const independentFeatures = () => !IS_POPOUT && independent;
export async function revealFeature(id, placement) {
  const result = await request({ op: placement ? 'move' : 'reveal', id, placement });
  if (!timer) startFeatureHost();
  render(result);
  dock?.reopen();
  if (dockStatus === 'space') dock?.showOptions(launcher?.getBoundingClientRect());
}
function element() {
  const node = document.createElement('div');
  node.setAttribute('data-codex-buddy-features-root', 'true');
  document.body.append(node);
  return node;
}
function install() {
  stopWorkbench();
  sidebar = element();
  sidebar.style.cssText =
    'position:absolute;inset:8px 0 0;height:calc(100% - 8px);display:flex;flex-direction:column;z-index:20;';
  const tabs = document.createElement('nav');
  tabs.style.cssText = 'display:flex;gap:6px;padding:8px;flex-wrap:wrap;';
  sidebar.append(tabs);
  dock = createDock(
    (value) => {
      dockStatus = value.status;
      sidebar.hidden = value.status !== 'open';
      sidebar.style.display = value.status === 'open' ? 'flex' : 'none';
    },
    () => {
      if (selected) void revealFeature(selected, 'desktop').catch((e) => alert(String(e)));
    },
    () => {
      if (selected) void revealFeature(selected, 'overlay').catch((e) => alert(String(e)));
    },
  );
  dock.attachRoot(sidebar);
  launcher = element();
  launcher.style.cssText =
    'position:fixed;right:18px;bottom:18px;z-index:2147483645;font:13px -apple-system,sans-serif;';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '打开功能');
  select.style.cssText =
    'padding:8px 10px;border:1px solid #8885;border-radius:8px;background:light-dark(#faf9f6,#242520);color:light-dark(#343630,#dfdfd8);color-scheme:light dark;';
  select.innerHTML =
    '<option value="">CodexBuddy</option>' +
    Object.entries(titles)
      .map(([id, title]) => `<option value="${id}">${title}</option>`)
      .join('');
  select.onchange = () => {
    const id = select.value;
    select.value = '';
    if (id)
      void revealFeature(id).catch((e) => {
        select.title = String(e);
      });
  };
  launcher.append(select);
}
function overlayControls(node, entry, owner) {
  let dragging = null,
    timer = 0;
  const down = (event) => {
    if (
      !event
        .composedPath()
        .some((n) => n instanceof Element && n.classList.contains('feature-head')) ||
      event.composedPath().some((n) => n instanceof Element && n.matches('button,select,input')) ||
      event.button !== 0
    )
      return;
    const rect = node.getBoundingClientRect();
    dragging = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    node.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = (event) => {
    if (!dragging) return;
    node.style.right = 'auto';
    node.style.left = `${Math.max(0, Math.min(innerWidth - 100, dragging.left + event.clientX - dragging.x))}px`;
    node.style.top = `${Math.max(0, Math.min(innerHeight - 48, dragging.top + event.clientY - dragging.y))}px`;
  };
  const up = () => {
    dragging = null;
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('lostpointercapture', up);
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 320 && rect.height >= 280)
        void request({
          op: 'save',
          id: entry.id,
          owner,
          size: [Math.round(rect.width), Math.round(rect.height)],
        }).catch(() => {});
    }, 500);
  });
  observer.observe(node);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('lostpointercapture', up);
  };
}
/** @param {import('../../features/types').FeatureState} state */
function render(state) {
  if (!state.features.length) return;
  if (!independent) {
    independent = true;
    install();
    emitSignal('render', undefined);
  }
  const wanted = new Set(),
    sidebarIds = [];
  for (const entry of state.features) {
    const candidates = [
      ...(entry.open ? [{ owner: entry.owner, placement: entry.placement }] : []),
      ...(entry.pending?.ready ? [entry.pending] : []),
    ];
    for (const candidate of candidates) {
      if (!['sidebar', 'overlay'].includes(candidate.placement)) continue;
      const key = `${entry.id}:${candidate.owner}`;
      wanted.add(key);
      let item = mounts.get(key);
      if (!item) {
        const node = element();
        if (candidate.placement === 'sidebar') {
          node.style.cssText = 'flex:1;min-height:0;';
          sidebar.append(node);
        } else
          node.style.cssText = `position:fixed;right:${24 + mounts.size * 28}px;top:${64 + mounts.size * 24}px;width:min(${entry.size[0]}px,calc(100vw - 48px));height:min(${entry.size[1]}px,calc(100vh - 100px));min-width:320px;min-height:280px;resize:both;overflow:hidden;z-index:2147483640;box-shadow:0 8px 32px #0002;border:1px solid #8884;border-radius:8px;`;
        item = {
          node,
          id: entry.id,
          placement: candidate.placement,
          mount: mountFeature(
            node,
            entry,
            candidate.owner,
            candidate.placement,
            request,
            () => void poll(),
          ),
          cleanup:
            candidate.placement === 'overlay'
              ? overlayControls(node, entry, candidate.owner)
              : () => {},
          reveal: entry.reveal,
        };
        mounts.set(key, item);
      } else item.mount.update(entry);
      const active = entry.owner === candidate.owner && entry.open;
      item.node.hidden = !active;
      item.node.inert = !active || !!entry.pending;
      if (active && candidate.placement === 'sidebar') sidebarIds.push(entry.id);
      if (item.reveal !== entry.reveal) {
        item.reveal = entry.reveal;
        if (candidate.placement === 'sidebar') selected = entry.id;
        else item.node.style.zIndex = String(2147483641);
      }
    }
  }
  for (const [key, item] of mounts)
    if (!wanted.has(key)) {
      item.cleanup();
      item.mount.dispose();
      mounts.delete(key);
    }
  if (!sidebarIds.includes(selected)) selected = sidebarIds[0] || '';
  const tabs = sidebar.querySelector('nav');
  Object.assign(
    tabs.style,
    surfaceStyle({ ...state.appearance, surface: state.appearance?.themes.sidebar }),
  );
  if (tabs.dataset.key !== sidebarIds.join(':') + selected) {
    tabs.replaceChildren();
    tabs.dataset.key = sidebarIds.join(':') + selected;
    for (const id of sidebarIds) {
      const button = document.createElement('button');
      button.textContent = titles[id];
      button.style.cssText =
        'font:inherit;border:0;background:transparent;padding:6px;cursor:pointer;color:inherit;';
      button.setAttribute('aria-pressed', String(selected === id));
      button.onclick = () => {
        selected = id;
        render(state);
      };
      tabs.append(button);
    }
  }
  for (const item of mounts.values())
    if (item.placement === 'sidebar')
      item.node.hidden = item.id !== selected || !sidebarIds.includes(item.id);
  dock.update({
    width: Math.max(320, shellState.dockWidth),
    open: sidebarIds.length > 0,
    detached: false,
    popoutSupported: runtimeState.settings?.popoutSupported === true,
  });
  if (shellState.root) shellState.root.style.setProperty('display', 'none', 'important');
}
async function poll() {
  if (polling) return;
  polling = true;
  const current = epoch;
  try {
    const state = await request({ op: 'state' });
    if (current === epoch) render(state);
  } catch {
    /* Keep current surfaces; actions still validate their lease. */
  } finally {
    polling = false;
  }
}
export function startFeatureHost() {
  if (IS_POPOUT || timer) return;
  void poll();
  timer = window.setInterval(() => void poll(), 700);
}
export function stopFeatureHost() {
  epoch++;
  clearInterval(timer);
  timer = 0;
  for (const item of mounts.values()) {
    item.cleanup();
    item.mount.dispose();
  }
  mounts.clear();
  dock?.destroy();
  dock = null;
  sidebar?.remove();
  sidebar = null;
  launcher?.remove();
  launcher = null;
  independent = false;
  dockStatus = '';
}
