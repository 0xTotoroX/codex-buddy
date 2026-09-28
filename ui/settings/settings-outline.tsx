/* [INPUT]: URL 锚点、当前设置分类与 Dev 注入入口。
 * [OUTPUT]: 单页分类导航、属性定位与折叠展开、旧锚点兼容、各分类阅读位置及最后访问分类。
 * [POS]: 设置导航；隐藏而不卸载内容，保留编辑草稿。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
export const pageTitles = {
  overview: '总览',
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
  const hash = location.hash.slice(1).split('/')[0];
  if (aliases[hash]) return aliases[hash];
  const key = hash.replace(/^settings-/, '');
  return key in pageTitles ? (key as SettingsPage) : null;
}
export function useSettingsPage(ready: boolean) {
  const [selection, setSelection] = useState(() => {
    const saved = sessionStorage.getItem('buddy-settings-page') || '';
    return {
      page: fromHash() || (saved in pageTitles ? (saved as SettingsPage) : ('overview' as const)),
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
    const [section, field] = hash.slice(1).split('/');
    const target = field || (aliases[section] === page ? section : '');
    if (!target) return;
    const focusTarget = () => {
      const node = document.getElementById(target);
      if (!node) return false;
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      if (!node.hasAttribute('tabindex') && !node.matches('input,select,button,a'))
        node.tabIndex = -1;
      node.focus({ preventScroll: true });
      node.scrollIntoView({ behavior: 'instant', block: 'center' });
      return true;
    };
    if (focusTarget()) return;
    const observer = new MutationObserver(() => {
      if (focusTarget()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
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
            className={id === 'surfaces' || id === 'outline' ? 'settings-nav-divider' : ''}
            href={`#settings-${id === 'model' ? 'model-control' : id}`}
            aria-current={page === id ? 'page' : undefined}
          >
            {pageTitles[id]}
          </a>
        ))}
    </nav>
  );
}
