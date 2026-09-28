/* [INPUT]: Live feature mounts with header actions, per-surface layout and authenticated save callback.
 * [OUTPUT]: Flat/nested layout interpretation, tabs, local split/merge, focus and resizing with checked saves; views stay mounted.
 * [POS]: Presentation-only composition; reuses the workbench gestures and styles.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { titles } from '../../shared/features';
import { installArrangement } from './arrangement.js';
import { bindSeparator } from './separator.js';
import { layoutGroups, layoutMinimum, arrangeFeatureLayout } from './layout-tree.js';

// Settings and the workspace must interpret an old two-feature layout identically.
/** @returns {import('../../shared/features').FeatureLayout} */
export function resolveFeatureLayout(saved, legacy, ids) {
  if (saved) return structuredClone(saved);
  const first = legacy?.first || 'outline';
  const other = first === 'outline' ? 'next' : 'outline';
  const ratio = legacy?.mode === 'horizontal' ? legacy.horizontalRatio : legacy?.verticalRatio;
  return legacy?.group === 'split' && ids.includes(first) && ids.includes(other)
    ? {
        axis: legacy.mode,
        groups: [
          {
            ids: ids.filter((id) => id !== other),
            active: first,
            weight: ratio || 0.45,
          },
          { ids: [other], active: other, weight: 1 - (ratio || 0.45) },
        ],
      }
    : {
        axis: 'auto',
        groups: [
          {
            ids,
            active: ids.includes(legacy?.active) ? legacy.active : ids[0],
            weight: 1,
          },
        ],
      };
}

export function installFeatureLayout(root, { save, error }) {
  const panes = document.createElement('div');
  panes.className = 'csw-workbench-panes csw-feature-panes';
  root.append(panes);
  /** @type {import('../../shared/features').FeatureLayout} */
  let layout;
  let placement,
    items = [],
    shape = null,
    selected = '';
  const containers = new WeakMap();
  let dirty = false,
    saving = false,
    revision = 0;
  const cache = new Map();
  const inputs = new Map();
  const persisted = new Map();
  function visible(node) {
    if (!node.groups) {
      const ids = node.ids.filter((id) => items.some((item) => item.id === id && item.active));
      return ids.length ? { ...node, ids, original: node } : null;
    }
    const groups = node.groups.map(visible).filter(Boolean);
    return groups.length ? { ...node, groups, original: node } : null;
  }
  async function persist() {
    dirty = true;
    revision++;
    if (saving) return;
    saving = true;
    root.dataset.layoutSaving = 'true';
    let surface = placement;
    try {
      while (dirty) {
        const current = revision;
        surface = placement;
        const next = structuredClone(layout);
        await save(surface, next, structuredClone(persisted.get(surface) ?? null));
        persisted.set(surface, next);
        if (current === revision) dirty = false;
      }
    } catch (e) {
      dirty = false;
      cache.delete(surface);
      inputs.delete(surface);
      if (placement === surface) placement = null;
      error(e);
    } finally {
      saving = false;
      delete root.dataset.layoutSaving;
    }
  }
  const arrange = (value, id, action, width, height, target) =>
    arrangeFeatureLayout(
      value,
      id,
      action,
      width,
      height,
      target,
      items.filter((item) => item.active).map((item) => item.id),
    );
  const arrangement = installArrangement(root, {
    read: () => layout,
    write: (next) => {
      layout = next;
      cache.set(placement, layout);
      render();
      void persist();
    },
    update: () => render(),
    enabled: (id) => items.some((item) => item.id === id && item.active && !item.node.inert),
    arrange,
    targetAt(event, id, { width, height }) {
      for (const section of /** @type {NodeListOf<HTMLElement>} */ (
        panes.querySelectorAll('section[data-pane]')
      )) {
        const box = section.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width,
          y = (event.clientY - box.top) / box.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) continue;
        const edge = Math.min(x, 1 - x, y, 1 - y);
        const action =
          edge >= 0.25
            ? 'merge'
            : edge === x
              ? 'left'
              : edge === 1 - x
                ? 'right'
                : edge === y
                  ? 'top'
                  : 'bottom';
        const target = section.dataset.pane;
        if (arrange(layout, id, action, width, height, target)) return { action, box, id: target };
      }
      return null;
    },
  });
  function createSection(group) {
    const section = document.createElement('section');
    section.className = 'csw-workbench-pane';
    const tabs = document.createElement('nav');
    tabs.className = 'csw-workbench-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '工作台面板');
    for (const id of group.ids) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.dataset.paneTab = id;
      tab.setAttribute('role', 'tab');
      tab.textContent = titles[id];
      tab.title = '拖动分栏或合并；双击放大';
      tabs.append(tab);
    }
    const body = document.createElement('div');
    body.className = 'csw-feature-content';
    const head = document.createElement('div');
    head.className = 'csw-feature-pane-head';
    const actions = document.createElement('div');
    actions.className = 'csw-feature-header-actions';
    head.append(tabs, actions);
    section.append(head, body);
    // Move the mounted roots before removing their old containers: preserve drafts and scroll.
    for (const item of items) if (group.ids.includes(item.id)) body.append(item.node);
    return section;
  }
  function createSeparator(container, index) {
    const separator = document.createElement('div');
    separator.className = 'csw-workbench-split';
    separator.setAttribute('role', 'separator');
    separator.tabIndex = 0;
    separator.setAttribute('aria-label', '调整分栏比例');
    bindSeparator(
      separator,
      () => (container.dataset.axis === 'horizontal' ? 'x' : 'y'),
      () => {
        const { groups } = containers.get(container);
        const axis = container.dataset.axis;
        const size = axis === 'horizontal' ? 'width' : 'height';
        return {
          first: container.children[(index - 1) * 2].getBoundingClientRect()[size],
          second: container.children[index * 2].getBoundingClientRect()[size],
          previous: groups[index - 1].original,
          next: groups[index].original,
          minimumFirst: layoutMinimum(groups[index - 1])[size],
          minimumSecond: layoutMinimum(groups[index])[size],
          axis,
        };
      },
      (start, delta) => {
        if (start.axis !== container.dataset.axis) return;
        const total = start.first + start.second;
        if (total < start.minimumFirst + start.minimumSecond) return;
        const ratio =
          Math.max(start.minimumFirst, Math.min(total - start.minimumSecond, start.first + delta)) /
          total;
        const weight = start.previous.weight + start.next.weight;
        start.previous.weight = weight * ratio;
        start.next.weight = weight * (1 - ratio);
        render();
      },
      () => void persist(),
    );
    return separator;
  }
  function build(node, container) {
    const fragments = [];
    node.groups.forEach((group, index) => {
      if (index) fragments.push(createSeparator(container, index));
      if (group.groups) {
        const branch = document.createElement('div');
        branch.className = 'csw-feature-split';
        build(group, branch);
        fragments.push(branch);
      } else fragments.push(createSection(group));
    });
    container.replaceChildren(...fragments);
  }
  function updateSection(section, group, focused) {
    const active = group.ids.includes(group.active) ? group.active : group.ids[0];
    section.dataset.pane = active;
    section.setAttribute('aria-label', titles[active]);
    const body = section.querySelector('.csw-feature-content');
    for (const item of items.filter((entry) => group.ids.includes(entry.id))) {
      if (item.node.parentNode !== body) body.append(item.node);
      item.node.hidden = !item.active || item.id !== (focused || active);
      const actions = item.mount?.headerActions;
      if (actions) {
        const slot = section.querySelector('.csw-feature-header-actions');
        if (actions.parentNode !== slot) slot.append(actions);
        actions.hidden = item.node.hidden;
      }
    }
    for (const tab of section.querySelectorAll('button[data-pane-tab]')) {
      const current = tab.dataset.paneTab === (focused || active);
      tab.setAttribute('aria-selected', String(current));
      tab.tabIndex = current ? 0 : -1;
    }
  }
  function updateGrid(node, container, focused) {
    containers.set(container, node);
    const included = (group) =>
      !focused ||
      (group.groups
        ? layoutGroups(group).some((g) => g.ids.includes(focused))
        : group.ids.includes(focused));
    const shown = node.groups.filter(included);
    const horizontalMinimum = layoutMinimum({ ...node, axis: 'horizontal', groups: shown }).width;
    const axis =
      node.axis !== 'vertical' && container.clientWidth >= horizontalMinimum
        ? 'horizontal'
        : 'vertical';
    container.dataset.axis = axis;
    const tracks = [];
    node.groups.forEach((group, index) => {
      const element = container.children[index * 2];
      element.hidden = !included(group);
      if (index) {
        const handle = container.children[index * 2 - 1];
        handle.hidden = !!focused;
        handle.setAttribute('aria-orientation', axis === 'horizontal' ? 'vertical' : 'horizontal');
        const previous = node.groups[index - 1];
        handle.setAttribute(
          'aria-valuenow',
          String(Math.round((previous.weight / (previous.weight + group.weight)) * 100)),
        );
      }
      if (!element.hidden) {
        if (tracks.length) tracks.push('8px');
        // Narrow windows can scroll without rewriting the saved geometry.
        const minimum = layoutMinimum(group)[axis === 'horizontal' ? 'width' : 'height'];
        tracks.push(`minmax(${shown.length === 1 ? 0 : minimum}px, ${group.weight}fr)`);
      }
    });
    container.style.gridTemplateColumns =
      axis === 'horizontal' ? tracks.join(' ') : 'minmax(0,1fr)';
    container.style.gridTemplateRows = axis === 'vertical' ? tracks.join(' ') : 'minmax(0,1fr)';
    node.groups.forEach((group, index) => {
      const element = container.children[index * 2];
      if (group.groups) updateGrid(group, element, focused);
      else updateSection(element, group, focused);
    });
  }
  function render() {
    if (!layout) return;
    const tree = visible(layout);
    if (!tree) {
      panes.replaceChildren();
      shape = null;
      return;
    }
    const signature = (node) => (node.groups ? [node.axis, node.groups.map(signature)] : node.ids);
    const nextShape = JSON.stringify(signature(tree));
    if (shape !== nextShape) {
      shape = nextShape;
      build(tree, panes);
    }
    const focused = arrangement.focused;
    root.dataset.composition = focused ? 'focus' : layoutGroups(tree).length > 1 ? 'split' : 'tabs';
    updateGrid(tree, panes, focused);
    arrangement.sync();
  }
  const observer = new ResizeObserver(render);
  observer.observe(panes);
  return {
    update(nextItems, surface, saved, legacy, reveal, revealVersion = 0) {
      items = nextItems;
      const changedSurface = placement !== surface;
      const incoming = JSON.stringify([saved, legacy]);
      if (
        !dirty &&
        !saving &&
        inputs.has(surface) &&
        inputs.get(surface) !== incoming &&
        (JSON.stringify(saved ?? null) !== JSON.stringify(persisted.get(surface) ?? null) ||
          (!saved &&
            JSON.stringify(JSON.parse(inputs.get(surface))[1]) !== JSON.stringify(legacy ?? null)))
      ) {
        cache.delete(surface);
        if (placement === surface) placement = null;
      }
      if (!dirty && !saving && inputs.get(surface) !== incoming) {
        inputs.set(surface, incoming);
        persisted.set(surface, structuredClone(saved ?? null));
      }
      if (placement !== surface) {
        arrangement.cancel();
        placement = surface;
        shape = null;
        if (changedSurface) selected = '';
        layout = cache.get(surface) || (saved && structuredClone(saved));
        if (!layout) {
          const ids = items.filter((item) => item.active).map((item) => item.id);
          layout = resolveFeatureLayout(null, legacy, ids);
        }
      }
      const known = new Set(layoutGroups(layout).flatMap((group) => group.ids));
      for (const item of items)
        if (item.active && !known.has(item.id)) {
          layoutGroups(layout)[0].ids.push(item.id);
          known.add(item.id);
        }
      const selection = `${reveal}:${revealVersion}`;
      if (
        reveal &&
        selection !== selected &&
        items.some((item) => item.id === reveal && item.active)
      ) {
        const group = layoutGroups(layout).find((group) => group.ids.includes(reveal));
        if (group) {
          group.active = reveal;
          selected = selection;
        }
      }
      cache.set(surface, layout);
      if (
        arrangement.focused &&
        !items.some((item) => item.active && item.id === arrangement.focused)
      )
        arrangement.command(arrangement.focused, 'focus');
      for (const item of items)
        if (!item.active) {
          item.node.hidden = true;
          if (item.mount?.headerActions) item.mount.headerActions.hidden = true;
        }
      render();
    },
    destroy() {
      observer.disconnect();
      arrangement.destroy();
      panes.remove();
    },
  };
}
