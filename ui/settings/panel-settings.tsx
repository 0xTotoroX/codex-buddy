/* [INPUT]: 版本化外观偏好与认证 API。
 * [OUTPUT]: 下一步的显示/点击设置，及四功能独立字号、一键重置、宽度和置顶设置。
 * [POS]: 保留有效旧字段的设置适配；不再编辑旧两功能布局、主题或窗口归属。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './components/ui/button';
import { titles, defaultFontSizes, featureFontSize, type FeatureId } from '../shared/features';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { Field, Toggle, Feedback } from './settings-controls';
import { request } from './api';
import type { AppearanceSettings, PanelPreferences } from '../shared/contracts';
export function PanelSettings({
  value,
  fontBase = 13,
  section = 'surfaces',
}: {
  value?: AppearanceSettings;
  fontBase?: number;
  section?: 'next' | 'surfaces';
}) {
  const [prefs, setPrefs] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [fontReset, setFontReset] = useState(0);
  useEffect(() => {
    if (value)
      setPrefs((current) => (!current || value.revision >= current.revision ? value : current));
  }, [value]);
  if (!prefs) return null;
  const { ui } = prefs;
  async function update(body: object) {
    if (!prefs || busy) return;
    setBusy(true);
    setError('');
    try {
      setPrefs(
        await request<AppearanceSettings>('appearance', {
          ...body,
          expectedRevision: prefs.revision,
        }),
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      try {
        setPrefs(await request<AppearanceSettings>('appearance'));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  const change = (key: keyof PanelPreferences, value: unknown) =>
    void update({ ui: { [key]: value } });
  const number = (
    id: string,
    label: string,
    value: number,
    min: number,
    max: number,
    commit: (n: number) => void,
    decimal = false,
  ) => {
    const bump = (input: HTMLInputElement, delta: number) => {
      const current = input.valueAsNumber;
      const next =
        Math.round(
          Math.max(min, Math.min(max, (Number.isFinite(current) ? current : value) + delta)) * 10,
        ) / 10;
      input.value = String(next);
      return next;
    };
    return (
      <Field id={id} label={label}>
        <div className={decimal ? 'font-stepper' : undefined}>
          <Input
            key={decimal ? `${value}-${fontReset}` : value}
            id={id}
            type="number"
            defaultValue={value}
            min={min}
            max={max}
            step={1}
            onKeyDown={(e) => {
              if (decimal && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                bump(e.currentTarget, e.key === 'ArrowUp' ? 1 : -1);
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const entered = e.currentTarget.valueAsNumber;
              const n = decimal ? Math.round(entered * 10) / 10 : entered;
              if (Number.isFinite(n) && n >= min && n <= max) {
                e.currentTarget.value = String(n);
                if (n !== value) commit(n);
              } else {
                e.currentTarget.value = String(value);
                setError(`${label}范围为 ${min}–${max}`);
              }
            }}
          />
          {decimal &&
            [-1, 1].map((delta) => (
              <button
                type="button"
                key={delta}
                aria-label={`${delta < 0 ? '减小' : '增大'}${label}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  const input = e.currentTarget.parentElement!.querySelector('input')!;
                  const next = bump(input, delta);
                  if (next !== value) commit(next);
                }}
              >
                {delta < 0 ? <Minus size={16} /> : <Plus size={16} />}
              </button>
            ))}
        </div>
      </Field>
    );
  };
  return (
    <fieldset className="min-w-0 border-0 p-0" disabled={busy}>
      {section === 'next' ? (
        <>
          <Field id="suggestion-labels" label="内容显示">
            <NativeSelect
              id="suggestion-labels"
              value={String(ui.labelOnly)}
              onChange={(e) => change('labelOnly', e.target.value === 'true')}
            >
              <option value="false">标题 + 摘要</option>
              <option value="true">仅标题</option>
            </NativeSelect>
          </Field>
          <Field
            id="suggestion-click"
            label="点击建议"
            hint={
              ui.promptClickMode === 'direct'
                ? '单击建议会直接发送。'
                : ui.promptClickMode === 'hybrid'
                  ? '双击建议会直接发送。'
                  : undefined
            }
          >
            <NativeSelect
              id="suggestion-click"
              value={ui.promptClickMode}
              onChange={(e) => change('promptClickMode', e.target.value)}
            >
              <option value="fill">仅填入</option>
              <option value="direct">直接发送</option>
              <option value="hybrid">单击填入 · 双击发送</option>
            </NativeSelect>
          </Field>
        </>
      ) : (
        <>
          <section className="settings-section" id="settings-fonts">
            <div className="settings-row settings-font-heading">
              <h2>内容字号</h2>
              <Button
                type="button"
                variant="ghost"
                onPointerDown={(e) => e.preventDefault()}
                onClick={async () => {
                  if (await update({ ui: { fontSizes: defaultFontSizes, fontOffset: 0 } }))
                    setFontReset((n) => n + 1);
                }}
              >
                重置全部字号
              </Button>
            </div>
            {(Object.keys(defaultFontSizes) as FeatureId[]).map((id) => (
              <div key={id}>
                {number(
                  `font-${id}`,
                  `${titles[id]}字号（px）`,
                  featureFontSize(
                    id,
                    ui.fontSizes,
                    ui.fontOffset ? ui.fontOffset + fontBase : undefined,
                  ),
                  10,
                  24,
                  (n) => change('fontSizes', { ...ui.fontSizes, [id]: n }),
                  true,
                )}
              </div>
            ))}
          </section>
          <section className="settings-section">
            <h2>尺寸与窗口</h2>
            {number('dock-width', '侧栏宽度（px）', ui.dockWidth, 300, 460, (n) =>
              change('dockWidth', n),
            )}
            <div id="window-pinning">
              <Toggle
                label="桌面窗口置顶"
                checked={prefs.alwaysOnTop}
                onChange={(v) => void update({ alwaysOnTop: v })}
              />
            </div>
          </section>
        </>
      )}
      <Feedback text={error} failed />
    </fieldset>
  );
}
