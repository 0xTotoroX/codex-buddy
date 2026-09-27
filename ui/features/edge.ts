/* [INPUT]: Native edge geometry/events and shared feature owners. [OUTPUT]: One tabbed edge/notch shell.
 * [POS]: Keeps mounted views alive while collapsed or in another tab; no business state.
 * [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { mountFeature } from './mount';
import { titles, type FeatureState, type Request } from './types';
import { surfaceStyle } from './surface';
import styles from './edge.css?inline';
export function startEdge(request: Request) {
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);
  const root = document.getElementById('root')!;
  root.innerHTML =
    '<button id="edge-handle" aria-label="展开功能面板">·</button><section id="edge-panel"><header><nav aria-label="功能"></nav><button id="edge-collapse" aria-label="收起面板">−</button></header><div id="edge-views"></div></section>';
  const panel = document.getElementById('edge-panel')!,
    handle = document.getElementById('edge-handle')!,
    tabs = panel.querySelector('nav')!,
    views = document.getElementById('edge-views')!;
  const mounts = new Map<
    string,
    { id: string; node: HTMLElement; mount: ReturnType<typeof mountFeature>; reveal: number }
  >();
  let selected = '',
    running = false,
    stopped = false,
    expanded = false,
    inside = false,
    buttons = 0;
  let native: Record<string, any> = {},
    scene = -1,
    enter = 0,
    leave = 0;
  const ipc = (value: object) => window.ipc?.postMessage(JSON.stringify(value));
  const held = () =>
    [...mounts.values()].some(({ node }) => {
      const shadow = node.shadowRoot;
      return (
        shadow?.querySelector('[data-busy="true"],dialog[open],[role="dialog"]') ||
        shadow?.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
      );
    });
  function collapse() {
    clearTimeout(enter);
    clearTimeout(leave);
    ipc({ action: 'collapse' });
  }
  function scheduleCollapse() {
    clearTimeout(leave);
    leave = window.setTimeout(() => {
      if (!inside && expanded && !buttons && !native.keepOpen && !native.keyboard && !held())
        collapse();
    }, 450);
  }
  function visibility() {
    for (const item of mounts.values()) {
      item.node.hidden = item.id !== selected;
      item.node.inert = !expanded || item.id !== selected;
    }
    panel.inert = !expanded;
  }
  async function refresh() {
    if (running || stopped) return;
    running = true;
    try {
      const state = await request<FeatureState>({ op: 'state' }),
        wanted = new Set<string>(),
        ids: string[] = [];
      for (const entry of state.features) {
        for (const candidate of [
          ...(entry.open ? [{ owner: entry.owner, placement: entry.placement }] : []),
          ...(entry.pending?.ready ? [entry.pending] : []),
        ]) {
          if (candidate.placement !== 'edge') continue;
          const key = `${entry.id}:${candidate.owner}`;
          wanted.add(key);
          let item = mounts.get(key);
          if (!item) {
            const node = document.createElement('div');
            node.className = 'edge-view';
            views.append(node);
            item = {
              id: entry.id,
              node,
              mount: mountFeature(
                node,
                entry,
                candidate.owner,
                'edge',
                request,
                () => void refresh(),
              ),
              reveal: entry.reveal,
            };
            mounts.set(key, item);
          } else item.mount.update(entry);
          const active = entry.owner === candidate.owner && entry.open;
          item.node.dataset.active = String(active);
          if (active) {
            ids.push(entry.id);
            if (item.reveal !== entry.reveal) selected = entry.id;
          }
          item.reveal = entry.reveal;
        }
      }
      for (const [key, item] of mounts)
        if (!wanted.has(key)) {
          item.mount.dispose();
          mounts.delete(key);
        }
      if (!ids.includes(selected)) selected = ids[0] || '';
      const signature = ids.join(':') + selected;
      if (tabs.dataset.key !== signature) {
        tabs.dataset.key = signature;
        tabs.replaceChildren();
        for (const id of ids) {
          const button = document.createElement('button');
          button.textContent = titles[id as keyof typeof titles];
          button.setAttribute('aria-pressed', String(id === selected));
          button.onclick = () => {
            selected = id;
            void refresh();
          };
          tabs.append(button);
        }
      }
      visibility();
      for (const item of mounts.values())
        if (item.node.dataset.active !== 'true') item.node.hidden = true;
    } catch {
      /* Retain views and drafts across a transient reconnect. */
    } finally {
      running = false;
    }
  }
  window.addEventListener('edge-native', (event) => {
    native = (event as CustomEvent).detail;
    expanded = !!native.expanded;
    window.__buddyNativeSurface = true;
    window.__buddyNativeGlass = !!native.nativeGlassAvailable;
    panel.style.left = `${native.layoutX || 0}px`;
    panel.style.top = `${native.layoutY || 0}px`;
    panel.style.width = `${native.layoutWidth || 480}px`;
    panel.style.height = `${native.layoutHeight || 600}px`;
    panel.style.opacity = String(native.unfold ?? (expanded ? 1 : 0));
    handle.style.left = `${native.compactX || 0}px`;
    handle.style.top = `${native.compactY || 0}px`;
    handle.style.width = `${native.compactWidth || 16}px`;
    handle.style.height = `${native.compactHeight || 64}px`;
    handle.style.opacity = String(1 - (native.unfold ?? 0));
    handle.inert = expanded;
    const appearance = {
      theme: native.appearance?.hostTheme?.theme || (native.nativeDark ? 'dark' : 'light'),
      surface: { theme: native.theme, liquidVariant: native.liquidVariant },
    };
    Object.assign(panel.style, surfaceStyle(appearance, true));
    Object.assign(handle.style, surfaceStyle(appearance, true));
    visibility();
    if (native.sceneRevision !== scene) {
      scene = native.sceneRevision;
      const revision = scene;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!stopped && scene === revision) ipc({ action: 'scene-ready', revision });
        }),
      );
    }
  });
  window.addEventListener('edge-pointer', (event) => {
    const detail = (event as CustomEvent).detail;
    inside = detail.inside;
    buttons = detail.buttons;
    clearTimeout(enter);
    if (inside) {
      clearTimeout(leave);
      if (!expanded && !detail.hoverSuppressed && !buttons)
        enter = window.setTimeout(() => ipc({ action: 'expand', keyboard: false }), 100);
    } else scheduleCollapse();
  });
  handle.onclick = () => ipc({ action: 'expand', keyboard: true });
  document.getElementById('edge-collapse')!.onclick = collapse;
  panel.addEventListener('pointerdown', () => ipc({ action: 'focus' }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !held()) collapse();
  });
  void refresh();
  const timer = setInterval(() => void refresh(), 600);
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(enter);
      clearTimeout(leave);
    },
    { once: true },
  );
  ipc({ action: 'ready' });
  ipc({ action: 'content-size', height: 600 });
}
