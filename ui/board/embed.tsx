/* [INPUT]: Host-owned mount point and a task-only transport.
 * [OUTPUT]: Isolated reusable board view and deterministic cleanup.
 * [POS]: Presentation adapter; never reads host credentials or chat content.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { Board, type BoardView } from './app';
import type { TaskRequest } from './api';
import styles from './styles.css?inline';
export function mountBoard(element: HTMLElement, request: TaskRequest, view: BoardView) {
  const shadow = element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent =
    styles.replaceAll(':root', ':host').replace(/\bbody\s*\{/g, '.board-app {') +
    ':host{display:block;height:100%;min-height:0;overflow:auto;container-type:inline-size}.board-app{min-height:100%;}';
  const content = document.createElement('div');
  content.style.height = '100%';
  shadow.append(style, content);
  const root = createRoot(content);
  root.render(<Board request={request} embedded view={view} />);
  return () => {
    root.unmount();
    element.remove();
  };
}
