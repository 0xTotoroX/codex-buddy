/* [INPUT]: Existing mounted settings content and presentation-only open/close requests.
 * [OUTPUT]: Accessible right-side drawer, retained drafts/scroll and anchor reveal helpers.
 * [POS]: Settings presentation; keeps native form ownership and never writes configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './components/ui/button';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';

const openEvent = 'buddy-settings-drawer-open';
const closeEvent = 'buddy-settings-drawer-close';
export function closeSettingsDrawers(except?: HTMLElement | null) {
  for (const drawer of document.querySelectorAll<HTMLElement>('[data-settings-drawer]')) {
    if (drawer !== except) drawer.dispatchEvent(new Event(closeEvent));
  }
}
export function revealSettingsDrawer(target: HTMLElement) {
  const drawer = target.closest<HTMLElement>('[data-settings-drawer]');
  closeSettingsDrawers(drawer);
  if (!drawer) return target;
  drawer.dispatchEvent(new Event(openEvent));
  return target.closest('dialog')
    ? target
    : drawer.querySelector<HTMLElement>('[data-drawer-heading]') || target;
}
export function SettingsDrawer({
  id,
  title,
  children,
  footer,
  hidden = false,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  hidden?: boolean;
}) {
  const generated = useId();
  const dialogId = `${id || generated}-drawer`;
  const wrapper = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const [open, setOpen] = useState(false);
  const backdropDown = useRef(false);
  function show() {
    if (!dialog.current || dialog.current.open || wrapper.current?.closest('[hidden]')) return;
    closeSettingsDrawers(wrapper.current);
    dialog.current.showModal();
    setOpen(true);
    heading.current?.focus({ preventScroll: true });
    if (content.current) content.current.scrollTop = scroll.current;
  }
  function close() {
    if (!dialog.current?.open) return;
    scroll.current = content.current?.scrollTop || 0;
    // Only navigation receives focus while closing, so a draft is not saved by blur.
    for (const nested of dialog.current.querySelectorAll<HTMLDialogElement>('dialog[open]'))
      nested.close();
    closeButton.current?.focus({ preventScroll: true });
    dialog.current.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    const root = wrapper.current;
    root?.addEventListener(openEvent, show);
    root?.addEventListener(closeEvent, close);
    return () => {
      root?.removeEventListener(openEvent, show);
      root?.removeEventListener(closeEvent, close);
    };
  }, []);
  useEffect(() => {
    if (hidden) close();
  }, [hidden]);
  function outside(event: React.PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
  return (
    <section
      id={id}
      ref={wrapper}
      hidden={hidden}
      data-settings-drawer
      className="settings-drawer-entry"
    >
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="settings-drawer-trigger"
        data-settings-navigation
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={show}
      >
        <span>{title}</span>
        <Icon name="chevron-right" />
      </Button>
      <dialog
        ref={dialog}
        id={dialogId}
        className="settings-drawer"
        aria-labelledby={`${dialogId}-title`}
        onCancel={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            close();
          }
        }}
        onPointerDown={(event) => {
          backdropDown.current = outside(event);
          if (backdropDown.current) event.preventDefault();
        }}
        onPointerUp={(event) => {
          if (backdropDown.current && outside(event)) close();
          backdropDown.current = false;
        }}
      >
        <header className="settings-drawer-header" data-settings-navigation>
          <h2 ref={heading} id={`${dialogId}-title`} tabIndex={-1} data-drawer-heading>
            {title}
          </h2>
          <Button
            ref={closeButton}
            data-drawer-close
            type="button"
            variant="ghost"
            size="icon"
            data-settings-navigation
            aria-label={`关闭${title}`}
            onClick={close}
          >
            <Icon name="close" />
          </Button>
        </header>
        <div ref={content} className="settings-drawer-content">
          {children}
        </div>
        {footer && <div className="settings-drawer-footer">{footer}</div>}
      </dialog>
    </section>
  );
}

export function DrawerSaveControls({ editor }: { editor: SettingsEditor }) {
  if (!editor.dirty && !editor.saving && !editor.saveError && !editor.remoteChanged) return null;
  return (
    <>
      {editor.saveError && (
        <p role="alert" className="settings-error text-sm">
          {editor.saveError}
        </p>
      )}
      {editor.remoteChanged ? (
        <p role="alert" className="settings-error text-sm">
          设置已在其他窗口更新，草稿已保留。关闭抽屉后可重新载入。
        </p>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <span role="status" className="text-sm text-muted-foreground">
            {editor.saving ? '正在保存…' : editor.dirty ? '有未保存的更改' : ''}
          </span>
          <Button type="submit" variant="outline" disabled={editor.saving || !editor.dirty}>
            保存设置
          </Button>
        </div>
      )}
    </>
  );
}
