/* [INPUT]: Keyed configuration rows, committed list geometry and input modality.
 * [OUTPUT]: Presentation-only row keys and interruptible 200ms list reflow; no persistence.
 * [POS]: Settings lists reuse their DOM, layout and existing save handlers.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useId, useLayoutEffect, useRef } from 'react';

// Quick prompts have no persisted ID. Match surviving objects before equal values, then
// retain the slot on edits/server normalization. Duplicate prompts remain distinct.
export function usePromptKeys(
  items: readonly { label: string; prompt: string }[],
  revision?: number,
) {
  const prefix = useId();
  const serial = useRef(0);
  const previous = useRef<{ item: (typeof items)[number]; key: string }[]>([]);
  const removing = useRef<{ key: string; revision?: number } | null>(null);
  const shrank = items.length < previous.current.length;
  const available = new Set(
    previous.current.filter((entry) => !shrank || entry.key !== removing.current?.key),
  );
  const matches = items.map((item) => {
    const match = [...available].find((entry) => entry.item === item);
    if (match) available.delete(match);
    return match;
  });
  items.forEach((item, i) => {
    if (matches[i]) return;
    const match = [...available].find(
      (entry) => entry.item.label === item.label && entry.item.prompt === item.prompt,
    );
    if (match) {
      matches[i] = match;
      available.delete(match);
    }
  });
  const next = items.map((item, i) => {
    const slot = previous.current.length === items.length ? previous.current[i] : undefined;
    const match = matches[i] ?? (slot && available.has(slot) ? slot : undefined);
    if (match) available.delete(match);
    return { item, key: match?.key ?? `${prefix}-${serial.current++}` };
  });
  useLayoutEffect(() => {
    previous.current = next;
    if (shrank || removing.current?.revision !== revision) removing.current = null;
  });
  async function trackRemoval<R>(index: number, remove: () => Promise<R>): Promise<R> {
    removing.current = { key: next[index].key, revision };
    try {
      return await remove();
    } catch (error) {
      removing.current = null;
      throw error;
    }
  }
  return { keys: next.map(({ key }) => key), trackRemoval };
}

type Row = { node: HTMLElement; x: number; y: number; width: number; height: number };
type List = { width: number; rows: Map<string, Row> };
export function useSettingsListMotion<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const previous = useRef(new Map<string, List>());
  const active = useRef(new Map<HTMLElement, Animation>());
  function read() {
    const root = ref.current;
    const lists = new Map<string, List>();
    if (!root) return lists;
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-settings-list]')];
    if (root.hasAttribute('data-settings-list')) nodes.unshift(root);
    for (const list of nodes) {
      const origin = list.getBoundingClientRect();
      const rows = new Map<string, Row>();
      list.querySelectorAll<HTMLElement>(':scope > [data-settings-list-item]').forEach((node) => {
        const box = node.getBoundingClientRect();
        const transform = active.current.has(node)
          ? new DOMMatrixReadOnly(getComputedStyle(node).transform)
          : new DOMMatrixReadOnly();
        rows.set(node.dataset.settingsListItem!, {
          node,
          x: box.x - origin.x - transform.m41,
          y: box.y - origin.y - transform.m42,
          width: box.width,
          height: box.height,
        });
      });
      lists.set(list.dataset.settingsList!, { width: origin.width, rows });
    }
    return lists;
  }
  useLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => {
      active.current.forEach((animation) => animation.cancel());
      active.current.clear();
    };
    // Capture resized textareas and newly opened groups before their next operation.
    const capture = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) previous.current = read();
    };
    window.addEventListener('pointerdown', capture, true);
    window.addEventListener('keydown', cancel, true);
    reduce.addEventListener('change', cancel);
    return () => {
      cancel();
      window.removeEventListener('pointerdown', capture, true);
      window.removeEventListener('keydown', cancel, true);
      reduce.removeEventListener('change', cancel);
    };
  }, []);
  useLayoutEffect(() => {
    const next = read();
    const immediate =
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.settingsInput === 'keyboard';
    const pending: { node: HTMLElement; frames: Keyframe[] }[] = [];
    const structureChanged = [...next].some(([id, list]) => {
      const before = previous.current.get(id);
      return (
        before && JSON.stringify([...before.rows.keys()]) !== JSON.stringify([...list.rows.keys()])
      );
    });
    for (const [id, list] of next) {
      const before = previous.current.get(id);
      if (!structureChanged || !before) continue;
      const animate = !immediate && before.width > 0 && Math.abs(before.width - list.width) < 1;
      for (const [key, row] of list.rows) {
        const old = before.rows.get(key);
        const running = active.current.get(row.node);
        const offset = running
          ? new DOMMatrixReadOnly(getComputedStyle(row.node).transform)
          : new DOMMatrixReadOnly();
        if (!animate || !row.width || !row.height) continue;
        if (!old)
          pending.push({
            node: row.node,
            frames: [
              { opacity: 0, transform: 'translateY(4px)' },
              { opacity: 1, transform: 'none' },
            ],
          });
        else {
          const dx = old.x - row.x + offset.m41,
            dy = old.y - row.y + offset.m42;
          if (Math.abs(dx) + Math.abs(dy) >= 1)
            pending.push({
              node: row.node,
              frames: [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            });
        }
      }
      // Nested row changes also move following groups. Ordinary edits never restart motion.
      before.rows.forEach(({ node }) => {
        active.current.get(node)?.cancel();
        active.current.delete(node);
      });
    }
    previous.current = next;
    for (const { node, frames } of pending) {
      const animation = node.animate(frames, {
        duration: 200,
        easing:
          getComputedStyle(node).getPropertyValue('--settings-ease').trim() ||
          'cubic-bezier(.2,.7,.2,1)',
      });
      active.current.set(node, animation);
      animation.onfinish = () => {
        if (active.current.get(node) === animation) active.current.delete(node);
      };
    }
  });
  return ref;
}
