/* [INPUT]: URL 锚点、当前设置分类与 Dev 注入入口。
 * [OUTPUT]: 单页分类导航、旧锚点兼容、各分类阅读位置及最后访问分类。
 * [POS]: 设置导航；隐藏而不卸载内容，保留编辑草稿。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
export const pageTitles = {
  outline: '大纲',
  next: '下一步',
  board: '看板',
  model: '模型快切',
  surfaces: '显示与布局',
  connection: '启动与连接',
  dev: '开发',
};
export type SettingsPage = keyof typeof pageTitles;
const aliases: Record<string, SettingsPage> = {
  'settings-tasks': 'board',
  'settings-model-control': 'model',
  'settings-capsule': 'surfaces',
  'settings-features': 'next',
  'settings-model': 'next',
  'settings-directions': 'next',
  'settings-quick-prompts': 'next',
  'settings-limits': 'next',
  'settings-startup': 'connection',
};
function fromHash(): SettingsPage | null {
  const hash = location.hash.slice(1);
  if (aliases[hash]) return aliases[hash];
  const key = hash.replace(/^settings-/, '');
  return key in pageTitles ? (key as SettingsPage) : null;
}
export function useSettingsPage(ready: boolean) {
  const [selection, setSelection] = useState(() => {
    const saved = sessionStorage.getItem('buddy-settings-page') || '';
    return {
      page: fromHash() || (saved in pageTitles ? (saved as SettingsPage) : ('outline' as const)),
      hash: location.hash,
    };
  });
  const { page, hash } = selection;
  const [dev, setDev] = useState(false);
  const positions = useRef(new Map<string, number>());
  const current = useRef(page);
  function select(next: SettingsPage, hash: string) {
    if (next !== current.current) positions.current.set(current.current, window.scrollY);
    setSelection({ page: next, hash });
  }
  function navigate(next: SettingsPage, hash: string) {
    if (location.hash !== hash) history.pushState(null, '', hash);
    select(next, hash);
  }
  useEffect(() => {
    const change = () => {
      const next = fromHash();
      if (next) select(next, location.hash);
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('popstate', change);
    };
  }, []);
  useLayoutEffect(() => {
    current.current = page;
    sessionStorage.setItem('buddy-settings-page', page);
    window.scrollTo({ top: positions.current.get(page) || 0, behavior: 'instant' });
    if (!ready) return;
    const target = hash.slice(1);
    if (
      [
        'settings-model',
        'settings-directions',
        'settings-quick-prompts',
        'settings-limits',
        'settings-startup',
      ].includes(target) &&
      aliases[target] === page
    ) {
      const node = document.getElementById(target);
      if (node) {
        if (node instanceof HTMLDetailsElement) node.open = true;
        node.scrollIntoView({ behavior: 'instant' });
      }
    }
  }, [page, hash, ready]);
  useLayoutEffect(() => {
    let attachedHost: HTMLElement | null = null;
    const attach = () => {
      const host = document.getElementById('buddy-dev-sources'),
        slot = document.getElementById('settings-dev-content');
      if (host && slot) {
        attachedHost = host;
        if (host.parentNode !== slot) {
          slot.append(host);
          const details = host.shadowRoot?.querySelector('details');
          if (details) details.open = true;
        }
        setDev(true);
      }
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      // React may already have detached the slot during a hot reload. Keep the actual node.
      if (attachedHost) document.body.prepend(attachedHost);
    };
  }, []);
  return { page, dev, navigate };
}
export function SettingsOutline({
  page,
  dev,
  navigate,
}: {
  page: SettingsPage;
  dev: boolean;
  navigate: (page: SettingsPage, hash: string) => void;
}) {
  return (
    <nav aria-label="设置分类" className="settings-nav">
      <span className="settings-nav-label">功能</span>
      {(Object.keys(pageTitles) as SettingsPage[])
        .filter((id) => id !== 'dev' || dev)
        .map((id) => (
          <a
            key={id}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(id, event.currentTarget.hash);
            }}
            className={id === 'surfaces' ? 'settings-nav-divider' : ''}
            href={`#settings-${id === 'model' ? 'model-control' : id}`}
            aria-current={page === id ? 'page' : undefined}
          >
            {pageTitles[id]}
          </a>
        ))}
    </nav>
  );
}
