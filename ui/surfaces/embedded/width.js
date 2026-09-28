/* [INPUT]: Current dock geometry, saved width and shared separator gestures.
 * [OUTPUT]: Sidebar width bounds and pointer collapse preserving the previous width.
 * [POS]: Shared by embedded adapters and settings; does not modify business state.
 * [PROTOCOL]: Keep embedded/AGENTS.md in sync. */
import { bindSeparator } from '../workspace/separator.js';
export const DOCK_MIN_WIDTH = 240;
export const DOCK_COLLAPSE_WIDTH = 200;
export const CHAT_MIN_WIDTH = 560;
export function bindDockResize(handle, read, change, save = () => {}) {
  handle.setAttribute('aria-valuemin', String(DOCK_MIN_WIDTH));
  bindSeparator(
    handle,
    'x',
    () => ({ ...read(), collapsed: false }),
    (start, dx) => {
      if (start.collapsed) return;
      const width = start.width - dx;
      if (handle.dataset.resizing && width < DOCK_COLLAPSE_WIDTH) {
        start.collapsed = true;
        change(start.saved, false);
      } else change(Math.max(DOCK_MIN_WIDTH, Math.min(start.maximum, width)), true);
    },
    save,
  );
}
