/* [INPUT]: 已确认的聊天根节点、语义原句与对应词条；复用 matcher 的名称/别名和英文边界。
 * [OUTPUT]: 规范化正文与原始文字节点的双向位置映射；原句内优先定位术语，没有名称时保留语义句段。
 * [POS]: 只读 DOM 定位，不改宿主正文、行距或选择区。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createMatcher } from './matcher.js';
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
