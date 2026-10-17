/* [INPUT]: Authenticated Codex theme snapshot, shared icons and this origin's display preference.
 * [OUTPUT]: Light/dark settings theme and a compact trigger with three retained preference options.
 * [POS]: Settings-only preference; revision-checked Buddy persistence, never writes Codex appearance.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import type { AppearanceSettings } from '../shared/contracts';
import { request } from './api';

type Theme = 'light' | 'dark';
type Preference = Theme | 'codex';
const storageKey = 'codex-buddy-settings-theme';
const options = [
  ['codex', '自动'],
  ['light', '浅色'],
  ['dark', '深色'],
] as const;
const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

function readPreference(): Preference {
  try {
    const saved = localStorage.getItem(storageKey);
    return isTheme(saved) ? saved : 'codex';
  } catch {
    return 'codex';
  }
}

export function SettingsTheme({
  codexTheme,
  appearance,
  notify,
}: {
  codexTheme?: string | null;
  appearance?: AppearanceSettings;
  notify?: (message: string, failed?: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const acceptedRevision = useRef(-1);
  const persisted = useRef(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const [preference, setPreference] = useState<Preference>(readPreference);
  useEffect(() => {
    const value = appearance?.settingsTheme;
    if (value && appearance.revision >= acceptedRevision.current) {
      persisted.current = true;
      acceptedRevision.current = appearance.revision;
      remember(value);
    }
  }, [appearance?.settingsTheme, appearance?.revision]);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const lastCodexTheme = useRef<Theme | null>(null);
  const theme =
    preference === 'codex'
      ? isTheme(codexTheme)
        ? codexTheme
        : lastCodexTheme.current || systemTheme
      : preference;

  useLayoutEffect(() => {
    if (isTheme(codexTheme)) lastCodexTheme.current = codexTheme;
    document.documentElement.dataset.settingsTheme = theme;
    document.documentElement.dataset.settingsThemeMode = preference;
  }, [codexTheme, preference, theme]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => setSystemTheme(media.matches ? 'dark' : 'light');
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      if (persisted.current && !['codex', 'light', 'dark'].includes(event.newValue || '')) return;
      setPreference(readPreference());
    };
    syncSystem();
    media.addEventListener('change', syncSystem);
    window.addEventListener('storage', syncStorage);
    return () => {
      media.removeEventListener('change', syncSystem);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  function remember(next: Preference) {
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Keep the current tab usable when browser storage is unavailable.
    }
  }

  async function select(next: Preference) {
    if (pending.current || (next === preference && persisted.current)) return;
    if (!appearance) return remember(next);
    pending.current = true;
    setSaving(true);
    try {
      const latest = await request<AppearanceSettings>('appearance');
      const saved = await request<AppearanceSettings>('appearance', {
        expectedRevision: latest.revision,
        settingsTheme: next,
      });
      persisted.current = true;
      acceptedRevision.current = saved.revision;
      remember(saved.settingsTheme || next);
    } catch (error) {
      notify?.(error instanceof Error ? error.message : '主题保存失败，请重试。', true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const label = options.find(([value]) => value === preference)![1];
  const symbol = (value: Preference) =>
    value === 'codex' ? 'theme-auto' : value === 'light' ? 'sun' : 'moon';
  return (
    <div
      className="settings-theme"
      ref={root}
      data-settings-navigation
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="settings-theme-trigger"
        aria-label={`设置页主题：${label}`}
        title={preference === 'codex' ? '自动跟随 Codex' : label}
        disabled={saving}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        <Icon name={symbol(preference)} />
        <span>{label}</span>
      </button>
      <div
        id={menuId}
        ref={menu}
        className="settings-theme-menu"
        role="group"
        aria-label="设置页主题"
        hidden={!open}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}
      >
        {options.map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-label={name}
            aria-pressed={preference === value}
            onClick={() => {
              void select(value);
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <Icon name={symbol(value)} />
            <span>{name}</span>
            <Icon name="check" className="settings-theme-check" />
          </button>
        ))}
      </div>
    </div>
  );
}
