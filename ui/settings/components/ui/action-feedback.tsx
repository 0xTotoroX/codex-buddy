/* [INPUT]: Real request state, shared action icons and button labels.
 * [OUTPUT]: Fixed-size operation/wait/success icons and width-stable labels.
 * [POS]: Settings presentation only; does not start requests or infer success from elapsed time.
 * [PROTOCOL]: Keep components/ui/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { Icon } from '../../../shared/icons/react';
export type ActionState = 'idle' | 'pending' | 'success';
export function ActionIcon({
  name,
  state,
  retainSuccess = false,
}: {
  name: string;
  state: ActionState;
  retainSuccess?: boolean;
}) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (state !== 'success' || retainSuccess) return;
    const timer = setTimeout(() => setExpired(true), 1200);
    return () => clearTimeout(timer);
  }, [state, retainSuccess]);
  const current = state === 'success' && !retainSuccess && expired ? 'idle' : state;
  return (
    <span className="settings-action-icon" aria-hidden="true" data-action-state={current}>
      {(['idle', 'pending', 'success'] as const).map((phase) => (
        <span key={phase} data-active={current === phase} className="settings-action-layer">
          <Icon
            name={phase === 'idle' ? name : phase === 'pending' ? 'refresh' : 'check'}
            className={phase === 'pending' && current === phase ? 'settings-action-wait' : ''}
          />
        </span>
      ))}
    </span>
  );
}
export function ActionLabel({ text, labels }: { text: string; labels: readonly string[] }) {
  return (
    <span className="settings-action-label">
      {labels.map((label) => (
        <span key={label} aria-hidden="true" className="settings-action-measure">
          {label}
        </span>
      ))}
      <span key={`current:${text}`} className="settings-action-label-value">
        {text}
      </span>
    </span>
  );
}
