/*
 * [INPUT]: 内嵌胶囊 appearance/stop 事件、SVG 渲染器。
 * [OUTPUT]: 内嵌液态安装/清理、Regular/Clear 同步、焦点状态与探针。
 * [POS]: 正式与开发构建共用的内嵌液态入口；弹出仍由 AppKit 渲染。
 * [PROTOCOL]: 变更时核对 AGENTS.md。
 */
import { createSvgGlass } from './svg.js';

const host =
  /** @type {Window & {__codexBuddyGlassLab?: {destroy: () => void, status: () => object}}} */ (
    window
  );
host.__codexBuddyGlassLab?.destroy();
try {
  localStorage.removeItem('codex-buddy-dev:glass-engine');
  localStorage.removeItem('codex-buddy-dev:glass-comparison');
} catch {}
let root, surface, glass, resize, observer;
let frame = 0;
let phase = 'idle';
const reduced = matchMedia('(prefers-reduced-transparency: reduce)');

function variant() {
  return root?.getAttribute('data-liquid-variant') === 'clear' ? 'clear' : 'regular';
}
function focusChanged() {
  if (root) root.setAttribute('data-glass-focused', String(document.hasFocus()));
}
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  resize?.disconnect();
  observer?.disconnect();
  glass?.destroy();
  glass = null;
  root?.removeAttribute('data-glass-backend');
  root?.removeAttribute('data-glass-focused');
  phase = 'idle';
}
function refresh() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        glass?.refresh(variant());
      } catch {
        stop();
        phase = 'error';
      }
    });
}
function sync() {
  const next = document.querySelector('[data-companion-stepwise-root="true"]');
  const enabled =
    next?.getAttribute('data-presentation') === 'embedded' &&
    next.getAttribute('data-material') === 'native-glass' &&
    next.getAttribute('data-detached') !== 'true' &&
    !reduced.matches;
  if (!enabled || root !== next) stop();
  root = next;
  if (!enabled) return;
  if (glass) {
    refresh();
    return;
  }
  surface = root.querySelector('.csw-glass');
  if (!surface) return;
  try {
    glass = createSvgGlass(surface);
    glass.refresh(variant());
    root.setAttribute('data-glass-backend', 'svg');
    focusChanged();
    phase = 'ready';
    resize = new ResizeObserver(refresh);
    resize.observe(surface);
    observer = new MutationObserver(() => {
      if (root.getAttribute('data-detached') === 'true') sync();
      else refresh();
    });
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-open', 'data-detached', 'data-liquid-variant'],
    });
  } catch {
    stop();
    phase = 'error';
  }
}
function onStop(event) {
  if (event.detail?.destroy) destroy();
  else stop();
}
function destroy() {
  stop();
  window.removeEventListener('codex-buddy:appearance', sync);
  window.removeEventListener('codex-buddy:stop', onStop);
  window.removeEventListener('focus', focusChanged);
  window.removeEventListener('blur', focusChanged);
  reduced.removeEventListener('change', sync);
  delete host.__codexBuddyGlassLab;
}
host.__codexBuddyGlassLab = {
  destroy,
  status: () => ({ selected: 'svg', variant: variant(), backend: 'SVG', phase, ms: 0, frames: 0 }),
};
window.addEventListener('codex-buddy:appearance', sync);
window.addEventListener('codex-buddy:stop', onStop);
window.addEventListener('focus', focusChanged);
window.addEventListener('blur', focusChanged);
reduced.addEventListener('change', sync);
sync();
