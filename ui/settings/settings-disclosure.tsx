/* [INPUT]: Native details content, initial state and optional presentation-only forced visibility.
 * [OUTPUT]: Stable disclosure DOM; restoring the user's open state after simple/detail transitions.
 * [POS]: UI state only. Native toggle events never write settings or race a forced transition.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef, type ComponentProps } from 'react';
export function SettingsDisclosure({
  forceOpen,
  initiallyOpen = false,
  children,
  ...props
}: Omit<ComponentProps<'details'>, 'open'> & { forceOpen?: boolean; initiallyOpen?: boolean }) {
  const node = useRef<HTMLDetailsElement>(null);
  const saved = useRef(initiallyOpen);
  const previous = useRef<{ forceOpen?: boolean; initiallyOpen: boolean } | null>(null);
  useLayoutEffect(() => {
    const details = node.current;
    if (!details) return;
    if (!previous.current) details.open = forceOpen ?? initiallyOpen;
    else if (forceOpen !== undefined) {
      if (previous.current.forceOpen === undefined) saved.current = details.open;
      details.open = forceOpen;
    } else if (previous.current.forceOpen !== undefined) details.open = saved.current;
    else if (previous.current.initiallyOpen !== initiallyOpen) details.open = initiallyOpen;
    previous.current = { forceOpen, initiallyOpen };
  }, [forceOpen, initiallyOpen]);
  return (
    <details {...props} ref={node}>
      {children}
    </details>
  );
}
