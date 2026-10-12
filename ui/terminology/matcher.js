/* [INPUT]: 已验证词条、中文/英文名称、别名、已掌握编号与语境确认标记。
 * [OUTPUT]: 不重叠的字面匹配位置；不修改正文或执行外部内容。
 * [POS]: 术语检索纯逻辑，宿主与样式预览共用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ordinary = new Set([
  '状态',
  '对象',
  '事件',
  '字段',
  '模块',
  '接口',
  '搜索',
  '排序',
  '变量',
  '函数',
  '动画',
  '列表',
  '表格',
  '标签',
  '图片',
  '视频',
  '线程',
  '进程',
  '组件',
  '阴影',
  '间距',
  '居中',
  '定位',
  '聚焦',
  '悬停',
  '禁用',
  '外边距',
  '内边距',
  '颜色',
  'name',
  'state',
  'event',
  'object',
  'field',
  'module',
  'interface',
  'search',
  'sort',
  'tag',
  'image',
  'list',
  'table',
  'input',
  'label',
  'form',
]);
export function createMatcher(entries, mastered = [], { contextVerified = false } = {}) {
  const ignored = new Set(mastered);
  const aliases = new Map();
  for (const term of entries) {
    if (ignored.has(term.id)) continue;
    for (const label of [term.name, term.english, ...(term.aliases || [])]) {
      const value = label?.trim();
      if (!value || value.length < 2 || (!contextVerified && ordinary.has(value.toLowerCase())))
        continue;
      const key = value.toLowerCase();
      // 别名歧义不猜测；规范名称在后续语义确认时仍可解析。
      if (aliases.has(key) && aliases.get(key)?.id !== term.id) aliases.set(key, null);
      else if (!aliases.has(key)) aliases.set(key, term);
    }
  }
  const labels = [...aliases.keys()]
    .filter((k) => aliases.get(k))
    .sort((a, b) => b.length - a.length);
  const pattern = labels.length ? new RegExp(labels.map(escape).join('|'), 'giu') : null;
  return (text) => {
    if (!pattern) return [];
    const result = [];
    for (const m of text.matchAll(pattern)) {
      const start = m.index,
        end = start + m[0].length;
      if (/^[a-z0-9]/i.test(m[0]) && /[a-z0-9_]/i.test(text[start - 1] || '')) continue;
      if (/[a-z0-9]$/i.test(m[0]) && /[a-z0-9_]/i.test(text[end] || '')) continue;
      result.push({ start, end, term: aliases.get(m[0].toLowerCase()), semantic: false });
    }
    return result;
  };
}
