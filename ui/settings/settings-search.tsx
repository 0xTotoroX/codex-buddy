/* [INPUT]: Mounted settings labels and category navigation.
 * [OUTPUT]: Local search with Cmd/Ctrl+K and original-control navigation without remounting forms.
 * [POS]: Presentation only; never indexes input values, credentials or chat content.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { pageTitles, type SettingsPage } from './settings-outline';
import { Icon } from '../shared/icons/react';

type Entry = {
  id: string;
  label: string;
  category: SettingsPage;
  context: string;
  keywords: string;
};
const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const aliases: Record<string, string> = {
  'model-organization': '模型 厂家 分类 分组 常用 手动 自动',
  'settings-prompt-enhancement': 'prompt 优化 改写 增强 开关',
  'settings-codex-host': 'CodexHost agent 代理 启动 安装 更新 回退 重启',
  'api-key': 'API key 密钥',
  'base-url': 'URL API 地址 接口',
  'host-restart-policy': '启动 重启 强制 询问',
};
function indexSettings(): Entry[] {
  const content = document.querySelector('.settings-content');
  if (!content) return [];
  const seen = new Set<string>();
  return Array.from(content.querySelectorAll('label,h2,summary,button[aria-label]')).flatMap(
    (node, i) => {
      if (node.matches('[data-drawer-heading], [data-drawer-close]')) return [];
      const category = node.closest<HTMLElement>('[data-settings-page]')?.dataset
        .settingsPage as SettingsPage;
      if (!category || !(category in pageTitles)) return [];
      const label = (node.getAttribute('aria-label') || node.textContent || '').trim();
      if (!label || label.length > 90) return [];
      const target =
        node instanceof HTMLLabelElement
          ? (node.htmlFor && document.getElementById(node.htmlFor)) ||
            node.querySelector<HTMLElement>('input,button,select') ||
            node
          : node;
      if (!(target instanceof HTMLElement)) return [];
      if (!target.id) {
        let candidate = `buddy-settings-search-${i}`;
        while (document.getElementById(candidate)) candidate += '-field';
        target.id = candidate;
      }
      const id = target.id;
      if (seen.has(id)) return [];
      seen.add(id);
      const section = node.closest('section');
      const context = section?.querySelector('h2')?.textContent?.trim() || '';
      const parentKeys = Object.entries(aliases)
        .filter(([key]) => node.closest(`#${key}`) || id === key)
        .map(([, value]) => value)
        .join(' ');
      return [
        {
          id,
          label,
          category,
          context,
          keywords: normalize(`${label} ${context} ${pageTitles[category]} ${parentKeys}`),
        },
      ];
    },
  );
}
function searchEntries(entries: Entry[], query: string) {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(' ').filter(Boolean);
  return entries
    .filter((entry) => terms.every((term) => entry.keywords.includes(term)))
    .sort(
      (a, b) =>
        Number(!normalize(a.label).includes(normalized)) -
        Number(!normalize(b.label).includes(normalized)),
    )
    .slice(0, 8);
}
export function SettingsSearch({
  navigate,
}: {
  navigate: (page: SettingsPage, hash: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      // 原生模态抽屉拥有当前焦点范围，不抢走抽屉内的编辑焦点。
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (!query.trim()) {
      setEntries([]);
      return;
    }
    const refresh = () => setEntries(indexSettings());
    refresh();
    const content = document.querySelector('.settings-content');
    const observer = new MutationObserver(refresh);
    if (content) observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [query]);
  const results = searchEntries(entries, query);
  function select(entry: Entry) {
    navigate(entry.category, `#settings-${entry.category}/${encodeURIComponent(entry.id)}`);
    setQuery('');
  }
  return (
    <div className="settings-search" data-settings-navigation>
      <div className="settings-search-input">
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          aria-keyshortcuts="Meta+K Control+K"
          aria-label="搜索设置"
          placeholder="搜索设置"
          value={query}
          aria-controls="settings-search-results"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              event.preventDefault();
            }
            if (event.key === 'ArrowDown') {
              resultsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
              event.preventDefault();
            }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              // 快速输入后回车可能早于 effect 建立索引，按当前输入和已挂载控件重新匹配。
              const first = searchEntries(indexSettings(), event.currentTarget.value)[0];
              if (first) {
                select(first);
                event.preventDefault();
              }
            }
          }}
        />
        <kbd aria-hidden="true">⌘ K</kbd>
      </div>
      {query.trim() && (
        <ul id="settings-search-results" aria-label="设置搜索结果" ref={resultsRef}>
          {results.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => select(entry)}>
                <span>{entry.label}</span>
                <small>
                  {pageTitles[entry.category]}
                  {entry.context && entry.context !== entry.label ? ` · ${entry.context}` : ''}
                </small>
              </button>
            </li>
          ))}
          {!results.length && (
            <li className="settings-search-empty" role="status">
              没有找到设置
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
