/* [INPUT]: Mounted settings labels, explicit page catalog and lazy drawer entries.
 * [OUTPUT]: Local search with Cmd/Ctrl+K and original-control navigation without remounting forms.
 * [POS]: Presentation only; never indexes input values, credentials or chat content.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState, useId } from 'react';
import { pageTitles, pageGroups, pageGroup, type SettingsPage } from './settings-outline';
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
  const fields = Array.from(
    content.querySelectorAll('label,h2,summary,button[aria-label]'),
  ).flatMap((node, i) => {
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
  });
  const pages = pageGroups
    .flatMap((group) => group.pages)
    .filter((category) => category !== 'dev' || document.getElementById('buddy-dev-sources'))
    .map((category) => ({
      id: '',
      label: pageTitles[category],
      category,
      context: '',
      keywords: normalize(pageTitles[category]),
    }));
  const drawers: Entry[] = [
    {
      id: 'settings-library',
      label: '词库管理',
      category: 'terminology',
      context: '术语释义',
      keywords: '词库管理 导入 导出',
    },
    {
      id: 'model-organization',
      label: '模型分组',
      category: 'model-control',
      context: '模型切换',
      keywords: '模型分组 厂家 分类',
    },
  ];
  return [...fields, ...pages, ...drawers].filter(
    (entry, index, all) =>
      all.findIndex((other) => other.category === entry.category && other.label === entry.label) ===
      index,
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
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  function show() {
    if (document.querySelector('dialog[open]')) return;
    dialogRef.current?.showModal();
    setOpen(true);
    inputRef.current?.focus();
  }
  function close() {
    dialogRef.current?.close();
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus({ preventScroll: true });
  }
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
      show();
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
  const results = query.trim()
    ? searchEntries(entries, query)
    : pageGroups
        .flatMap((group) => group.pages)
        .filter((category) => category !== 'dev' || document.getElementById('buddy-dev-sources'))
        .map((category) => ({
          id: '',
          label: pageTitles[category],
          category,
          context: '',
          keywords: '',
        }));
  function select(entry: Entry) {
    close();
    navigate(
      entry.category,
      `#settings-${entry.category}${entry.id ? '/' + encodeURIComponent(entry.id) : ''}`,
    );
    setQuery('');
  }
  return (
    <div className="settings-search" data-settings-navigation>
      <button
        ref={triggerRef}
        type="button"
        className="settings-search-trigger"
        aria-label="搜索设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={show}
      >
        <Icon name="search" />
        <kbd aria-hidden="true">⌘ K</kbd>
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        className="settings-search-dialog"
        aria-label="搜索设置"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              close();
          }
        }}
      >
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
                close();
                event.preventDefault();
              }
              if (event.key === 'ArrowDown') {
                resultsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                event.preventDefault();
              }
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                // 快速输入后回车可能早于 effect 建立索引，按当前输入和已挂载控件重新匹配。
                const first = event.currentTarget.value.trim()
                  ? searchEntries(indexSettings(), event.currentTarget.value)[0]
                  : results[0];
                if (first) {
                  select(first);
                  event.preventDefault();
                }
              }
            }}
          />
          <button type="button" aria-label="关闭搜索" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        {
          <ul
            id="settings-search-results"
            aria-label="设置搜索结果"
            ref={resultsRef}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
              const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : event.key === 'ArrowDown'
                      ? (i + 1) % buttons.length
                      : i - 1;
              if (next < 0) inputRef.current?.focus();
              else buttons[next]?.focus();
              event.preventDefault();
            }}
          >
            {results.map((entry) => (
              <li key={`${entry.category}:${entry.id}`}>
                <button type="button" onClick={() => select(entry)}>
                  <span>{entry.label}</span>
                  <small>
                    {entry.label === pageTitles[entry.category]
                      ? pageGroup(entry.category).title
                      : [...new Set([pageTitles[entry.category], entry.context])]
                          .filter((text) => text && text !== entry.label)
                          .join(' · ')}
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
        }
      </dialog>
    </div>
  );
}
