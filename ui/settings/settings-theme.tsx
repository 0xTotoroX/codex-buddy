/* [INPUT]: Authenticated Codex theme snapshot and this origin's display preference.
 * [OUTPUT]: Light/dark settings theme and an accessible three-way selector.
 * [POS]: Presentation only; never writes Codex appearance or business configuration.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Theme = 'light' | 'dark';
type Preference = Theme | 'codex';
const storageKey = 'codex-buddy-settings-theme';
const options = [
  ['codex', '跟随 Codex'],
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

export function SettingsTheme({ codexTheme }: { codexTheme?: string | null }) {
  const [preference, setPreference] = useState<Preference>(readPreference);
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
      if (event.key === storageKey || event.key === null) setPreference(readPreference());
    };
    syncSystem();
    media.addEventListener('change', syncSystem);
    window.addEventListener('storage', syncStorage);
    return () => {
      media.removeEventListener('change', syncSystem);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  function select(next: Preference) {
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Keep the current tab usable when browser storage is unavailable.
    }
  }

  return (
    <div className="settings-theme" role="group" aria-label="设置页主题" data-settings-navigation>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          onClick={() => select(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
