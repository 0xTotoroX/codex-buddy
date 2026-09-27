/* [INPUT]: A surface element, owner and transport. [OUTPUT]: Reusable isolated view lifecycle.
 * [POS]: React adapter shared by host and native pages. [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { FeatureView } from './view';
import type { Entry, Request } from './types';
import styles from './styles.css?inline';
import boardStyles from '../board/styles.css?inline';
export function mountFeature(
  element: HTMLElement,
  initial: Entry,
  owner: string,
  placement: string,
  request: Request,
  onState: () => void,
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
  let stopped = false;
  function Ready() {
    useEffect(() => {
      if (initial.pending?.owner === owner)
        void request({ op: 'read', id: initial.id, owner })
          .then(() => request({ op: 'ready', id: initial.id, owner }))
          .then(() => {
            if (!stopped) onState();
          })
          .catch(() => {});
    }, []);
    return null;
  }
  function render(entry: Entry) {
    root.render(
      <>
        <Ready />
        <FeatureView
          entry={entry}
          owner={owner}
          placement={placement}
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
      root.unmount();
      element.remove();
    },
  };
}
