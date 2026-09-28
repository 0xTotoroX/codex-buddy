/* [INPUT]: Independent surface preferences and display inventory. [OUTPUT]: Per-form themes and edge placement.
 * [POS]: Presentation settings, no feature enable/disable or business state.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { FeatureSettings } from './feature-settings';
import { request } from './api';
import { NativeSelect } from './components/ui/native-select';
import type { SurfaceTheme } from '../surfaces/theme/appearance';
const labels = { sidebar: '侧栏', overlay: '页面浮层', desktop: '桌面窗口', edge: '贴边 / 刘海' };
type Edge = { edge: string; screen: string; position: number; keepOpen: boolean };
type State = {
  revision: number;
  preferences: { themes: Record<string, SurfaceTheme>; edge: Edge };
  error?: string;
};
type Displays = { screens: { id: string; label: string }[]; nativeGlassAvailable: boolean };
export function SurfaceSettings({
  live,
  desktopSupported,
}: {
  live: boolean;
  desktopSupported: boolean;
}) {
  const [state, setState] = useState<State | null>(null),
    [displays, setDisplays] = useState<Displays>({ screens: [], nativeGlassAvailable: false }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [position, setPosition] = useState(50);
  const writing = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const current = ++generation.current;
      try {
        const [value, screens] = await Promise.all([
          request<State>('surfaces', { op: 'state' }),
          request<Displays>('surfaces/displays'),
        ]);
        if (!disposed && current === generation.current) {
          setState(value);
          setDisplays(screens);
          setPosition(value.preferences.edge.position * 100);
        }
      } catch (error) {
        if (!disposed) setMessage(String(error));
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      window.removeEventListener('focus', load);
    };
  }, [live]);
  async function save(patch: object) {
    if (!state || writing.current) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      const next = await request<State>('surfaces', {
        op: 'save',
        revision: state.revision,
        ...patch,
      });
      setState(next);
      setPosition(next.preferences.edge.position * 100);
    } catch (error) {
      setMessage(String(error));
      try {
        const next = await request<State>('surfaces', { op: 'state' });
        setState(next);
        setPosition(next.preferences.edge.position * 100);
      } catch {
        /* Keep the last known preferences. */
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const disabled = !live || !state || busy || !!state.error,
    edge = state?.preferences.edge;
  return (
    <section
      id="settings-surfaces"
      tabIndex={-1}
      aria-label="呈现形式设置"
      className="mb-5 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-medium">呈现形式</h2>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">
        每种形式独立保存主题，所有功能共用。纯黑固定配色，其他主题跟随 Codex 明暗。
      </p>
      <div className="space-y-3">
        {Object.entries(labels).map(([placement, label]) => {
          const theme = state?.preferences.themes[placement] || {
            theme: 'matte',
            liquidVariant: 'regular',
          };
          return (
            <div
              key={placement}
              className="grid grid-cols-[minmax(104px,1fr)_minmax(140px,280px)] items-center gap-3"
            >
              <span className="whitespace-nowrap text-sm">{label}</span>
              <div className="flex min-w-0 gap-2">
                <NativeSelect
                  aria-label={`${label}主题`}
                  disabled={disabled}
                  value={theme.theme}
                  onChange={(event) =>
                    void save({ placement, theme: { ...theme, theme: event.target.value } })
                  }
                >
                  <option value="black">纯黑</option>
                  <option value="matte">哑光</option>
                  <option value="frosted">磨砂</option>
                  <option value="native-glass">液态</option>
                </NativeSelect>
                {theme.theme === 'native-glass' && (
                  <NativeSelect
                    aria-label={`${label}液态变体`}
                    disabled={disabled}
                    value={theme.liquidVariant}
                    onChange={(event) =>
                      void save({
                        placement,
                        theme: { ...theme, liquidVariant: event.target.value },
                      })
                    }
                  >
                    <option value="regular">Regular</option>
                    <option value="clear">Clear</option>
                  </NativeSelect>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <FeatureSettings notify={setMessage} desktopSupported={desktopSupported} />
      <details className="mt-5 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm">贴边 / 刘海位置</summary>
        <div className="mt-3 space-y-3">
          <label className="grid grid-cols-[minmax(104px,1fr)_minmax(140px,280px)] items-center gap-3 text-sm">
            <span className="whitespace-nowrap">屏幕</span>
            <NativeSelect
              aria-label="贴边屏幕"
              disabled={disabled}
              value={edge?.screen || ''}
              onChange={(event) => void save({ edge: { screen: event.target.value } })}
            >
              <option value="">自动选择</option>
              {displays.screens.map((screen) => (
                <option key={screen.id} value={screen.id}>
                  {screen.label}
                </option>
              ))}
              {edge?.screen && !displays.screens.some((screen) => screen.id === edge.screen) && (
                <option value={edge.screen}>已断开的屏幕（保留选择）</option>
              )}
            </NativeSelect>
          </label>
          <label className="grid grid-cols-[minmax(104px,1fr)_minmax(140px,280px)] items-center gap-3 text-sm">
            <span className="whitespace-nowrap">边缘</span>
            <NativeSelect
              aria-label="贴边边缘"
              disabled={disabled}
              value={edge?.edge || 'right'}
              onChange={(event) => void save({ edge: { edge: event.target.value } })}
            >
              <option value="right">右侧</option>
              <option value="left">左侧</option>
              <option value="top">顶部 / 刘海</option>
            </NativeSelect>
          </label>
          <label className="grid grid-cols-[minmax(104px,1fr)_minmax(140px,280px)] items-center gap-3 text-sm">
            <span className="whitespace-nowrap">位置 {Math.round(position)}%</span>
            <input
              aria-label="贴边位置"
              type="range"
              min="0"
              max="100"
              disabled={disabled}
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
              onPointerUp={() => void save({ edge: { position: position / 100 } })}
              onKeyUp={() => void save({ edge: { position: position / 100 } })}
            />
          </label>
          <label className="grid grid-cols-[minmax(104px,1fr)_minmax(140px,280px)] items-center gap-3 text-sm">
            <span className="whitespace-nowrap">保持展开</span>
            <input
              aria-label="贴边保持展开"
              type="checkbox"
              disabled={disabled}
              checked={edge?.keepOpen || false}
              onChange={(event) => void save({ edge: { keepOpen: event.target.checked } })}
            />
          </label>
        </div>
      </details>
      <p className="mt-3 text-xs text-muted-foreground">
        贴边形式共用一个窗口，通过标签切换功能。侧栏和页面浮层使用网页材质；桌面和贴边使用系统材质
        {!displays.nativeGlassAvailable ? '，当前系统不支持原生液态时以哑光显示' : ''}。
      </p>
      {(message || state?.error) && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {message || state?.error}
        </p>
      )}
    </section>
  );
}
