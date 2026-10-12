/* [INPUT]: 术语、主题/材质偏好、收藏与掌握动作。
 * [OUTPUT]: 已定稿贴字浮层的唯一卡片，两个入口和设置预览共用。
 * [POS]: 只呈现名称与释义；静态共享图标，不插入不受信任 HTML。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { iconSvg } from '../shared/icons/index.js';
import { attachCardAppearance } from './appearance.js';
export const cardStyles = `
.term-card{box-sizing:border-box;width:348px;max-width:100%;padding:13px 14px 10px;border:0;border-radius:14px;color:var(--term-fg,#202020);background:var(--term-bg,#fafafa);box-shadow:0 0 0 .5px var(--term-border,#dedee3),0 1px 2px #0000000d,0 16px 36px -14px #0000004d;font:var(--term-font-size,16px)/1.6 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere;text-align:left;position:relative}
.term-card header{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;min-width:0}.term-card strong{font-size:1em;line-height:1.6;font-weight:600;letter-spacing:.012em}.term-card small{font-size:1em;line-height:1.6;font-weight:500;letter-spacing:.035em;color:var(--term-muted,#72727b)}.term-card p{margin:1.6em 0 0;font-size:1em;line-height:1.6;text-indent:2em}.term-card footer{display:flex;justify-content:flex-end;gap:2px;margin-top:8px}
.term-action{position:relative;display:inline-flex}.term-action button{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:9px;background:transparent;color:var(--term-muted,#72727b);cursor:pointer;transition:color 150ms,background-color 150ms,transform 120ms}.term-action button svg{width:18px;height:18px}.term-action button:hover{color:var(--term-fg,#202020);background:var(--term-hover,#0000000d)}.term-action button[aria-pressed=true]{color:var(--term-accent,currentColor);background:color-mix(in srgb,var(--term-accent,currentColor) 12%,transparent)}.term-action button:active{transform:scale(.94)}.term-action button:focus-visible{outline:2px solid var(--term-accent,currentColor);outline-offset:2px}.term-action button:disabled{opacity:.5;cursor:wait}.term-tooltip{position:absolute;bottom:calc(100% + 8px);right:0;padding:5px 8px;border-radius:6px;white-space:nowrap;max-width:260px;font:12px/1.5 system-ui;background:var(--term-fg,#202020);color:var(--term-bg,#fafafa);visibility:hidden;opacity:0;pointer-events:none;z-index:3}.term-action:hover .term-tooltip,.term-action:focus-within .term-tooltip{visibility:visible;opacity:1}.term-error{color:var(--term-danger,#bf4d4d);font-size:12px;margin-top:8px}.term-error:empty{display:none}
.term-card[data-material=native-glass]{box-shadow:inset 0 1px 0 #ffffff25,inset 0 0 0 .5px #ffffff18,0 16px 36px -14px #0000004d}
@media(pointer:coarse){.term-action button{width:44px;height:44px}}
@media(prefers-reduced-motion:reduce){.term-action button{transition:none}}
`;
let sequence = 0;
export function createCard(term, options = {}) {
  let opts = {
    favorite: false,
    mastered: false,
    locked: false,
    preferences: {},
    appearance: {},
    onFavorite: async (_id, _value) => {},
    onMaster: async (_id, _value) => {},
    ...options,
  };
  let alive = true,
    busy = false;
  const animations = new Set();
  const card = document.createElement('article');
  card.className = 'term-card';
  card.dataset.style = 'attached';
  card.setAttribute('role', 'dialog');
  const header = document.createElement('header'),
    name = document.createElement('strong'),
    english = document.createElement('small');
  header.append(name, english);
  const definition = document.createElement('p'),
    footer = document.createElement('footer'),
    error = document.createElement('div');
  error.className = 'term-error';
  error.setAttribute('role', 'status');
  const controls = {};
  for (const action of ['favorite', 'mastered']) {
    const wrapper = document.createElement('span');
    wrapper.className = 'term-action';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    const tip = document.createElement('span');
    tip.className = 'term-tooltip';
    tip.id = `buddy-term-tip-${++sequence}`;
    tip.setAttribute('role', 'tooltip');
    button.setAttribute('aria-describedby', tip.id);
    wrapper.append(button, tip);
    footer.append(wrapper);
    controls[action] = { button, tip };
    button.addEventListener('click', async () => {
      if (busy || opts.locked) return;
      busy = true;
      error.textContent = '';
      render();
      const value = !opts[action];
      try {
        await (action === 'favorite' ? opts.onFavorite : opts.onMaster)(term.id, value);
        if (!alive) return;
        opts[action] = value;
        render();
        document.dispatchEvent(new Event('buddy-terminology-change'));
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const anim = button.animate(
            [
              { transform: 'scale(.86)' },
              { transform: 'scale(1.07)', offset: 0.55 },
              { transform: 'scale(1)' },
            ],
            { duration: 260, easing: 'cubic-bezier(.3,.9,.3,1)' },
          );
          animations.add(anim);
          anim.finished.finally(() => animations.delete(anim)).catch(() => {});
        }
      } catch (e) {
        if (alive) error.textContent = e.message || '保存失败，请重试';
      } finally {
        busy = false;
        if (alive) render();
      }
    });
  }
  card.append(header, definition, footer, error);
  const appearance = attachCardAppearance(card);
  function render() {
    card.setAttribute('aria-label', `${term.name}释义`);
    name.textContent = term.name;
    english.textContent = term.english === term.name ? '' : term.english || '';
    definition.textContent = term.definition;
    for (const action of ['favorite', 'mastered']) {
      const { button, tip } = controls[action];
      const chosen = !!opts[action],
        label =
          action === 'favorite'
            ? chosen
              ? '取消收藏'
              : '收藏术语'
            : chosen
              ? '恢复提示'
              : '已掌握，不再提示';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(chosen));
      tip.textContent = label;
      button.disabled = busy || opts.locked;
      const icon = action === 'favorite' ? (chosen ? 'bookmark-filled' : 'bookmark') : 'check';
      if (button.dataset.icon !== icon) {
        button.innerHTML = iconSvg(icon);
        button.dataset.icon = icon;
      }
    }
  }
  render();
  appearance.update(opts.preferences, opts.appearance);
  return Object.assign(card, {
    update(nextTerm, nextOptions = {}) {
      term = nextTerm;
      opts = { ...opts, ...nextOptions };
      render();
      appearance.update(opts.preferences, opts.appearance);
    },
    dispose() {
      alive = false;
      appearance.destroy();
      animations.forEach((a) => a.cancel());
      animations.clear();
    },
  });
}
