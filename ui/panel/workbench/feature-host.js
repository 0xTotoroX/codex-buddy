/* [INPUT]: Feature owners, saved placements and the existing capsule/dock.
 * [OUTPUT]: Business views inside the original workbench shell; no launcher menu.
 * [POS]: Host content adapter. Geometry and gestures remain in core.
 * [PROTOCOL]: Keep workbench/AGENTS.md in sync. */
import { surfaceStyle } from '../../features/surface';
import { createSvgGlass } from '../glass/svg.js';
import { mountFeature } from '../../features/mount';
import { titles } from '../../features/types';
import { createDock } from '../host/dock.js';
import { bridgeCall, shellState, runtimeState } from '../runtime/state.js';
import { IS_POPOUT } from '../runtime/constants.js';
import { emitSignal } from '../runtime/signals.js';
import { stopWorkbench } from './layout.js';
import { resolveFabExpression } from '../core/shell.js';
import { workbenchHeadHtml, workbenchSettingsHtml } from './chrome.js';
import { openSettings } from '../runtime/settings-sync.js';
let timer = 0,
  epoch = 0,
  polling = false,
  independent = false;
let state = null,
  dock = null,
  secondary = null;
let secondaryGlass = null;
let secondaryFaceCleanup = () => {};
let dockValue = { status: '', rect: null };
let primary = 'overlay',
  opening = false;
const selected = { overlay: '', sidebar: '' };
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
  selected[placement || result.features.find((e) => e.id === id)?.placement] = id;
  if (!timer) startFeatureHost();
  render(result);
}
export function featurePlacement() {
  return primary;
}
export function featureTheme() {
  return state?.appearance?.themes[primary];
}
function group(placement) {
  return (
    state?.features.filter(
      (e) => e.placement === placement || e.pending?.placement === placement,
    ) || []
  );
}
export async function openConfiguredFeatures() {
  if (opening || !state) return;
  opening = true;
  if (secondary && !shellState.dockOpen) {
    shellState.dockOpen = true;
    dock?.reopen();
  }
  try {
    for (const entry of group(primary)) {
      if (!entry.open && !entry.pending) render(await request({ op: 'reveal', id: entry.id }));
    }
  } catch (e) {
    showError(e);
  } finally {
    opening = false;
  }
}
function showError(error) {
  const node = shellState.panel?.querySelector('[data-feature-error]');
  if (node) {
    node.textContent = String(error);
    node.hidden = false;
  }
}
export async function popoutSelectedFeature() {
  const id = selected[primary] || group(primary)[0]?.id;
  if (!id) return;
  try {
    await revealFeature(id, 'desktop');
  } catch (e) {
    showError(e);
  }
}
export function toggleFeatureDock(open) {
  shellState.dockOpen = open;
  if (open) void openConfiguredFeatures();
  dock?.reopen();
  emitSignal('render', undefined);
  if (open && shellState.dockStatus === 'space')
    dock?.showOptions(shellState.fab?.getBoundingClientRect());
}
function frame(container, faceClick) {
  let root = container.querySelector(':scope > .csw-workbench');
  if (root) return root;
  root = document.createElement('div');
  root.className = 'csw-workbench';
  root.innerHTML = `${workbenchHeadHtml()}<nav class="csw-workbench-tabs" role="tablist" aria-label="工作台面板"></nav><p data-feature-error role="alert" hidden></p><div class="csw-feature-content"></div>`;
  root.querySelector('.csw-workbench-controls').innerHTML = workbenchSettingsHtml();
  root.querySelector('.csw-workbench-face').addEventListener('click', faceClick);
  root
    .querySelector('[data-workbench-settings]')
    .addEventListener('click', () => void openSettings());
  container.replaceChildren(root);
  return root;
}
function content(root, placement) {
  const entries = group(placement).filter((entry) => entry.open || entry.pending);
  if (!entries.some((e) => e.id === selected[placement]))
    selected[placement] = entries[0]?.id || '';
  const tabs = root.querySelector('nav');
  const key = entries.map((e) => e.id).join(':') + selected[placement];
  if (tabs.dataset.key !== key) {
    tabs.dataset.key = key;
    tabs.replaceChildren();
    tabs.hidden = entries.length < 2;
    for (const entry of entries) {
      const button = document.createElement('button');
      button.textContent = titles[entry.id];
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(selected[placement] === entry.id));
      button.onclick = () => {
        selected[placement] = entry.id;
        content(root, placement);
      };
      tabs.append(button);
    }
  }
  root.querySelector('.csw-workbench-face').dataset.expression = resolveFabExpression();
  const body = root.querySelector('.csw-feature-content');
  for (const item of mounts.values()) {
    if (item.placement !== placement) continue;
    if (item.node.parentNode !== body) body.append(item.node);
    item.node.hidden = item.id !== selected[placement] || !item.active;
    item.node.inert = !item.active;
  }
}
// Called after the original shell has installed its DOM. Never replace live mounts on collapse.
export function renderFeatureShell(faceClick) {
  if (!state || !shellState.panel) return;
  const root = frame(shellState.panel, faceClick);
  content(root, primary);
  if (primary === 'overlay' && group('sidebar').length) {
    if (!secondary) {
      secondary = document.createElement('div');
      secondary.setAttribute('data-companion-stepwise-root', 'true');
      secondary.setAttribute('data-codex-buddy-features-root', 'true');
      secondary.style.cssText = 'position:absolute;inset:0;pointer-events:auto;';
      const other = frame(secondary, (event) => {
        secondaryFaceCleanup();
        const first = { x: event.clientX, y: event.clientY, time: performance.now() };
        const collapse = window.setTimeout(
          () => {
            shellState.dockOpen = false;
            updateDock();
          },
          event.detail === 0 ? 0 : 100,
        );
        const second = (next) => {
          if (
            performance.now() - first.time > 500 ||
            Math.hypot(next.clientX - first.x, next.clientY - first.y) > 6
          )
            return;
          secondaryFaceCleanup();
          next.preventDefault();
          next.stopImmediatePropagation();
          const id = selected.sidebar;
          if (id) void revealFeature(id, 'desktop').catch(showError);
        };
        document.addEventListener('click', second, true);
        const expires = window.setTimeout(() => secondaryFaceCleanup(), 500);
        secondaryFaceCleanup = () => {
          clearTimeout(collapse);
          clearTimeout(expires);
          document.removeEventListener('click', second, true);
        };
      });
      other.style.height = '100%';
    }
    content(secondary.firstElementChild, 'sidebar');
    const appearance = state.appearance;
    if (appearance) {
      secondary.dataset.surfaceTheme = appearance.themes.sidebar.theme;
      Object.assign(
        secondary.style,
        surfaceStyle({ ...appearance, surface: appearance.themes.sidebar }),
      );
      for (const [key, value] of Object.entries(appearance.colors || {}))
        secondary.style.setProperty(`--csw-${key}`, value);
      if (appearance.themes.sidebar.theme === 'native-glass') {
        try {
          secondaryGlass ||= createSvgGlass(secondary);
          secondaryGlass.refresh(appearance.themes.sidebar.liquidVariant);
        } catch {
          /* Existing CSS material fallback remains visible. */
        }
      } else {
        secondaryGlass?.destroy();
        secondaryGlass = null;
      }
    }
  } else if (secondary) {
    secondaryGlass?.destroy();
    secondaryGlass = null;
    secondary.remove();
    secondary = null;
  }
  updateDock();
}
function updateDock() {
  if (!state || !shellState.root) return;
  const entries = group('sidebar');
  if (!dock && entries.length)
    dock = createDock(
      (value) => {
        dockValue = value;
        if (primary === 'sidebar') {
          const changed = shellState.dockStatus !== value.status;
          shellState.dockStatus = value.status;
          shellState.dockRect = value.rect;
          if (changed) emitSignal('render', undefined);
        } else if (secondary) secondary.hidden = value.status !== 'open';
      },
      () => void revealFeature(selected.sidebar, 'desktop').catch(showError),
      () => void revealFeature(selected.sidebar, 'overlay').catch(showError),
    );
  if (!dock) return;
  if (primary !== 'sidebar') {
    delete shellState.root.dataset.dockMounted;
    shellState.dockRect = null;
    shellState.dockStatus = '';
  }
  dock.attachRoot(primary === 'sidebar' ? shellState.root : secondary);
  dock.update({
    width: shellState.dockWidth,
    open: entries.length > 0 && shellState.dockOpen,
    detached: false,
    popoutSupported: runtimeState.settings?.popoutSupported === true,
  });
}
/** @param {import('../../features/types').FeatureState} next */
function render(next) {
  if (!next.features.length) return;
  const previous = state;
  state = next;
  if (!independent) {
    stopWorkbench();
    independent = true;
    shellState.open = false;
  }
  primary = group('overlay').length ? 'overlay' : group('sidebar').length ? 'sidebar' : 'overlay';
  shellState.layoutMode = primary === 'sidebar' ? 'workbench' : 'capsule';
  shellState.dockStatus = primary === 'sidebar' ? dockValue.status : '';
  shellState.dockRect = primary === 'sidebar' ? dockValue.rect : null;
  const wanted = new Set();
  for (const entry of next.features) {
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
        const node = document.createElement('div');
        node.setAttribute('data-codex-buddy-features-root', 'true');
        node.style.cssText = 'height:100%;min-height:0;';
        item = {
          node,
          id: entry.id,
          placement: candidate.placement,
          active: false,
          mount: mountFeature(
            node,
            entry,
            candidate.owner,
            candidate.placement,
            request,
            () => void poll(),
          ),
        };
        mounts.set(key, item);
      } else item.mount.update(entry);
      item.active = entry.owner === candidate.owner && entry.open;
      if (
        item.active &&
        previous &&
        previous.features.find((e) => e.id === entry.id)?.reveal !== entry.reveal
      ) {
        selected[candidate.placement] = entry.id;
        if (candidate.placement === 'sidebar') shellState.dockOpen = true;
        else shellState.open = true;
      }
    }
  }
  for (const [key, item] of mounts)
    if (!wanted.has(key)) {
      item.mount.dispose();
      mounts.delete(key);
    }
  emitSignal('render', undefined);
}
async function poll() {
  if (polling) return;
  polling = true;
  const current = epoch;
  try {
    const next = await request({ op: 'state' });
    if (current === epoch) render(next);
  } catch {
    /* Keep live content until its owner changes. */
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
  secondaryFaceCleanup();
  epoch++;
  clearInterval(timer);
  timer = 0;
  for (const item of mounts.values()) item.mount.dispose();
  mounts.clear();
  dock?.destroy();
  dock = null;
  secondaryGlass?.destroy();
  secondaryGlass = null;
  secondary?.remove();
  secondary = null;
  state = null;
  independent = false;
}
