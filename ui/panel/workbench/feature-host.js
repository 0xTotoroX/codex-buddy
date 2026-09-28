/* [INPUT]: Feature owners, saved placements and the existing capsule/dock.
 * [OUTPUT]: Business views inside the original workbench shell; no launcher menu.
 * [POS]: Host content adapter. Geometry and gestures remain in core.
 * [PROTOCOL]: Keep workbench/AGENTS.md in sync. */
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
  dock = null;
let dockValue = { status: '', rect: null };
let primary = 'overlay';
let selected = '';
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
  selected = id;
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
function showError(error) {
  const node = shellState.panel?.querySelector('[data-feature-error]');
  if (node) {
    node.textContent = String(error);
    node.hidden = false;
  }
}
export async function popoutSelectedFeature() {
  const id = selected || group(primary)[0]?.id;
  if (!id) return;
  try {
    render(await request({ op: 'main-placement', placement: 'desktop' }));
  } catch (e) {
    showError(e);
  }
}
export function toggleFeatureDock(open) {
  shellState.dockOpen = open;
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
  if (!entries.some((e) => e.id === selected)) selected = entries[0]?.id || '';
  const tabs = root.querySelector('nav');
  const key = entries.map((e) => e.id).join(':') + selected;
  if (tabs.dataset.key !== key) {
    tabs.dataset.key = key;
    tabs.replaceChildren();
    tabs.hidden = entries.length < 2;
    for (const entry of entries) {
      const button = document.createElement('button');
      button.textContent = titles[entry.id];
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(selected === entry.id));
      button.onclick = () => {
        selected = entry.id;
        content(root, placement);
      };
      tabs.append(button);
    }
  }
  root.querySelector('.csw-workbench-face').dataset.expression = resolveFabExpression();
  const body = root.querySelector('.csw-feature-content');
  for (const item of mounts.values()) {
    if (item.node.parentNode !== body) body.append(item.node);
    item.node.hidden = item.placement !== placement || item.id !== selected || !item.active;
    item.node.inert = !item.active;
  }
}
// Called after the original shell has installed its DOM. Never replace live mounts on collapse.
export function renderFeatureShell(faceClick) {
  if (!state || !shellState.panel) return;
  const root = frame(shellState.panel, faceClick);
  content(root, primary);
  updateDock();
}
function updateDock() {
  if (!state || !shellState.root) return;
  const entries = primary === 'sidebar' ? group('sidebar') : [];
  if (primary !== 'sidebar' && dock) {
    dock.destroy();
    dock = null;
    dockValue = { status: '', rect: null };
  }
  if (!dock && entries.length)
    dock = createDock(
      (value) => {
        dockValue = value;
        if (primary === 'sidebar') {
          const changed = shellState.dockStatus !== value.status;
          shellState.dockStatus = value.status;
          shellState.dockRect = value.rect;
          if (changed) emitSignal('render', undefined);
        }
      },
      () => void revealFeature(selected, 'desktop').catch(showError),
      () => void revealFeature(selected, 'overlay').catch(showError),
    );
  if (!dock) return;
  if (primary !== 'sidebar') {
    delete shellState.root.dataset.dockMounted;
    shellState.dockRect = null;
    shellState.dockStatus = '';
  }
  dock.attachRoot(shellState.root);
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
  primary =
    next.mainPlacement || next.features.find((e) => e.placement !== 'edge')?.placement || 'sidebar';
  shellState.layoutMode = primary === 'sidebar' ? 'workbench' : 'capsule';
  shellState.dockStatus = primary === 'sidebar' ? dockValue.status : '';
  shellState.dockRect = primary === 'sidebar' ? dockValue.rect : null;
  if (next.activeFeature && next.activeFeature !== previous?.activeFeature)
    selected = next.activeFeature;
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
      item.placement = candidate.placement;
      item.active = entry.owner === candidate.owner && entry.open;
      if (
        item.active &&
        previous &&
        previous.features.find((e) => e.id === entry.id)?.reveal !== entry.reveal
      ) {
        if (!previous.pendingPlacement) selected = entry.id;
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
  epoch++;
  clearInterval(timer);
  timer = 0;
  for (const item of mounts.values()) item.mount.dispose();
  mounts.clear();
  dock?.destroy();
  dock = null;
  state = null;
  independent = false;
}
