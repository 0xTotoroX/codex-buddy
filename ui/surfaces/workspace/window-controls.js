/* [INPUT]: Existing desktop return callback and restricted native window messages.
 * [OUTPUT]: Return/hide/maximize controls and native-confirmed state, without remounting content.
 * [POS]: Shared desktop header adapter; never owns task data or window leases.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import { iconSvg } from '../../shared/icons/index.js';
export function windowControlsHtml() {
  return `<div class="csw-window-controls" role="group" aria-label="窗口操作">${[
    ['dock', '收回聊天', 'return'],
    ['hide', '隐藏', 'minus'],
    ['maximize', '放大', 'focus'],
  ]
    .map(
      ([action, label, icon]) =>
        `<button type="button" class="csw-icon" data-window-control="${action}" aria-label="${label}" title="${label}"${action === 'maximize' ? ' aria-pressed="false"' : ''}>${iconSvg(icon)}</button>`,
    )
    .join('')}</div>`;
}
export function installWindowControls(
  root,
  { dock, post, isBusy = () => false, error = (_error) => {} },
) {
  window.__buddyWindowControls?.destroy?.();
  const events = new AbortController();
  let state = { maximized: false, hidden: false, normalFrame: null },
    pending = false,
    settlingUntil = 0;
  let timer = 0;
  const refresh = () => {
    for (const button of root.querySelectorAll('[data-window-control]'))
      button.disabled = pending || isBusy();
    const zoom = root.querySelector('[data-window-control="maximize"]');
    if (zoom) {
      const label = state.maximized ? '还原' : '放大';
      zoom.setAttribute('aria-label', label);
      zoom.title = label;
      zoom.setAttribute('aria-pressed', String(state.maximized));
      zoom.innerHTML = iconSvg(state.maximized ? 'restore' : 'focus');
    }
    root.toggleAttribute('data-window-maximized', state.maximized);
    document.documentElement.toggleAttribute('data-buddy-maximized', state.maximized);
  };
  const controller = {
    refresh,
    destroy() {
      events.abort();
      clearTimeout(timer);
    },
    geometryTransient: () => pending || state.maximized || performance.now() < settlingUntil,
    normalSize: () =>
      state.normalFrame ? [state.normalFrame.width - 24, state.normalFrame.height - 24] : null,
    update(next) {
      state = { ...state, ...next };
      pending = false;
      settlingUntil = performance.now() + 100;
      clearTimeout(timer);
      refresh();
    },
  };
  window.__buddyWindowControls = controller;
  root.addEventListener(
    'click',
    async (event) => {
      const button = event.target.closest('[data-window-control]');
      if (!button || pending || isBusy()) return;
      event.stopPropagation();
      pending = true;
      refresh();
      try {
        if (button.dataset.windowControl === 'dock') {
          await dock();
          pending = false;
          refresh();
        } else {
          timer = window.setTimeout(() => {
            pending = false;
            refresh();
            error(Error('窗口操作未确认，请重试。'));
          }, 2000);
          post({ kind: button.dataset.windowControl === 'hide' ? 'hide' : 'toggle-maximize' });
        }
      } catch (e) {
        clearTimeout(timer);
        pending = false;
        refresh();
        error(e);
      }
    },
    { signal: events.signal },
  );
  post({ kind: 'window-state' });
  return controller;
}
