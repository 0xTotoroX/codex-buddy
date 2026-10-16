/* [INPUT]: Explicit action, consequence text and optional configuration revision.
 * [OUTPUT]: Shared confirmation dialog with safe initial focus, cancellation and failure feedback.
 * [POS]: Settings-only presentation; opening/cancelling never executes the supplied action.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { Button } from './components/ui/button';

type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  action: () => unknown | Promise<unknown>;
};
export function useConfirmation(revision?: number | string, blocked = false) {
  const [pending, setPending] = useState<(Confirmation & { revision?: number | string }) | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const latest = useRef({ revision, blocked });
  latest.current = { revision, blocked };
  useEffect(() => {
    const node = dialog.current;
    if (pending && !node?.open) node?.showModal();
    if (!pending && node?.open) node.close();
  }, [pending]);
  function confirm(options: Confirmation) {
    if (flight.current) return;
    setError('');
    setPending({ ...options, revision });
  }
  async function run() {
    if (!pending || flight.current || latest.current.blocked) return;
    if (latest.current.revision !== pending.revision) {
      setError('设置已变化，请关闭后重新确认。');
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await pending.action();
      if (result === false) throw Error('操作未完成，请检查页面中的错误提示后重试。');
      setPending(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const confirmation = (
    <dialog
      ref={dialog}
      className="settings-key-dialog"
      data-settings-navigation
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        if (flight.current) event.preventDefault();
        else setPending(null);
      }}
    >
      <h3 id={`${id}-title`}>{pending?.title}</h3>
      <p id={`${id}-description`} className="mt-3 text-sm text-muted-foreground">
        {pending?.description}
      </p>
      {error && (
        <p role="alert" className="settings-error mt-3 text-sm">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          autoFocus
          data-settings-navigation
          disabled={busy}
          onClick={() => setPending(null)}
        >
          取消
        </Button>
        <Button
          type="button"
          data-settings-navigation
          disabled={busy || blocked}
          aria-busy={busy}
          onClick={() => void run()}
        >
          {busy ? '处理中…' : pending?.confirmLabel || '确认'}
        </Button>
      </div>
    </dialog>
  );
  return { confirm, confirmation };
}
export function ConfirmationButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  revision,
  confirmDisabled,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'title'> & {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: Confirmation['action'];
  revision?: number | string;
  confirmDisabled?: boolean;
}) {
  const { confirm, confirmation } = useConfirmation(revision, confirmDisabled || props.disabled);
  return (
    <>
      <Button
        {...props}
        type="button"
        data-settings-navigation
        onClick={() => confirm({ title, description, confirmLabel, action: onConfirm })}
      />
      {confirmation}
    </>
  );
}
