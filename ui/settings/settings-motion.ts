/* [INPUT]: Presentation identity, header/preview geometry and input modality.
 * [OUTPUT]: Sticky offsets and interruptible navigation/layout/scene and provider-field transitions; keyboard and reduced motion stay immediate.
 * [POS]: Settings-only motion, never remounts controls or changes configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, useRef } from 'react';

export function useSettingsMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>('.settings-header');
    const pointer = () => (root.dataset.settingsInput = 'pointer');
    const keyboard = () => {
      root.dataset.settingsInput = 'keyboard';
      ref.current?.getAnimations().forEach((animation) => animation.cancel());
    };
    const measure = () => {
      if (header)
        root.style.setProperty('--settings-sticky-offset', `${header.offsetHeight + 18}px`);
    };
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    measure();
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', keyboard, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', keyboard, true);
      delete root.dataset.settingsInput;
      root.style.removeProperty('--settings-sticky-offset');
    };
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches || document.documentElement.dataset.settingsInput === 'keyboard') return;
    const animation = element.animate(
      [
        { opacity: 0.65, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' },
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
      if (
        reduce.matches ||
        document.documentElement.dataset.settingsInput === 'keyboard' ||
        resized ||
        !before ||
        !rect.width ||
        !rect.height
      )
        return;
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

// Keep scenes mounted so demo state survives; inactive scenes only contribute geometry.
export function usePreviewTransition(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(identity);
  useLayoutEffect(() => {
    const root = ref.current;
    const before = previous.current;
    previous.current = identity;
    if (!root || before === identity) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches || document.documentElement.dataset.settingsInput === 'keyboard') return;
    const options = { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)' };
    const animations: Animation[] = [];
    const outgoing = root.querySelector<HTMLElement>(`[data-preview-scene="${before}"]`);
    const incoming = root.querySelector<HTMLElement>(`[data-preview-scene="${identity}"]`);
    if (outgoing)
      animations.push(
        outgoing.animate(
          [
            { visibility: 'visible', opacity: 1 },
            { visibility: 'visible', opacity: 0 },
          ],
          options,
        ),
      );
    if (incoming)
      animations.push(
        incoming.animate(
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          options,
        ),
      );
    const cancel = () => animations.forEach((animation) => animation.cancel());
    reduce.addEventListener('change', cancel);
    window.addEventListener('keydown', cancel, true);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
      window.removeEventListener('keydown', cancel, true);
    };
  }, [identity]);
  return ref;
}

// Animate the existing fields together; no wrapper, remount key or save interception.
export function useProviderFieldsMotion(provider: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(provider);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = provider;
    const root = ref.current;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (
      !root ||
      !before ||
      before === provider ||
      reduce.matches ||
      document.documentElement.dataset.settingsInput === 'keyboard'
    )
      return;
    const fields = new Set<HTMLElement>();
    root
      .querySelectorAll(
        'label[for="protocol"], label[for="base-url"], label[for="api-key"], label[for="model"]',
      )
      .forEach((label) => {
        const field = label.closest<HTMLElement>('.settings-field');
        if (field?.getBoundingClientRect().height) fields.add(field);
      });
    const animations = [...fields].map((field) =>
      field.animate(
        [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 180,
          easing:
            getComputedStyle(root).getPropertyValue('--settings-ease').trim() ||
            'cubic-bezier(.2,.7,.2,1)',
        },
      ),
    );
    const cancel = () => animations.forEach((animation) => animation.cancel());
    reduce.addEventListener('change', cancel);
    window.addEventListener('keydown', cancel, true);
    return () => {
      cancel();
      reduce.removeEventListener('change', cancel);
      window.removeEventListener('keydown', cancel, true);
    };
  }, [provider]);
  return ref;
}
