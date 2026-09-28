/* [INPUT]: Surface element, owner, transport and optional header slot. [OUTPUT]: Isolated view lifecycle.
 * [POS]: React adapter shared by host and native pages. [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { createRoot } from 'react-dom/client';
import { FeatureView } from './feature-session';
import type { Entry, Request } from '../../shared/features';
import styles from './content.css?inline';
import contentStyles from '../../features/content.css?inline';
import sharedTokens from '../../shared/tokens.css?inline';
import modelStyles from '../../features/model/styles.css?inline';
import { Board, type BoardView } from '../../features/board/app';
import type { TaskRequest } from '../../features/board/api';
import boardStyles from '../../features/board/styles.css?inline';
const reloaders = new Map<HTMLElement, () => Promise<boolean>>();
Object.assign(window, {
  __buddyFeatureFlush: async () => {
    if (
      document.querySelector(
        '[data-arranging="true"],[data-resizing="true"],[data-layout-saving="true"]',
      )
    )
      return false;
    const nodes = [...reloaders.keys()].flatMap((node) => [
      node,
      ...node.shadowRoot!.querySelectorAll<HTMLDialogElement>('dialog'),
    ]);
    const inert = nodes.map((node) => node.inert);
    document.documentElement.dataset.buddyReloading = 'true';
    nodes.forEach((node) => {
      node.inert = true;
    });
    try {
      for (const flush of reloaders.values()) if (!(await flush())) return false;
      return true;
    } finally {
      nodes.forEach((node, index) => {
        node.inert = inert[index];
      });
      delete document.documentElement.dataset.buddyReloading;
    }
  },
});
export function mountFeature(
  element: HTMLElement,
  initial: Entry,
  owner: string,
  placement: string,
  request: Request,
  onState: () => void,
  motion?: {
    ready: () => Promise<unknown>;
    handoff: () => Promise<unknown>;
    failed?: (pendingOwner: string) => void;
  },
  headerActions: HTMLElement | undefined = ['outline', 'next', 'board'].includes(initial.id)
    ? document.createElement('span')
    : undefined,
) {
  const css =
    boardStyles.replaceAll(':root', ':host').replace(/\bbody\s*\{/g, '.board-app {') +
    '\n' +
    modelStyles +
    sharedTokens +
    styles +
    contentStyles +
    `
.feature-view{--csw-text:var(--ink);--csw-muted:var(--muted);--csw-accent:var(--accent);--csw-hover:var(--hover);--csw-surface-opaque:var(--surface);--csw-item-font:1em;--csw-chrome-font:1em;--csw-label-weight:600;--csw-divider:var(--line);}
.feature-projection button{border:0}.feature-projection svg{width:18px;height:18px}.feature-view:hover .csw-outline-toolbar,.csw-outline-toolbar:focus-within{opacity:1;pointer-events:auto;transform:none}
.csw-row:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.csw-prompt-preview{transition:none}}`;
  const root = isolatedRoot(element, css);
  let prepareReload: (() => Promise<boolean>) | undefined;
  const flush = () => prepareReload?.() ?? Promise.resolve(false);
  reloaders.set(element, flush);
  let stopped = false;
  let ready = initial.pending?.owner !== owner;
  let readying = false;
  async function confirmReady() {
    if (ready || readying || stopped) return;
    readying = true;
    try {
      await (motion ? motion.ready() : request({ op: 'ready', id: initial.id, owner }));
      ready = true;
      if (!stopped) onState();
    } catch (error) {
      // The shared host bridge can be busy during a group move. The next read retries readiness.
      if (!/请求较多|请求不可用，请稍后重试/.test(String(error)))
        motion?.failed?.(initial.pending!.owner);
      throw error;
    } finally {
      readying = false;
    }
  }
  function render(entry: Entry) {
    root.render(
      <>
        <FeatureView
          headerActions={headerActions}
          registerReload={(handler) => {
            prepareReload = handler;
          }}
          onReady={confirmReady}
          beforeHandoff={motion?.handoff}
          onHandoffError={motion?.failed}
          entry={entry}
          owner={owner}
          request={request}
          onState={onState}
        />
      </>,
    );
  }
  render(initial);
  return {
    update: render,
    headerActions,
    dispose() {
      stopped = true;
      reloaders.delete(element);
      root.unmount();
      headerActions?.remove();
      element.remove();
    },
  };
}

function isolatedRoot(element: HTMLElement, css: string) {
  const shadow = element.attachShadow({ mode: 'open' }),
    style = document.createElement('style'),
    content = document.createElement('div');
  style.textContent = css;
  content.style.height = '100%';
  shadow.append(style, content);
  return createRoot(content);
}
// Old panel.json feature=board uses the same mount primitive and Board content.
// Remove this adapter when old panel/window leases no longer need task-only transport.
export function mountBoard(element: HTMLElement, request: TaskRequest, view: BoardView) {
  const root = isolatedRoot(
    element,
    boardStyles.replaceAll(':root', ':host').replace(/\bbody\s*\{/g, '.board-app {') +
      ':host{display:block;height:100%;min-height:0;overflow:auto;container-type:inline-size}.board-app{min-height:100%;}',
  );
  root.render(<Board request={request} embedded view={view} />);
  return () => {
    root.unmount();
    element.remove();
  };
}
