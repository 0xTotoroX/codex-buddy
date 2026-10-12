import { iconSvg } from '../shared/icons/index.js';
/* [INPUT]: 术语文本、三个候选样式、已掌握回调。
 * [OUTPUT]: 可安全挂载在 Shadow DOM 或设置预览内的释义卡。
 * [POS]: 共用卡片呈现，不使用术语内容拼接 HTML。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export const cardStyles = `
.term-card{box-sizing:border-box;width:340px;max-width:calc(100vw - 24px);padding:18px 20px;border:1px solid var(--term-border,#dedee3);border-radius:14px;background:var(--term-bg,#fff);color:var(--term-fg,#25262b);box-shadow:0 8px 28px #00000014;font:14px/1.65 system-ui,sans-serif;text-align:left;overflow-wrap:anywhere}
.term-card[data-style=frost]{background:color-mix(in srgb,var(--term-bg,#fff) 90%,transparent);backdrop-filter:blur(24px) saturate(1.15);border-color:color-mix(in srgb,var(--term-border,#dedee3) 65%,transparent);box-shadow:0 10px 32px #00000018,inset 0 1px #ffffff30;border-radius:20px}
.term-card header{display:block;margin-bottom:12px}.term-card strong{font-size:17px;font-weight:600}.term-card small{display:block;color:var(--term-muted,#72727b);font-size:12px;margin-top:2px}.term-card p{margin:0 0 12px}.term-card .term-relation{font-size:12px;color:var(--term-muted,#72727b);margin-bottom:5px}.term-card footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid var(--term-border,#dedee3)}
.term-card button,.term-card a{font:inherit;font-size:12px;background:none;border:0;color:inherit;padding:4px 0;text-decoration:none;cursor:pointer}.term-card button:focus-visible,.term-card a:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:2px}.term-card button:disabled{opacity:.6;cursor:wait}.term-card .term-error{color:#b34848;font-size:12px;margin-top:8px}
.term-card footer{justify-content:flex-end}.term-action{position:relative;display:inline-flex}.term-action button{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;padding:0}.term-action svg{width:18px;height:18px}.term-action button:hover{background:color-mix(in srgb,currentColor 7%,transparent)}.term-tooltip{position:absolute;bottom:calc(100% + 8px);right:0;white-space:nowrap;padding:5px 8px;border-radius:6px;background:var(--term-fg,#25262b);color:var(--term-bg,#fff);font-size:12px;line-height:1.5;visibility:hidden;opacity:0;pointer-events:none}.term-action:hover .term-tooltip,.term-action:focus-within .term-tooltip{visibility:visible;opacity:1}.term-action button:active{transform:scale(.94)}
@media(prefers-reduced-motion:no-preference){.term-card{animation:term-appear 120ms ease-out}@keyframes term-appear{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}}`;
let tooltipSequence = 0;
export function createCard(
  term,
  {
    style = 'plain',
    semantic = false,
    favorite = false,
    onMaster = async (_id) => {},
    onFavorite = async (_id, _value) => {},
  } = {},
) {
  const card = document.createElement('article');
  card.className = 'term-card';
  card.dataset.style = style === 'note' ? 'plain' : style;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `${term.name}释义`);
  const header = document.createElement('header');
  if (semantic) {
    const label = document.createElement('div');
    label.className = 'term-relation';
    label.textContent = '可能对应';
    header.append(label);
  }
  const title = document.createElement('strong');
  title.textContent = term.name;
  const english = document.createElement('small');
  english.textContent = term.english === term.name ? '' : term.english;
  header.append(title, english);
  const definition = document.createElement('p');
  definition.textContent = term.definition;
  const category = document.createElement('small');
  category.textContent = (term.category || []).join(' › ');
  header.append(category);
  const footer = document.createElement('footer');
  const master = document.createElement('button');
  master.type = 'button';
  master.innerHTML = iconSvg('eye-off');
  master.setAttribute('aria-label', '已掌握，不再提示');
  const error = document.createElement('div');
  error.className = 'term-error';
  error.setAttribute('role', 'status');
  master.addEventListener('click', async () => {
    master.disabled = true;
    try {
      await onMaster(term.id);
    } catch (e) {
      error.textContent = e.message || '保存失败，请重试';
    } finally {
      master.disabled = false;
    }
  });
  const wrap = (button, label) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'term-action';
    const tip = document.createElement('span');
    tip.className = 'term-tooltip';
    tip.id = `term-tip-${++tooltipSequence}`;
    tip.setAttribute('role', 'tooltip');
    tip.textContent = label;
    button.setAttribute('aria-describedby', tip.id);
    wrapper.append(button, tip);
    return { wrapper, tip };
  };
  const saved = document.createElement('button');
  saved.type = 'button';
  const savedTip = wrap(saved, '收藏术语');
  const update = () => {
    saved.innerHTML = iconSvg(favorite ? 'star-filled' : 'star');
    saved.setAttribute('aria-pressed', String(favorite));
    saved.setAttribute('aria-label', favorite ? '取消收藏' : '收藏术语');
    savedTip.tip.textContent = favorite ? '取消收藏' : '收藏术语';
  };
  update();
  saved.addEventListener('click', async () => {
    saved.disabled = true;
    try {
      await onFavorite(term.id, !favorite);
      favorite = !favorite;
      update();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        saved.animate(
          [{ transform: 'scale(.85)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
          { duration: 220 },
        );
    } catch (e) {
      error.textContent = e.message || '保存失败，请重试';
    } finally {
      saved.disabled = false;
    }
  });
  footer.append(savedTip.wrapper, wrap(master, '已掌握，不再提示').wrapper);
  try {
    const url = new URL(term.source);
    if (url.protocol === 'https:') {
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '来源';
      footer.append(link);
    }
  } catch {}
  card.append(header, definition, footer, error);
  return card;
}
