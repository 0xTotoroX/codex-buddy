/* [INPUT]: URL anchors, saved page preference (legacy mode ignored) and the Dev source widget.
 * [OUTPUT]: Grouped two-level navigation, legacy/search/invalid-field routing and per-page reading restoration without remounting forms.
 * [POS]: Presentation state only; never changes backend configuration or remounts forms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeSettingsDrawers, revealSettingsDrawer } from './settings-drawer';
export const pageTitles = {
  features: '常用开关',
  next: '下一步',
  prompts: '常用提示词',
  terminology: '术语释义',
  board: '任务看板',
  'model-control': '模型快切',
  model: '生成模型',
  surfaces: '布局与位置',
  appearance: '外观与字体',
  connection: '启动与连接',
  'codex-host': '宿主管理',
  dev: '开发来源',
};
export type SettingsPage = keyof typeof pageTitles;
export const pageGroups: { title: string; pages: SettingsPage[] }[] = [
  {
    title: '功能',
    pages: ['features', 'next', 'prompts', 'terminology', 'board', 'model-control'],
  },
  { title: '生成', pages: ['model'] },
  { title: '界面', pages: ['surfaces', 'appearance'] },
  { title: '系统', pages: ['connection', 'codex-host', 'dev'] },
];
export const pageGroup = (page: SettingsPage) =>
  pageGroups.find((group) => group.pages.includes(page))!;
const aliases: Record<string, SettingsPage> = {
  'settings-simple': 'features',
  'settings-overview': 'features',
  'settings-outline': 'features',
  'settings-model-control': 'model-control',
  'model-organization': 'model-control',
  'settings-next': 'next',
  'settings-board': 'board',
  'settings-tasks': 'board',
  'settings-directions': 'next',
  'settings-quick-prompts': 'prompts',
  'settings-terminology': 'terminology',
  'settings-library': 'terminology',
  'settings-jev-advanced': 'next',
  'settings-model': 'model',
  'settings-limits': 'model',
  'settings-capsule': 'surfaces',
  'settings-fonts': 'appearance',
  'settings-startup': 'connection',
  'settings-codex-host': 'codex-host',
  'settings-dev': 'dev',
};
function targetPage(field: string): SettingsPage | undefined {
  if (aliases[field]) return aliases[field];
  if (
    /^(provider|protocol|base-url|api-key(?:-env)?|model|max-input|max-output|context-scope|timeout)$/.test(
      field,
    )
  )
    return 'model';
  if (/^(font-|theme-|launcher-click-action)/.test(field)) return 'appearance';
  if (/^(edge-|placement-|main-|dock-width|window-pinning|settings-window)/.test(field))
    return 'surfaces';
  if (/^(generation-mode|direction-|jev-|suggestion-)/.test(field)) return 'next';
  return undefined;
}
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
    storage('sessionStorage', 'buddy-settings-page') ||
    storage('sessionStorage', 'buddy-settings-detail-page');
  return value in pageTitles ? (value as SettingsPage) : aliases['settings-' + value] || 'features';
}
function fromHash() {
  const [section, field = ''] = location.hash.slice(1).split('/');
  let decoded = field;
  try {
    decoded = decodeURIComponent(field);
  } catch {}
  const fieldPage = targetPage(decoded);
  if (fieldPage) return { page: fieldPage };
  const page =
    aliases[section] ||
    (section.replace(/^settings-/, '') in pageTitles
      ? (section.replace(/^settings-/, '') as SettingsPage)
      : null);
  return page ? { page } : null;
}
let revealedField = 0;
export function revealSettingsField(target: HTMLElement) {
  if (!target.id) target.id = `buddy-settings-invalid-${++revealedField}`;
  const owner = target.closest<HTMLElement>('[data-settings-page]')?.dataset.settingsPage;
  if (owner && owner in pageTitles && target.closest('[hidden]')) {
    document.dispatchEvent(
      new CustomEvent('buddy-settings-reveal', { detail: { page: owner, id: target.id } }),
    );
  } else {
    const concealed = !!target.closest('dialog:not([open])');
    revealSettingsDrawer(target).focus({ preventScroll: true });
    if (concealed) requestAnimationFrame(() => reportInvalidField(target));
  }
}
function reportInvalidField(target: HTMLElement) {
  if (
    (target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement) &&
    target.matches(':invalid')
  )
    target.reportValidity();
}
export function useSettingsPage(ready: boolean) {
  const [selection, setSelection] = useState(() => ({
    ...(fromHash() || { page: savedPage() }),
    hash: location.hash,
  }));
  const { page, hash } = selection;
  const [dev, setDev] = useState(false);
  const positions = useRef(new Map<string, number>());
  const current = useRef(selection);
  function select(next: { page: SettingsPage }, hash: string) {
    closeSettingsDrawers();
    positions.current.set(current.current.page, window.scrollY);
    setSelection({ page: next.page, hash });
  }
  function navigate(next: SettingsPage, hash: string) {
    if (location.hash !== hash) history.pushState({ buddySettings: { page: next } }, '', hash);
    select({ page: next }, hash);
  }
  useEffect(() => {
    const change = () => {
      const next = fromHash() || history.state?.buddySettings;
      if (next) select(next, location.hash);
    };
    const reveal = (event: Event) => {
      const { page, id } = (event as CustomEvent<{ page: SettingsPage; id: string }>).detail;
      navigate(page, `#settings-${page}/${encodeURIComponent(id)}`);
    };
    document.addEventListener('buddy-settings-reveal', reveal);
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => {
      document.removeEventListener('buddy-settings-reveal', reveal);
      window.removeEventListener('hashchange', change);
      window.removeEventListener('popstate', change);
    };
  }, []);
  useLayoutEffect(() => {
    current.current = selection;
    if (history.state?.buddySettings?.page !== page)
      history.replaceState({ ...history.state, buddySettings: { page } }, '', location.href);
    remember('sessionStorage', 'buddy-settings-page', page);
    window.scrollTo({
      top: positions.current.get(page) || 0,
      behavior: 'instant',
    });
    if (!ready) return;
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
      let node = document.getElementById(target);
      if (!node) return false;
      const owner = node.closest<HTMLElement>('[data-settings-page]')?.dataset.settingsPage;
      if (owner && owner in pageTitles && owner !== page) {
        navigate(owner as SettingsPage, `#settings-${owner}/${encodeURIComponent(target)}`);
        return true;
      }
      if (node.closest('[hidden]')) return false;
      node = revealSettingsDrawer(node);
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (!node.hasAttribute('tabindex') && !node.matches('input,select,button,a'))
        node.tabIndex = -1;
      node.focus({ preventScroll: true });
      node.scrollIntoView({ behavior: 'instant', block: 'center' });
      reportInvalidField(node);
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
  }, [selection, ready]);
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
  dev = false,
  navigate,
}: {
  page: SettingsPage;
  dev?: boolean;
  navigate: (page: SettingsPage, hash: string) => void;
}) {
  const group = pageGroup(page);
  return (
    <nav aria-label="设置分类" className="settings-nav" data-settings-navigation>
      <div className="settings-mobile-groups" aria-label="设置分组">
        {pageGroups.map((item) => (
          <button
            key={item.title}
            type="button"
            aria-pressed={item === group}
            onClick={() => navigate(item.pages[0], `#settings-${item.pages[0]}`)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="settings-category-links">
        {pageGroups.map((item) => (
          <section
            key={item.title}
            className="settings-nav-group"
            data-active={item === group}
            aria-label={item.title}
          >
            <h2>{item.title}</h2>
            <div className="settings-nav-children">
              {item.pages
                .filter((id) => id !== 'dev' || dev || page === 'dev')
                .map((id) => (
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
                    <span>{pageTitles[id]}</span>
                  </a>
                ))}
            </div>
          </section>
        ))}
      </div>
    </nav>
  );
}
