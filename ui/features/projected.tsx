/* [INPUT]: A Codex projection, transient reading state and guarded actions.
 * [OUTPUT]: Shared outline/next content inside an isolated mount, preserving DOM and preview reading.
 * [POS]: Mount adapter; feature modules own content and gestures, containers own arrangement.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { useLayoutEffect, useRef } from 'react';
import type { PanelSnapshot, PanelCommand } from '../shared/contracts';
import type { Reading } from '../shared/features';
import { outlineHtml, alignOutlineNestedText, attachOutlineEvents } from './outline/view.js';
import { createNextView } from './next/view.js';
import { readWorkbenchScroll, writeWorkbenchScroll } from '../shared/scroll.js';
import { iconSvg } from '../shared/icons/index.js';
export function ProjectedContent({
  id,
  snapshot,
  reading,
  disabled,
  command,
}: {
  id: 'outline' | 'next';
  snapshot: PanelSnapshot;
  reading: Reading;
  disabled: boolean;
  command: (kind: PanelCommand['kind'], data?: Partial<PanelCommand>) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const releaseScroll = useRef<() => void>(() => {});
  const rendered = useRef<string | null>(null);
  const latest = useRef({ snapshot, disabled, command });
  latest.current = { snapshot, disabled, command };
  const next = useRef<ReturnType<typeof createNextView> | null>(null);
  if (!next.current)
    next.current = createNextView({
      read: () => latest.current.snapshot,
      reading,
      changed: () => {
        const scroll = root.current?.querySelector('.csw-prompt-preview-scroll');
        if (scroll) writeWorkbenchScroll(scroll, reading.previewTop || 0);
      },
      command: (kind: PanelCommand['kind'], data: Partial<PanelCommand>) => {
        if (!latest.current.disabled) void latest.current.command(kind, data);
      },
    });
  const html = id === 'outline' ? outlineHtml(snapshot) : next.current.html();
  const contentKey = id === 'outline' ? html : next.current.key();
  useLayoutEffect(() => {
    const node = root.current!;
    if (rendered.current !== contentKey) {
      next.current?.clear();
      releaseScroll.current();
      node.innerHTML = html;
      rendered.current = contentKey;
      if (id === 'outline')
        attachOutlineEvents(node, (kind: PanelCommand['kind'], data: Partial<PanelCommand>) => {
          if (!latest.current.disabled) void latest.current.command(kind, data);
        });
      else next.current?.bind(node);
      const scroll = node.querySelector<HTMLElement>('.csw-prompt-preview-scroll');
      if (scroll) {
        const restore = () => {
          if (scroll.clientHeight) writeWorkbenchScroll(scroll, reading.previewTop || 0);
        };
        const record = () => {
          if (scroll.clientHeight) {
            reading.previewTop = readWorkbenchScroll(scroll);
            writeWorkbenchScroll(scroll, reading.previewTop);
          }
        };
        const intention = () => writeWorkbenchScroll(scroll, scroll.scrollTop);
        restore();
        const sizes = new ResizeObserver(restore);
        sizes.observe(scroll);
        scroll.addEventListener('scroll', record);
        scroll.addEventListener('wheel', intention, { passive: true });
        scroll.addEventListener('touchstart', intention, { passive: true });
        scroll.addEventListener('keydown', intention);
        releaseScroll.current = () => {
          sizes.disconnect();
          scroll.removeEventListener('scroll', record);
          scroll.removeEventListener('wheel', intention);
          scroll.removeEventListener('touchstart', intention);
          scroll.removeEventListener('keydown', intention);
        };
      }
    }
    node
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => (button.disabled = disabled));
    if (id === 'outline') alignOutlineNestedText(node);
  }, [contentKey, html, disabled, id, reading]);
  useLayoutEffect(
    () => () => {
      next.current?.clear();
      releaseScroll.current();
    },
    [],
  );
  return (
    <>
      <header className="feature-pane-head">
        <button
          data-refresh={id}
          aria-label={id === 'outline' ? '刷新大纲' : '重新生成建议'}
          title={id === 'outline' ? '刷新大纲（本地）' : '重新生成建议'}
          disabled={
            disabled || snapshot.scanBusy || (id === 'next' && snapshot.bridgeStatus === 'pending')
          }
          onClick={() => void command(id === 'outline' ? 'outline-refresh' : 'generate')}
        >
          <span dangerouslySetInnerHTML={{ __html: iconSvg('refresh') }} />
        </button>
      </header>
      <div
        className="feature-projection"
        role={id === 'outline' ? 'navigation' : undefined}
        aria-label={id === 'outline' ? '大纲' : undefined}
        ref={root}
      />
    </>
  );
}
