/* [INPUT]: Presentation identity and mounted preview geometry.
 * [OUTPUT]: Interruptible entry and layout transitions; respects reduced motion live.
 * [POS]: Settings-only motion, never remounts controls or changes configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, useRef } from 'react';

export function useSettingsMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches) return;
    const animation = element.animate(
      [
        { opacity: 0.65, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 180, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    const cancel = () => animation.cancel();
    reduce.addEventListener('change', cancel);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
    };
  }, [identity]);
  return ref;
}

export function usePreviewMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, DOMRect>());
  const previousSize = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const size = root.getBoundingClientRect();
    const resized =
      Math.abs(size.width - previousSize.current.width) +
        Math.abs(size.height - previousSize.current.height) >
      1;
    previousSize.current = { width: size.width, height: size.height };
    const animations: Animation[] = [];
    const next = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>('[data-preview-part]').forEach((node) => {
      // Nested panes use their moving parent's origin so a window move is not applied twice.
      const origin = (
        node.parentElement?.closest('[data-preview-part]') || root
      ).getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const rect = new DOMRect(box.x - origin.x, box.y - origin.y, box.width, box.height);
      const key = node.dataset.previewPart!;
      const before = previous.current.get(key);
      next.set(key, rect);
      if (reduce.matches || resized || !before || !rect.width || !rect.height) return;
      const dx = before.x - rect.x,
        dy = before.y - rect.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      animations.push(
        node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: 220,
          easing: 'cubic-bezier(.2,.7,.2,1)',
        }),
      );
    });
    previous.current = next;
    const cancel = () => animations.forEach((animation) => animation.cancel());
    reduce.addEventListener('change', cancel);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
    };
  }, [identity]);
  return ref;
}
