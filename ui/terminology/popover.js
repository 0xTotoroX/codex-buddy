/* [INPUT]: 共用卡片、文字/积木锚点和主题选项。
 * [OUTPUT]: 可中断开合、视口定位、键盘关闭及资源回收。
 * [POS]: 正文与侧栏共用浮层；不拥有词库业务状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { cardStyles, createCard } from './card.js';
export function createTermPopover({
  onEnter = () => {},
  onLeave = () => {},
  onClose = () => {},
} = {}) {
  let card = null,
    term = null,
    anchor = null,
    timer = 0,
    frame = 0,
    disposed = false,
    resize = null,
    returnFocus = null,
    settle = null;
  const layer = document.createElement('div');
  layer.dataset.buddyTerms = 'true';
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none';
  const shadow = layer.attachShadow({ mode: 'open' }),
    style = document.createElement('style'),
    box = document.createElement('div');
  style.textContent =
    cardStyles +
    `.term-popover{position:fixed;pointer-events:none;opacity:0;visibility:hidden;transform:translateY(-3px) scale(.985);transform-origin:left top;transition:opacity 160ms cubic-bezier(.3,.7,.4,1),transform 240ms cubic-bezier(.22,.85,.3,1),visibility 0s linear 240ms;max-width:calc(100vw - 20px)}.term-popover[data-open=true]{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition-delay:0s}.term-popover .term-card{max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain}@media(prefers-reduced-motion:reduce){.term-popover{transition:none;transform:none}}`;
  box.className = 'term-popover';
  box.dataset.open = 'false';
  box.inert = true;
  shadow.append(style, box);
  document.documentElement.append(layer);
  function place() {
    if (!card || !anchor) return;
    const r = anchor();
    if (!r || !r.width || !r.height) {
      hide(true);
      return;
    }
    const c = { width: card.offsetWidth, height: card.offsetHeight },
      m = 10;
    const above = r.bottom + c.height + 8 > innerHeight - m && r.top > c.height + 8;
    box.style.left = `${Math.max(m, Math.min(r.left, innerWidth - c.width - m))}px`;
    box.style.top = `${Math.max(m, Math.min(above ? r.top - c.height - 8 : r.bottom + 8, innerHeight - c.height - m))}px`;
    box.style.transformOrigin = above ? 'left bottom' : 'left top';
  }
  function release() {
    resize?.disconnect();
    resize = null;
    card?.dispose();
    box.replaceChildren();
    card = null;
    term = null;
    anchor = null;
  }
  function hide(immediate = false) {
    clearTimeout(timer);
    settle?.(false);
    settle = null;
    cancelAnimationFrame(frame);
    box.dataset.open = 'false';
    box.inert = true;
    box.setAttribute('aria-hidden', 'true');
    onClose();
    if (immediate) {
      release();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      settle = resolve;
      timer = window.setTimeout(
        () => {
          release();
          settle = null;
          resolve(true);
        },
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250,
      );
    });
  }
  const enter = () => {
      onEnter();
    },
    leave = () => onLeave();
  box.addEventListener('pointerenter', enter);
  box.addEventListener('pointerleave', leave);
  function key(e) {
    if (e.key === 'Escape' && box.dataset.open === 'true') {
      e.stopPropagation();
      void hide();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
  }
  function pointer(e) {
    if (
      box.dataset.open === 'true' &&
      !e.composedPath().includes(layer) &&
      !e.composedPath().includes(returnFocus)
    )
      void hide();
  }
  function scroll(e) {
    if (!e.composedPath().includes(layer)) void hide(true);
  }
  const peer = (e) => {
    if (e.detail !== layer && card) void hide(true);
  };
  document.addEventListener('buddy-term-popover-open', peer);
  document.addEventListener('keydown', key, true);
  document.addEventListener('pointerdown', pointer);
  document.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', place);
  return {
    layer,
    get open() {
      return box.dataset.open === 'true';
    },
    get termId() {
      return term?.id;
    },
    contains(e) {
      return e.composedPath().includes(layer);
    },
    show(nextTerm, getAnchor, options = {}) {
      if (disposed) return;
      clearTimeout(timer);
      settle?.(false);
      settle = null;
      cancelAnimationFrame(frame);
      anchor = getAnchor;
      returnFocus = options.returnFocus || null;
      if (!card || term?.id !== nextTerm.id) {
        release();
        anchor = getAnchor;
        term = nextTerm;
        card = createCard(nextTerm, options);
        box.append(card);
        resize = new ResizeObserver(place);
        resize.observe(card);
      } else {
        term = nextTerm;
        card.update(nextTerm, options);
      }
      document.dispatchEvent(new CustomEvent('buddy-term-popover-open', { detail: layer }));
      box.inert = false;
      box.setAttribute('aria-hidden', 'false');
      place();
      frame = requestAnimationFrame(() => {
        if (!disposed && card) {
          box.dataset.open = 'true';
          if (options.keyboard) card.querySelector('button')?.focus();
        }
      });
    },
    update(nextTerm, options) {
      if (card && term?.id === nextTerm.id) {
        term = nextTerm;
        card.update(nextTerm, options);
        place();
      }
    },
    reposition: place,
    hide,
    destroy() {
      disposed = true;
      void hide(true);
      layer.remove();
      document.removeEventListener('buddy-term-popover-open', peer);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', place);
    },
  };
}
