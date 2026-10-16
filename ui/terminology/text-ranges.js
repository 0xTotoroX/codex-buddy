/* [INPUT]: 已确认的聊天根节点、语义原句与对应词条；复用 matcher 的名称/别名和英文边界。
 * [OUTPUT]: 正文位置映射、语义范围及指定范围的滚动定位。
 * [POS]: 不改宿主正文、行距或选择区；定位仅滚动文字所属容器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createMatcher } from './matcher.js';
import { layoutZoom } from '../codex/typography.js';
export const normalizeQuote = (text) =>
  String(text || '')
    .replace(/[\s\u200b]+/gu, ' ')
    .trim();
const blocked =
  'a,button,input,textarea,select,pre,code,script,style,[hidden],[aria-hidden=true],[contenteditable]:not([contenteditable=false]),[data-companion-stepwise-root],[data-codex-buddy-features-root],[data-codex-buddy-dock],[data-buddy-terms]';
export function textIndex(root) {
  const characters = [],
    positions = [];
  let block = null;
  const pushSpace = () => {
    if (characters.length && characters.at(-1) !== ' ') {
      characters.push(' ');
      positions.push(null);
    }
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest(blocked)) {
      if (characters.at(-1) !== '\uFFFC') {
        characters.push('\uFFFC');
        positions.push(null);
      }
      block = null;
      continue;
    }
    const next =
      parent.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,[data-message-author-role]') || root;
    if (block && block !== next) pushSpace();
    block = next;
    const textNode = /** @type {Text} */ (node);
    for (let offset = 0; offset < textNode.length; offset++) {
      const char = textNode.data[offset];
      if (/[\s\u200b]/u.test(char)) {
        pushSpace();
        continue;
      }
      characters.push(char);
      positions.push({ node, offset });
    }
  }
  const text = characters.join('');
  return {
    text,
    range(start, end) {
      while (start < end && !positions[start]) start++;
      while (end > start && !positions[end - 1]) end--;
      const first = positions[start],
        last = positions[end - 1];
      if (!first || !last) return null;
      const range = document.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      return range;
    },
  };
}
export function semanticSpans(text, quote, term = null) {
  const needle = normalizeQuote(quote);
  if (!needle) return [];
  // 原句用于限定已核对的语境，术语本身才是标注和悬停的范围。
  const names = term
    ? createMatcher(
        [
          {
            ...term,
            name: normalizeQuote(term.name),
            english: normalizeQuote(term.english),
            aliases: (term.aliases || []).map(normalizeQuote),
          },
        ],
        [],
        { contextVerified: true },
      )(text)
    : [];
  const ranges = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(needle, cursor);
    if (start < 0) break;
    const end = start + needle.length;
    const words = names.filter((word) => word.start >= start && word.end <= end);
    ranges.push(
      ...(words.length ? words.map(({ start, end }) => ({ start, end })) : [{ start, end }]),
    );
    cursor = end;
  }
  return ranges;
}

export function scrollToRange(range) {
  const rect = [...range.getClientRects()].find((r) => r.width && r.height);
  if (!rect) return false;
  let container = range.startContainer.parentElement;
  while (container && container !== document.documentElement) {
    if (
      /(auto|scroll|overlay)/.test(getComputedStyle(container).overflowY) &&
      container.scrollHeight > container.clientHeight + 4
    )
      break;
    container = container.parentElement;
  }
  container =
    container === document.documentElement || !container ? document.scrollingElement : container;
  if (!container) return false;
  const documentScroll = container === document.scrollingElement;
  const bounds = container.getBoundingClientRect();
  const scale = documentScroll ? layoutZoom(container) : bounds.height / container.clientHeight;
  const center = documentScroll ? innerHeight / 2 : bounds.top + bounds.height / 2;
  container.scrollBy({
    top: (rect.top + rect.height / 2 - center) / (scale || 1),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
  return true;
}
