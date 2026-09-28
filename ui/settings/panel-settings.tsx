/* [INPUT]: 版本化外观偏好与认证 API。
 * [OUTPUT]: 下一步的显示/点击设置，及容器字号、宽度和置顶设置。
 * [POS]: 保留有效旧字段的设置适配；不再编辑旧两功能布局、主题或窗口归属。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useState } from 'react';
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
    [error, setError] = useState('');
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
  ) => (
    <Field id={id} label={label}>
      <Input
        key={value}
        id={id}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n) && n >= min && n <= max) {
            if (n !== value) commit(n);
          } else {
            e.currentTarget.value = String(value);
            setError(`${label}范围为 ${min}–${max}`);
          }
        }}
      />
    </Field>
  );
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
        <section className="settings-section">
          <h2>尺寸与窗口</h2>
          {number('dock-width', '侧栏宽度（px）', ui.dockWidth, 300, 460, (n) =>
            change('dockWidth', n),
          )}
          {number(
            'surface-font',
            '字号（px）',
            Math.max(10, Math.min(24, ui.fontOffset + fontBase)),
            10,
            24,
            (n) => change('fontOffset', n - fontBase),
          )}
          <Toggle
            label="桌面窗口置顶"
            checked={prefs.alwaysOnTop}
            onChange={(v) => void update({ alwaysOnTop: v })}
          />
        </section>
      )}
      <Feedback text={error} failed />
    </fieldset>
  );
}
