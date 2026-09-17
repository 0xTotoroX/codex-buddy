/*
 * [INPUT]: SSE 外观快照、后台弹出能力与经过认证的外观 API。
 * [OUTPUT]: Web 胶囊设置与工作台布局偏好；逐项保存并处理其他窗口的并发更新，不改变功能开关。
 * [POS]: 设置页外观、交互与窗口控件；不接收聊天内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { request } from './api';
import type { AppearanceSettings, PanelPreferences } from '../contracts';

export function PanelSettings({
  value,
  theme,
  fontBase = 13,
  connected,
  popoutSupported,
  notify,
}: {
  value?: AppearanceSettings;
  theme?: string | null;
  fontBase?: number;
  connected: boolean;
  popoutSupported: boolean;
  notify: (text: string, failed?: boolean) => void;
}) {
  const [prefs, setPrefs] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value)
      setPrefs((current) => (!current || value.revision >= current.revision ? value : current));
  }, [value]);
  if (!prefs) return null;
  const { ui } = prefs;
  async function update(body: Record<string, unknown>) {
    if (!prefs || busy) return;
    setBusy(true);
    try {
      setPrefs(
        await request<AppearanceSettings>('appearance', {
          ...body,
          expectedRevision: prefs.revision,
        }),
      );
    } catch (error) {
      notify((error as Error).message, true);
      try {
        setPrefs(await request<AppearanceSettings>('appearance'));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  const change = <K extends keyof PanelPreferences>(key: K, value: PanelPreferences[K]) =>
    void update({ ui: { [key]: value } });
  async function action(path: string, body: object = {}) {
    if (path === 'panel/open' && !popoutSupported) return;
    setBusy(true);
    try {
      await request(path, body);
      setPrefs(await request<AppearanceSettings>('appearance'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const select = (label: string, key: keyof PanelPreferences, options: [string, string][]) => (
    <label className="min-w-0 [&>span]:mb-2 [&>span]:block [&>span]:text-xs [&>span]:font-[550]">
      <span>{label}</span>
      <NativeSelect
        aria-label={label}
        value={String(ui[key])}
        onChange={(e) => change(key, e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    commit: (value: number) => void,
  ) => (
    <label className="min-w-0 [&>span]:mb-2 [&>span]:block [&>span]:text-xs [&>span]:font-[550]">
      <span>{label}</span>
      <Input
        key={value}
        aria-label={label}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step="any"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const next = e.currentTarget.valueAsNumber;
          if (Number.isFinite(next) && next >= min && next <= max) {
            if (next !== value) commit(next);
          } else {
            e.currentTarget.value = String(value);
            notify(`${label}范围为 ${min}–${max}`, true);
          }
        }}
      />
    </label>
  );
  return (
    <Card aria-label="胶囊设置">
      <div className="mb-[22px] flex items-center justify-between [&>span]:text-[11px] [&>span]:text-muted-foreground">
        <h2 className="text-[15px] font-semibold leading-normal tracking-[-0.3px]">胶囊</h2>
        <span>即时保存</span>
      </div>
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={busy}>
        <div className="grid grid-cols-2 gap-5">
          <div className="col-span-full grid grid-cols-2 gap-5">
            {select('布局模式', 'layoutMode', [
              ['capsule', '胶囊'],
              ['workbench', '工作台'],
            ])}
            {number('侧栏宽度（px）', ui.dockWidth, 300, 460, (v) => change('dockWidth', v))}
            {number('大纲分栏比例', ui.splitRatio, 0.2, 0.8, (v) => change('splitRatio', v))}
          </div>
          <div className="flex items-end gap-2 [&>label]:flex-1">
            {select('材质', 'material', [
              ['matte', '哑光'],
              ['frosted', '磨砂'],
              ['native-glass', '液态'],
            ])}
            {ui.material === 'native-glass' && (
              <button
                type="button"
                aria-label="通透液态（Clear）"
                aria-pressed={ui.liquidVariant === 'clear'}
                title={
                  ui.liquidVariant === 'clear' ? '已开启通透液态，点击恢复标准' : '开启通透液态'
                }
                onClick={() =>
                  void change('liquidVariant', ui.liquidVariant === 'clear' ? 'regular' : 'clear')
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground aria-pressed:bg-accent aria-pressed:text-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Star
                  aria-hidden="true"
                  size={17}
                  fill={ui.liquidVariant === 'clear' ? 'currentColor' : 'none'}
                />
              </button>
            )}
          </div>
          <label className="min-w-0 [&>span]:mb-2 [&>span]:block [&>span]:text-xs [&>span]:font-[550]">
            <span>Codex 明暗</span>
            <NativeSelect
              aria-label="Codex 明暗"
              value={theme || ''}
              disabled={!connected}
              onChange={(e) => void action('appearance/theme', { mode: e.target.value })}
            >
              {!theme && <option value="">未连接</option>}
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </NativeSelect>
          </label>
          <p className="col-span-full text-xs leading-normal text-muted-foreground">
            内嵌液态使用 SVG；弹出液态使用 macOS 26+ 原生 Regular /
            Clear，旧系统仅弹出液态回退哑光。
          </p>
          {number('字号（px）', Math.max(10, Math.min(24, ui.fontOffset + fontBase)), 10, 24, (v) =>
            change('fontOffset', v - fontBase),
          )}
          <label className="min-w-0 [&>span]:mb-2 [&>span]:block [&>span]:text-xs [&>span]:font-[550]">
            <span>内容显示</span>
            <NativeSelect
              aria-label="内容显示"
              value={String(ui.labelOnly)}
              onChange={(e) => change('labelOnly', e.target.value === 'true')}
            >
              <option value="false">标题 + 摘要</option>
              <option value="true">仅标题</option>
            </NativeSelect>
          </label>
          {select('点击建议', 'promptClickMode', [
            ['fill', '仅填入'],
            ['direct', '直接发送'],
            ['hybrid', '单击填入 · 双击发送'],
          ])}
          <label className="min-w-0 [&>span]:mb-2 [&>span]:block [&>span]:text-xs [&>span]:font-[550]">
            <span>面板顺序</span>
            <NativeSelect
              aria-label="面板顺序"
              value={ui.viewOrder[0]}
              onChange={(e) =>
                change(
                  'viewOrder',
                  e.target.value === 'next' ? ['next', 'outline'] : ['outline', 'next'],
                )
              }
            >
              <option value="next">建议 → 大纲</option>
              <option value="outline">大纲 → 建议</option>
            </NativeSelect>
          </label>
        </div>
        {ui.promptClickMode !== 'fill' && (
          <p className="mt-[7px] text-[10px] leading-[1.7] text-muted-foreground">
            {ui.promptClickMode === 'direct' ? '单击建议会直接发送。' : '双击建议会直接发送。'}
          </p>
        )}
        <details className="group mt-5">
          <summary className="cursor-pointer text-xs font-[550] group-open:mb-5">窗口</summary>
          <div className="grid grid-cols-2 gap-5">
            <label className="min-w-0 [&>span]:mb-2 [&>span]:block [&>span]:text-xs [&>span]:font-[550]">
              <span>显示方式</span>
              <NativeSelect
                aria-label="显示方式"
                value={prefs.detached ? 'desktop' : 'embedded'}
                onChange={(e) =>
                  void action(e.target.value === 'desktop' ? 'panel/open' : 'panel/close')
                }
              >
                <option value="embedded">Codex 内嵌</option>
                <option value="desktop" disabled={!popoutSupported}>
                  {popoutSupported ? '桌面浮窗' : '桌面浮窗（需 macOS 15+ Apple Silicon）'}
                </option>
              </NativeSelect>
            </label>
            {select('当前面板', 'activeTab', [
              ['next', '建议'],
              ['outline', '大纲'],
              ['settings', '设置'],
            ])}
            {number('宽度（px）', ui.width, 300, 640, (v) => change('width', v))}
            {number('高度（px）', ui.height, 340, 720, (v) => change('height', v))}
          </div>
          <Check label="展开胶囊" checked={ui.open} onChange={(v) => change('open', v)} />
          <Check
            label="桌面浮窗置顶"
            checked={prefs.alwaysOnTop}
            onChange={(v) => void update({ alwaysOnTop: v })}
          />
          {prefs.detached && (
            <div className="grid grid-cols-2 gap-5 mt-5">
              {number(
                '屏幕 X',
                prefs.position?.x ?? 0,
                -100000,
                100000,
                (x) => void update({ position: { x, y: prefs.position?.y ?? 0 } }),
              )}
              {number(
                '屏幕 Y',
                prefs.position?.y ?? 0,
                -100000,
                100000,
                (y) => void update({ position: { x: prefs.position?.x ?? 0, y } }),
              )}
            </div>
          )}
        </details>
      </fieldset>
    </Card>
  );
}
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-4 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground [&_input]:m-0 [&_input]:accent-primary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
