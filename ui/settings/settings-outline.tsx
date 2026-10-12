/* [INPUT]: URL anchors, local presentation preference and the Dev source widget.
 * [OUTPUT]: Simple/detail navigation with per-mode/category reading restoration and legacy anchors.
 * [POS]: Presentation state only; never changes backend configuration or remounts forms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NativeSelect } from './components/ui/native-select';
export const pageTitles = {
  features: '功能与交互',
  model: '模型与生成',
  surfaces: '外观与布局',
  connection: '启动与开发',
};
export type SettingsPage = keyof typeof pageTitles;
export type SettingsMode = 'simple' | 'detail';
const aliases: Record<string, SettingsPage> = {
  'settings-overview': 'features',
  'settings-outline': 'features',
  'settings-model-control': 'features',
  'model-organization': 'features',
  'settings-next': 'features',
  'settings-board': 'features',
  'settings-tasks': 'features',
  'settings-directions': 'features',
  'settings-quick-prompts': 'features',
  'settings-model': 'model',
  'settings-limits': 'model',
  'settings-capsule': 'surfaces',
  'settings-startup': 'connection',
  'settings-codex-host': 'connection',
  'settings-dev': 'connection',
};
const legacyTargets: Record<string, string> = {
  'settings-board': 'settings-tasks',
  'settings-dev': 'settings-dev-content',
};
const storage = (kind: 'localStorage' | 'sessionStorage', key: string) => {
  try {
    return window[kind].getItem(key) || '';
  } catch {
    return '';
  }
};
function remember(kind: 'localStorage' | 'sessionStorage', key: string, value: string) {
  try {
    window[kind].setItem(key, value);
  } catch {}
}
function savedPage(): SettingsPage {
  const value =
    storage('sessionStorage', 'buddy-settings-detail-page') ||
    storage('sessionStorage', 'buddy-settings-page');
  return value in pageTitles ? (value as SettingsPage) : aliases['settings-' + value] || 'features';
}
function fromHash() {
  const [section, field = ''] = location.hash.slice(1).split('/');
  if (
    /^(provider|protocol|base-url|api-key(?:-env)?|model|max-input|max-output|context-scope|timeout)$/.test(
      field,
    )
  )
    return { mode: 'detail' as const, page: 'model' as const };
  if (
    /^(font-|theme-|edge-|placement-|main-|dock-width|window-pinning|launcher-click-action)/.test(
      field,
    )
  )
    return { mode: 'detail' as const, page: 'surfaces' as const };
  if (section === 'settings-simple' || section === 'settings-overview')
    return { mode: 'simple' as const, page: savedPage() };
  const page =
    aliases[section] ||
    (section.replace(/^settings-/, '') in pageTitles
      ? (section.replace(/^settings-/, '') as SettingsPage)
      : null);
  return page ? { mode: 'detail' as const, page } : null;
}
export function useSettingsPage(ready: boolean) {
  const [selection, setSelection] = useState(() => ({
    ...(fromHash() || {
      mode:
        storage('localStorage', 'buddy-settings-mode') === 'detail'
          ? ('detail' as const)
          : ('simple' as const),
      page: savedPage(),
    }),
    hash: location.hash,
  }));
  const { page, mode, hash } = selection;
  const [dev, setDev] = useState(false);
  const positions = useRef(new Map<string, number>());
  const current = useRef(selection);
  const positionKey = (value: { mode: SettingsMode; page: SettingsPage }) =>
    value.mode === 'simple' ? 'simple' : `detail:${value.page}`;
  function select(next: { mode: SettingsMode; page: SettingsPage }, hash: string) {
    if (
      current.current.mode === next.mode &&
      current.current.page === next.page &&
      current.current.hash === hash
    )
      return;
    positions.current.set(positionKey(current.current), window.scrollY);
    setSelection({ ...next, hash });
  }
  function navigate(next: SettingsPage, hash: string) {
    if (location.hash !== hash)
      history.pushState({ buddySettings: { mode: 'detail', page: next } }, '', hash);
    select({ mode: 'detail', page: next }, hash);
  }
  function switchMode(next: SettingsMode) {
    if (mode === next) return;
    const nextHash = next === 'simple' ? '#settings-simple' : `#settings-${page}`;
    history.pushState({ buddySettings: { mode: next, page } }, '', nextHash);
    select({ mode: next, page }, nextHash);
  }
  useEffect(() => {
    const change = () => {
      const next = fromHash() || history.state?.buddySettings;
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
    current.current = selection;
    if (history.state?.buddySettings?.mode !== mode || history.state?.buddySettings?.page !== page)
      history.replaceState({ ...history.state, buddySettings: { mode, page } }, '', location.href);
    remember('localStorage', 'buddy-settings-mode', mode);
    remember('sessionStorage', 'buddy-settings-detail-page', page);
    window.scrollTo({
      top: positions.current.get(positionKey(selection)) || 0,
      behavior: 'instant',
    });
    if (!ready || mode === 'simple') return;
    const [section, encodedField] = hash.slice(1).split('/');
    let field = encodedField;
    try {
      field = decodeURIComponent(encodedField || '');
    } catch {
      /* Preserve malformed legacy fragments. */
    }
    const target =
      field ||
      legacyTargets[section] ||
      (aliases[section] === page && !(section.replace(/^settings-/, '') in pageTitles)
        ? section
        : '');
    if (!target) return;
    const focusTarget = () => {
      const node = document.getElementById(target);
      if (!node || node.closest('[hidden]')) return false;
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true;
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
  }, [page, mode, hash, ready]);
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

  return { page, mode, dev, navigate, switchMode };
}
export function SettingsOutline({
  page,
  mode = 'detail',
  navigate,
}: {
  page: SettingsPage;
  mode?: SettingsMode;
  dev?: boolean;
  navigate: (page: SettingsPage, hash: string) => void;
}) {
  return (
    <nav
      aria-label="设置分类"
      className="settings-nav"
      hidden={mode === 'simple'}
      data-settings-navigation
    >
      <NativeSelect
        className="settings-category-select"
        aria-label="详细设置分类"
        value={page}
        onChange={(event) =>
          navigate(event.target.value as SettingsPage, `#settings-${event.target.value}`)
        }
      >
        {Object.entries(pageTitles).map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </NativeSelect>
      <div className="settings-category-links">
        {(Object.keys(pageTitles) as SettingsPage[]).map((id) => (
          <a
            key={id}
            href={`#settings-${id}`}
            aria-current={page === id ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(id, event.currentTarget.hash);
            }}
          >
            {pageTitles[id]}
          </a>
        ))}
      </div>
    </nav>
  );
}
