/* [INPUT]: Native edge geometry/events and feature owners. [OUTPUT]: Tabbed edge shell with per-view header slots.
 * [POS]: Keeps mounted views alive while collapsed or in another tab; no business state.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { mountFeature } from '../workspace/mount';
import { titles, type FeatureState, type Request } from '../../shared/features';
import { surfaceStyle } from '../theme/appearance';
import styles from './styles.css?inline';
export function startEdge(request: Request) {
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);
  const root = document.getElementById('root')!;
  root.innerHTML = `<button id="edge-handle" aria-label="展开功能面板"></button><section id="edge-panel"><header><nav aria-label="功能"></nav></header><p id="edge-error" role="alert" hidden></p><div id="edge-views"></div></section>`;
  const panel = document.getElementById('edge-panel')!,
    handle = document.getElementById('edge-handle')!,
    tabs = panel.querySelector('nav')!,
    error = document.getElementById('edge-error')!,
    views = document.getElementById('edge-views')!;
  const mounts = new Map<
    string,
    {
      id: string;
      owner: string;
      node: HTMLElement;
      headerActions: HTMLElement;
      mount: ReturnType<typeof mountFeature>;
      reveal: number;
    }
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
    leave = 0,
    measureFrame = 0,
    measured = '';
  const ipc = (value: object) => window.ipc?.postMessage(JSON.stringify(value));
  const measure = () => {
    if (stopped || measureFrame || native.animating) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      if (native.animating) return;
      const item = [...mounts.values()].find(
        ({ id, node }) => id === selected && node.dataset.active === 'true',
      );
      const size = item?.mount.measure();
      if (!size) return;
      const style = getComputedStyle(panel);
      const width = size.width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const height =
        size.height +
        panel.querySelector('header')!.getBoundingClientRect().height +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      const key = `${Math.ceil(width)}:${Math.ceil(height)}`;
      if (key === measured) return;
      measured = key;
      ipc({ action: 'content-size', width: Math.ceil(width), height: Math.ceil(height) });
    });
  };
  const contentChanges = new MutationObserver(measure);
  const contentResize = new ResizeObserver(measure);

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
      item.headerActions.hidden = item.node.hidden || item.node.dataset.active !== 'true';
      item.node.inert =
        !expanded ||
        item.id !== selected ||
        document.documentElement.dataset.buddyReloading === 'true';
      item.headerActions.inert = item.node.inert;
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
            const headerActions = document.createElement('span');
            headerActions.className = 'edge-feature-actions';
            headerActions.hidden = true;
            tabs.after(headerActions);
            item = {
              id: entry.id,
              owner: candidate.owner,
              node,
              headerActions,
              mount: mountFeature(
                node,
                entry,
                candidate.owner,
                'edge',
                request,
                () => void refresh(),
                undefined,
                headerActions,
              ),
              reveal: entry.reveal,
            };
            mounts.set(key, item);
            contentChanges.observe(node.shadowRoot!, {
              subtree: true,
              childList: true,
              characterData: true,
              attributes: true,
            });
            contentResize.observe(node);
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
          contentResize.unobserve(item.node);
          item.mount.dispose();
          item.headerActions.remove();
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
      measure();
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
      colors: native.appearance?.hostTheme?.colors,
      surface: { theme: native.theme, liquidVariant: native.liquidVariant },
    };
    Object.assign(panel.style, surfaceStyle(appearance, true));
    Object.assign(handle.style, surfaceStyle(appearance, true));
    visibility();
    measure();
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
      cancelAnimationFrame(measureFrame);
      contentChanges.disconnect();
      contentResize.disconnect();
      clearTimeout(enter);
      clearTimeout(leave);
    },
    { once: true },
  );
  ipc({ action: 'ready' });
}
