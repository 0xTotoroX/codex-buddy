/* [INPUT]: Live feature mounts, per-surface layout and authenticated save callback.
 * [OUTPUT]: Shared layout interpretation, tabs, split/merge, focus and resizing with checked saves; views stay mounted.
 * [POS]: Presentation-only composition; reuses the workbench gestures and styles.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { titles } from '../../shared/features';
import { installArrangement } from './arrangement.js';
import { bindSeparator } from './separator.js';

// Settings and the workspace must interpret an old two-feature layout identically.
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
  let layout,
    placement,
    items = [],
    shape = '',
    selected = '',
    activeAxis = 'vertical';
  let dirty = false,
    saving = false,
    revision = 0;
  const cache = new Map();
  const inputs = new Map();
  const persisted = new Map();
  const visible = () => {
    const ids = new Set(items.filter((item) => item.active).map((item) => item.id));
    return layout.groups
      .map((group) => ({ ...group, ids: group.ids.filter((id) => ids.has(id)) }))
      .filter((group) => group.ids.length);
  };
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
  function arrange(value, id, action, width, height, target) {
    const next = structuredClone(value);
    const source = next.groups.find((group) => group.ids.includes(id));
    if (!source) return null;
    if (action === 'activate') {
      source.active = id;
      return next;
    }
    if (!['left', 'right', 'top', 'bottom', 'merge'].includes(action)) return null;
    const destination = next.groups.find((group) => group.ids.includes(target));
    if (!destination || (source === destination && source.ids.length === 1)) return null;
    const horizontal = ['left', 'right'].includes(action);
    if (action !== 'merge') {
      const count = visible().length + (source.ids.length > 1 ? 1 : 0);
      if ((horizontal ? width : height) < count * (horizontal ? 260 : 180) + (count - 1) * 8)
        return null;
    }
    source.ids = source.ids.filter((entry) => entry !== id);
    if (source.active === id) source.active = source.ids[0];
    if (action === 'merge') {
      destination.ids.push(id);
      destination.active = id;
    } else {
      const index =
        next.groups.indexOf(destination) + (['right', 'bottom'].includes(action) ? 1 : 0);
      next.groups.splice(index, 0, { ids: [id], active: id, weight: 1 });
      next.axis = horizontal ? 'horizontal' : 'vertical';
    }
    next.groups = next.groups.filter((group) => group.ids.length);
    return next;
  }
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
  function render() {
    if (!layout) return;
    const groups = visible();
    const nextShape = groups.map((group) => group.ids.join(',')).join('|');
    if (shape !== nextShape) {
      shape = nextShape;
      const fragments = [];
      groups.forEach((group, index) => {
        if (index) {
          const separator = document.createElement('div');
          separator.className = 'csw-workbench-split';
          separator.setAttribute('role', 'separator');
          separator.tabIndex = 0;
          separator.setAttribute('aria-label', '调整分栏比例');
          bindSeparator(
            separator,
            () => (activeAxis === 'horizontal' ? 'x' : 'y'),
            () => {
              const sections = [...panes.querySelectorAll('section')];
              const size = activeAxis === 'horizontal' ? 'width' : 'height';
              return {
                first: sections[index - 1].getBoundingClientRect()[size],
                second: sections[index].getBoundingClientRect()[size],
                axis: activeAxis,
              };
            },
            (start, delta) => {
              if (start.axis !== activeAxis) return;
              const left = layout.groups.find((g) => g.ids.includes(group.ids[0]));
              const previous = layout.groups.find((g) => g.ids.includes(groups[index - 1].ids[0]));
              const total = start.first + start.second,
                minimum = activeAxis === 'horizontal' ? 260 : 180;
              if (total < minimum * 2) return;
              const ratio =
                Math.max(minimum, Math.min(total - minimum, start.first + delta)) / total;
              const weight = previous.weight + left.weight;
              previous.weight = weight * ratio;
              left.weight = weight * (1 - ratio);
              render();
            },
            () => void persist(),
          );
          fragments.push(separator);
        }
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
        section.append(tabs, body);
        fragments.push(section);
      });
      // Move the mounted roots before removing their old containers: preserve drafts and scroll.
      const sections = fragments.filter((node) => node.tagName === 'SECTION');
      for (const item of items) {
        const index = groups.findIndex((group) => group.ids.includes(item.id));
        if (index >= 0) sections[index].querySelector('.csw-feature-content').append(item.node);
      }
      panes.replaceChildren(...fragments);
    }
    const focused = arrangement.focused;
    const count = groups.length;
    activeAxis =
      layout.axis !== 'vertical' && panes.clientWidth >= count * 260 + (count - 1) * 8
        ? 'horizontal'
        : 'vertical';
    panes.dataset.axis = activeAxis;
    root.dataset.composition = focused ? 'focus' : count > 1 ? 'split' : 'tabs';
    const sections = [...panes.querySelectorAll('section')];
    const tracks = [];
    groups.forEach((group, index) => {
      const active = group.ids.includes(group.active) ? group.active : group.ids[0];
      const section = sections[index];
      section.dataset.pane = active;
      section.setAttribute('aria-label', titles[active]);
      section.hidden = !!focused && !group.ids.includes(focused);
      const body = section.querySelector('.csw-feature-content');
      for (const item of items.filter((entry) => group.ids.includes(entry.id))) {
        if (item.node.parentNode !== body) body.append(item.node);
        item.node.hidden = !item.active || item.id !== (focused || active);
      }
      for (const tab of /** @type {NodeListOf<HTMLButtonElement>} */ (
        section.querySelectorAll('button[data-pane-tab]')
      )) {
        const current = tab.dataset.paneTab === (focused || active);
        tab.setAttribute('aria-selected', String(current));
        tab.tabIndex = current ? 0 : -1;
      }
      if (index) tracks.push('8px');
      tracks.push(`minmax(${activeAxis === 'horizontal' ? 260 : 180}px, ${group.weight}fr)`);
    });
    const single = !!focused || count < 2;
    panes.style.gridTemplateColumns =
      !single && activeAxis === 'horizontal' ? tracks.join(' ') : 'minmax(0,1fr)';
    panes.style.gridTemplateRows =
      !single && activeAxis === 'vertical' ? tracks.join(' ') : 'minmax(0,1fr)';
    /** @type {NodeListOf<HTMLElement>} */ (
      panes.querySelectorAll('div[role="separator"]')
    ).forEach((handle, index) => {
      handle.hidden = single;
      handle.setAttribute(
        'aria-orientation',
        activeAxis === 'horizontal' ? 'vertical' : 'horizontal',
      );
      const ratio = groups[index].weight / (groups[index].weight + groups[index + 1].weight);
      handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    });
    arrangement.sync();
  }
  const observer = new ResizeObserver(render);
  observer.observe(panes);
  return {
    update(nextItems, surface, saved, legacy, reveal, revealVersion = 0) {
      items = nextItems;
      const changedSurface = placement !== surface;
      const incoming = JSON.stringify([saved, legacy]);
      if (!dirty && !saving && inputs.has(surface) && inputs.get(surface) !== incoming) {
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
        shape = '';
        if (changedSurface) selected = '';
        layout = cache.get(surface) || (saved && structuredClone(saved));
        if (!layout) {
          const ids = items.filter((item) => item.active).map((item) => item.id);
          layout = resolveFeatureLayout(null, legacy, ids);
        }
      }
      const known = new Set(layout.groups.flatMap((group) => group.ids));
      for (const item of items)
        if (item.active && !known.has(item.id)) {
          layout.groups[0].ids.push(item.id);
          known.add(item.id);
        }
      const selection = `${reveal}:${revealVersion}`;
      if (
        reveal &&
        selection !== selected &&
        items.some((item) => item.id === reveal && item.active)
      ) {
        const group = layout.groups.find((group) => group.ids.includes(reveal));
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
      for (const item of items) if (!item.active) item.node.hidden = true;
      render();
    },
    destroy() {
      observer.disconnect();
      arrangement.destroy();
      panes.remove();
    },
  };
}
