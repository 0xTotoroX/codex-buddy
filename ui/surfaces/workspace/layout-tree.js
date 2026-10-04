/* [INPUT]: Saved flat or nested feature layouts and drag destinations.
 * [OUTPUT]: Leaf traversal, minimum geometry and local split/merge with released visible allocations.
 * [POS]: Pure workspace geometry shared by rendering and settings; no business state.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
/** @typedef {import('../../shared/features').FeatureLayout} FeatureLayout */
/** @typedef {import('../../shared/features').LayoutNode} LayoutNode */

/** @param {FeatureLayout} layout
 * @returns {import('../../shared/features').LayoutGroup[]} */
export function layoutGroups(layout) {
  return layout.groups.flatMap((node) => ('groups' in node ? layoutGroups(node) : [node]));
}

/** @param {FeatureLayout | LayoutNode} node */
export function layoutMinimum(node, visibleIds = null) {
  if (!('groups' in node))
    return !visibleIds || node.ids.some((id) => visibleIds.includes(id))
      ? { width: 180, height: 180 }
      : { width: 0, height: 0 };
  const sizes = node.groups
    .map((group) => layoutMinimum(group, visibleIds))
    .filter((size) => size.width && size.height);
  const sum = (key) =>
    sizes.reduce((total, size) => total + size[key], 0) + Math.max(0, sizes.length - 1) * 8;
  const max = (key) => Math.max(0, ...sizes.map((size) => size[key]));
  return node.axis === 'horizontal'
    ? { width: sum('width'), height: max('height') }
    : { width: max('width'), height: sum('height') };
}

/** Transfer released visible space locally, retaining closed feature preferences before compacting.
 * @param {FeatureLayout} layout */
function compact(layout, target, visibleIds, previouslyVisible) {
  const present = (node) => ('groups' in node ? node.groups.length : node.ids.length);
  const visible = (node) =>
    present(node) &&
    (!visibleIds ||
      ('groups' in node ? layoutGroups(node) : [node]).some((g) =>
        g.ids.some((id) => visibleIds.includes(id)),
      ));
  const contains = (node) =>
    node &&
    present(node) &&
    ('groups' in node ? layoutGroups(node) : [node]).some((g) => g.ids.includes(target));
  layout.groups.forEach((node) => {
    if ('groups' in node) compact(node, target, visibleIds, previouslyVisible);
  });
  layout.groups.forEach((node, index, groups) => {
    if (present(node) && (!previouslyVisible.has(node) || visible(node))) return;
    const previous = groups.slice(0, index).findLast(visible);
    const following = groups.slice(index + 1).find(visible);
    const receiver =
      [previous, following].find(contains) ||
      following ||
      previous ||
      (!present(node) &&
        (groups.slice(index + 1).find(present) || groups.slice(0, index).findLast(present)));
    if (receiver) receiver.weight += node.weight;
  });
  layout.groups = layout.groups.flatMap((node) => {
    if (!('groups' in node)) return node.ids.length ? [node] : [];
    if (!node.groups.length) return [];
    if (node.groups.length === 1) return [{ ...node.groups[0], weight: node.weight }];
    return [node];
  });
}

/** @param {FeatureLayout} value */
export function arrangeFeatureLayout(value, id, action, width, height, target, visibleIds = null) {
  const next = structuredClone(value);
  const leaves = layoutGroups(next);
  const source = leaves.find((group) => group.ids.includes(id));
  if (!source) return null;
  if (action === 'activate') {
    source.active = id;
    return next;
  }
  if (!['left', 'right', 'top', 'bottom', 'merge'].includes(action)) return null;
  const destination = leaves.find((group) => group.ids.includes(target));
  if (!destination || (source === destination && source.ids.length === 1)) return null;
  const previouslyVisible = new Set();
  const rememberVisible = (node) => {
    if ('groups' in node) node.groups.forEach(rememberVisible);
    const groups = 'groups' in node ? layoutGroups(node) : [node];
    if (!visibleIds || groups.some((group) => group.ids.some((id) => visibleIds.includes(id))))
      previouslyVisible.add(node);
  };
  rememberVisible(next);
  source.ids = source.ids.filter((entry) => entry !== id);
  if (source.active === id) source.active = source.ids[0];
  if (action === 'merge') {
    destination.ids.push(id);
    destination.active = id;
  } else {
    /** @param {FeatureLayout} parent */
    const split = (parent) => {
      const index = parent.groups.indexOf(destination);
      if (index < 0) {
        parent.groups.forEach((node) => {
          if ('groups' in node) split(node);
        });
        return;
      }
      const pair = [
        { ...destination, weight: 1 },
        { ids: [id], active: id, weight: 1 },
      ];
      if (['left', 'top'].includes(action)) pair.reverse();
      parent.groups[index] = {
        axis: ['left', 'right'].includes(action) ? 'horizontal' : 'vertical',
        weight: destination.weight,
        groups: pair,
      };
    };
    split(next);
  }
  compact(next, target, visibleIds, previouslyVisible);
  while (next.groups.length === 1 && 'groups' in next.groups[0]) {
    const branch = next.groups[0];
    next.axis = branch.axis;
    next.groups = branch.groups;
  }
  const minimum = layoutMinimum(next, visibleIds);
  return action !== 'merge' && (width < minimum.width || height < minimum.height) ? null : next;
}
