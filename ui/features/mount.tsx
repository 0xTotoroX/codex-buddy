/* [INPUT]: A surface element, owner and transport. [OUTPUT]: Reusable isolated view lifecycle.
 * [POS]: React adapter shared by host and native pages. [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { FeatureView } from './view';
import type { Entry, Request } from './types';
import styles from './styles.css?inline';
import boardStyles from '../board/styles.css?inline';
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
) {
  const shadow = element.attachShadow({ mode: 'open' }),
    style = document.createElement('style'),
    content = document.createElement('div');
  style.textContent =
    boardStyles.replaceAll(':root', ':host').replace(/\bbody\s*\{/g, '.board-app {') +
    '\n' +
    styles;
  content.style.height = '100%';
  shadow.append(style, content);
  const root = createRoot(content);
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
    dispose() {
      stopped = true;
      reloaders.delete(element);
      root.unmount();
      element.remove();
    },
  };
}
