/*
 * [INPUT]: 独立模型控制偏好/显示器API、共享设置控件。
 * [OUTPUT]: 模型快切的屏幕、位置及四主题即时设置。
 * [POS]: 设置页局部组件；版本冲突重读，不改工作台外观或模型选择。
 * [PROTOCOL]: 接口变化时同步 ui/settings/AGENTS.md。
 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';

type Preferences = {
  edge: 'left' | 'right' | 'top';
  position: number;
  screen: string;
  theme?: 'black' | 'matte' | 'frosted' | 'native-glass';
  liquidVariant?: 'regular' | 'clear';
};
type State = { revision: number; preferences: Preferences };
type Displays = { screens: { id: string; label: string }[]; nativeGlassAvailable: boolean };
export function ModelControlSettings({ live }: { live: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [displays, setDisplays] = useState<Displays>({ screens: [], nativeGlassAvailable: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [position, setPosition] = useState(50);
  const loading = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const generation = ++loading.current;
      try {
        const [next, screens] = await Promise.all([
          request<State>('model-control/state'),
          request<Displays>('model-control/displays'),
        ]);
        if (!disposed && generation === loading.current) {
          setState(next);
          setPosition(Math.round(next.preferences.position * 100));
          setDisplays(screens);
        }
      } catch (error) {
        if (!disposed && generation === loading.current) setMessage(String(error));
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      window.removeEventListener('focus', load);
    };
  }, [live]);
  async function save(patch: Partial<Preferences>) {
    if (!state || writing.current) return;
    writing.current = true;
    loading.current++;
    setBusy(true);
    setMessage('');
    try {
      const next = await request<State>('model-control/preferences', {
        revision: state.revision,
        patch,
      });
      setState(next);
      setPosition(Math.round(next.preferences.position * 100));
      setMessage('已保存');
    } catch (error) {
      setMessage(String(error));
      try {
        const next = await request<State>('model-control/state');
        setState(next);
        setPosition(Math.round(next.preferences.position * 100));
      } catch {
        /* Preserve original failure. */
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const prefs = state?.preferences;
  const disabled = !live || busy || !prefs;
  const missing = prefs?.screen && !displays.screens.some((s) => s.id === prefs.screen);
  return (
    <section
      tabIndex={-1}
      id="settings-model-control"
      aria-label="模型快切设置"
      className="mb-5 rounded-xl border border-border bg-card p-4"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">模型快切</h2>
          <p className="mt-1 text-xs text-muted-foreground">屏幕、位置和主题独立保存。</p>
        </div>
        <Button
          variant="outline"
          disabled={!live || busy}
          onClick={async () => {
            if (writing.current) return;
            writing.current = true;
            loading.current++;
            setBusy(true);
            try {
              await request('model-control/open', {});
              setMessage('模型控制条已打开');
              const next = await request<State>('model-control/state');
              setState(next);
            } catch (e) {
              setMessage(String(e));
            } finally {
              writing.current = false;
              setBusy(false);
            }
          }}
        >
          打开控制条
        </Button>
      </div>
      <div className="grid grid-cols-2 items-center gap-x-6 gap-y-3 max-[650px]:grid-cols-1">
        <label className="grid grid-cols-[56px_1fr] items-center gap-3">
          <span className="text-xs text-muted-foreground">屏幕</span>
          <NativeSelect
            aria-label="模型快切屏幕"
            disabled={disabled}
            value={prefs?.screen || ''}
            onChange={(e) => void save({ screen: e.target.value })}
          >
            <option value="">自动选择</option>
            {displays.screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            {missing && <option value={prefs.screen}>已保存的显示器（未连接）</option>}
          </NativeSelect>
        </label>
        <label className="grid grid-cols-[56px_1fr] items-center gap-3">
          <span className="text-xs text-muted-foreground">边缘</span>
          <NativeSelect
            aria-label="模型快切边缘"
            disabled={disabled}
            value={prefs?.edge || 'right'}
            onChange={(e) => void save({ edge: e.target.value as Preferences['edge'] })}
          >
            <option value="right">右侧</option>
            <option value="left">左侧</option>
            <option value="top">顶部 / 刘海</option>
          </NativeSelect>
        </label>
        <label className="grid grid-cols-[56px_1fr] items-center gap-3">
          <span className="text-xs text-muted-foreground">位置</span>
          <span className="flex items-center gap-3">
            <input
              className="min-w-0 flex-1 accent-primary"
              aria-label="模型快切位置"
              type="range"
              min="0"
              max="100"
              disabled={disabled}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              onPointerUp={() => void save({ position: position / 100 })}
              onKeyUp={(e) => {
                if (
                  [
                    'ArrowLeft',
                    'ArrowRight',
                    'ArrowUp',
                    'ArrowDown',
                    'Home',
                    'End',
                    'PageUp',
                    'PageDown',
                  ].includes(e.key)
                )
                  void save({ position: position / 100 });
              }}
            />
            <span className="w-9 text-right text-xs tabular-nums">{position}%</span>
          </span>
        </label>
        <label className="grid grid-cols-[56px_1fr] items-center gap-3">
          <span className="text-xs text-muted-foreground">主题</span>
          <NativeSelect
            aria-label="模型快切主题"
            disabled={disabled}
            value={prefs?.theme || 'black'}
            onChange={(e) => void save({ theme: e.target.value as Preferences['theme'] })}
          >
            <option value="black">纯黑（默认）</option>
            <option value="matte">哑光</option>
            <option value="frosted">磨砂</option>
            <option value="native-glass">液态</option>
          </NativeSelect>
        </label>
        {prefs?.theme === 'native-glass' && (
          <label className="grid grid-cols-[56px_1fr] items-center gap-3">
            <span className="text-xs text-muted-foreground">液态</span>
            <NativeSelect
              aria-label="模型快切液态变体"
              disabled={disabled}
              value={prefs.liquidVariant || 'regular'}
              onChange={(e) =>
                void save({ liquidVariant: e.target.value as Preferences['liquidVariant'] })
              }
            >
              <option value="regular">Regular</option>
              <option value="clear">Clear</option>
            </NativeSelect>
          </label>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {prefs?.edge === 'top'
          ? '位置从左到右；带物理刘海的屏幕自动贴合刘海。'
          : '位置从上到下，50% 为居中。'}
      </p>
      {prefs?.theme === 'native-glass' && !displays.nativeGlassAvailable && (
        <p className="mt-2 text-xs text-muted-foreground">
          当前系统不支持原生液态，暂以哑光显示并保留选择。
        </p>
      )}
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {message}
      </p>
    </section>
  );
}
