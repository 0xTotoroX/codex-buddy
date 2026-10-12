/* [INPUT]: 已确认的聊天根节点；排除编辑器、代码及自有界面。
 * [OUTPUT]: 规范化正文与原始文字节点的双向位置映射，可定位跨节点/跨段句段。
 * [POS]: 只读 DOM 定位，不改宿主正文、行距或选择区。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
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
    for (let offset = 0; offset < node.length; offset++) {
      const char = node.data[offset];
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
export function semanticSpans(text, quote) {
  const needle = normalizeQuote(quote);
  if (!needle) return [];
  const ranges = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(needle, cursor);
    if (start < 0) break;
    ranges.push({ start, end: start + needle.length });
    cursor = start + needle.length;
  }
  return ranges;
}
