/* [INPUT]: Feature owners, saved placements, checked layout snapshots and the existing capsule/dock.
 * [OUTPUT]: Business views inside the original workbench shell; no launcher menu.
 * [POS]: Embedded surface adapter. Geometry and gestures remain in shell.
 * [PROTOCOL]: Keep embedded/AGENTS.md in sync. */
import { mountFeature } from '../workspace/mount';
import { installFeatureLayout } from '../workspace/layout';
import { bindSeparator } from '../workspace/separator.js';
import { createDock } from './dock.js';
import { bridgeCall, shellState, runtimeState, clamp } from '../../codex/runtime/state.js';
import { IS_POPOUT } from '../../shared/constants.js';
import { emitSignal } from '../../codex/runtime/signals.js';
import { stopWorkbench } from './legacy.js';
import { resolveFabExpression } from './shell/shell.js';
import { workbenchHeadHtml, workbenchSettingsHtml } from '../workspace/chrome.js';
import { openSettings } from '../../codex/runtime/settings-sync.js';
let timer = 0,
  epoch = 0,
  polling = false,
  independent = false;
let state = null,
  dock = null;
let composition = null;
let dockValue = { status: '', rect: null };
let primary = 'overlay';
let selected = '';
const mounts = new Map();
/** @type {import('../../shared/features').Request} */
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
  if (open && ['space', 'unsupported'].includes(shellState.dockStatus))
    dock?.showOptions(shellState.fab?.getBoundingClientRect());
}
function frame(container, faceClick) {
  let root = container.querySelector(':scope > .csw-workbench');
  if (root) return root;
  root = document.createElement('div');
  root.className = 'csw-workbench';
  root.innerHTML = `${workbenchHeadHtml()}<p data-feature-error role="alert" hidden></p><div class="csw-workbench-resize" role="separator" tabindex="0" aria-label="调整工作台宽度" aria-orientation="vertical" aria-valuemin="300" aria-valuemax="460"></div>`;
  root.querySelector('.csw-workbench-controls').innerHTML = workbenchSettingsHtml();
  root.querySelector('.csw-workbench-face').addEventListener('click', faceClick);
  root
    .querySelector('[data-workbench-settings]')
    .addEventListener('click', () => void openSettings());
  composition?.destroy();
  composition = installFeatureLayout(root, {
    save: async (placement, layout, expectedLayout) => {
      const entry = state.features.find((entry) => entry.open && entry.placement === placement);
      if (entry)
        await request({
          op: 'layout',
          id: entry.id,
          owner: entry.owner,
          placement,
          layout,
          expectedLayout,
        });
    },
    error: showError,
  });
  const handle = root.querySelector('.csw-workbench-resize');
  bindSeparator(
    handle,
    'x',
    () => shellState.dockWidth,
    (width, dx) => {
      shellState.dockWidth = clamp(width - dx, 300, 460);
      updateDock();
      emitSignal('render', undefined);
    },
  );
  container.replaceChildren(root);
  return root;
}
function content(root, placement) {
  const entries = group(placement).filter((entry) => entry.open || entry.pending);
  if (!entries.some((e) => e.id === selected)) selected = entries[0]?.id || '';
  root.querySelector('.csw-workbench-face').dataset.expression = resolveFabExpression();
  const handle = root.querySelector('.csw-workbench-resize');
  handle.hidden = placement !== 'sidebar';
  handle.setAttribute('aria-valuenow', String(shellState.dockWidth));
  const items = [...mounts.values()].filter((item) => item.placement === placement);
  for (const item of items)
    item.node.inert = !item.active || document.documentElement.dataset.buddyReloading === 'true';
  composition.update(
    items,
    placement,
    state.layouts?.[placement],
    state.legacyLayouts?.[placement],
    selected,
    state.features.find((entry) => entry.id === selected)?.reveal,
  );
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
/** @param {import('../../shared/features').FeatureState} next */
function render(next) {
  if (!next.features.length) return;
  const previous = state;
  state = { ...previous, ...next };
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
  composition?.destroy();
  composition = null;
  for (const item of mounts.values()) item.mount.dispose();
  mounts.clear();
  dock?.destroy();
  dock = null;
  state = null;
  independent = false;
}
